const logger = require('../utils/logger');
const { Scenes } = require('telegraf');
const { Homework } = require('../models');
const { findNextLesson, getTagContext } = require('../utils/scheduleUtils');
const { buildAudienceTag, isSubgroupOnlyChoice } = require('../utils/audience');
const { formatDate, getDayName, getNextDayOfWeek } = require('../utils/dateUtils');
const { getCalendarDayOfWeek, getMoscowToday } = require('../utils/moscowTime');
const scheduleService = require('../services/scheduleService');
const { getRecentLessonRows, buildQuickPickLabel } = require('../utils/recentLessons');
const {
  fetchExistingHomework,
  formatExistingHomeworkText,
  existingHomeworkKeyboard,
  replaceHomeworkConditional,
  handleChoiceCallback
} = require('../utils/homeworkWrite');

/**
 * Гашение протухшей клавиатуры исходного сообщения (F9): пустая клавиатура,
 * чтобы старые кнопки больше не срабатывали повторно. Всё в try/catch.
 * @param {object} ctx - Telegraf context
 * @returns {Promise<void>}
 */
async function dismissKeyboard(ctx) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (_e) {
    void _e;
  }
}

/**
 * Профиль аудитории для записи (D4): при отсутствии профиля/флага — null (старое поведение).
 * @param {object} ctx - Telegraf context
 * @returns {Promise<object|null>}
 */
async function resolveAudienceProfile(ctx) {
  try {
    const { getUserProfile } = require('../utils/userProfile');
    const p = await getUserProfile(ctx.from && ctx.from.id);
    if (!p || !p.classId) return null;
    return p;
  } catch (_e) {
    return null;
  }
}

/**
 * Scope-инфо для записи: enabled + scope ('own' дефолт, master OFF ≡ 'all').
 * @param {object} ctx
 * @returns {Promise<{enabled: boolean, scope: string, profile: object|null}>}
 */
async function getWriteScope(ctx) {
  const profile = await resolveAudienceProfile(ctx);
  let enabled = false;
  try {
    const { isMultiprofileEnabled } = require('../utils/settings');
    enabled = await isMultiprofileEnabled();
  } catch (_e) {
    enabled = false;
  }
  const scope = !enabled ? 'all' : (profile && profile.scope === 'all' ? 'all' : 'own');
  return { enabled, scope, profile };
}

/**
 * Все варианты аудитории по предмету для scope='all' (P2 A5: disambiguation).
 * @param {string} subjectName
 * @param {object} profile
 * @returns {Promise<Array>}
 */
async function findAllVariants(subjectName, profile) {
  const audience = {
    classId: profile.classId,
    trackId: profile.trackId || null,
    subgroupId: profile.subgroupId || null,
    scope: profile.scope || 'all'
  };
  const matches = await scheduleService.findBySubjectNormalized(subjectName, audience);
  const seen = new Set();
  return (matches || []).filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/**
 * Ближайшая дата урока для конкретного schedule (начиная с завтрашней недели).
 * @param {object} schedule
 * @returns {Date}
 */
function nextDateForSchedule(schedule) {
  // База — московская календарная дата (полдень), не instant «сейчас»
  const today = getMoscowToday();
  return getNextDayOfWeek(today, schedule.dayOfWeek);
}

/**
 * Показать disambiguation-кнопки вариантов аудитории (P2: в all при >1 варианте).
 * @param {object} ctx
 * @param {string} subjectName
 * @param {Array} variants
 */
async function showVariantPicker(ctx, subjectName, variants) {
  let tagCtx = null;
  try {
    tagCtx = await getTagContext();
  } catch (_e) {
    tagCtx = null;
  }
  ctx.wizard.state.pendingPick = variants.map((s) => s.id);
  // F11: различаются только подгруппой → явный вопрос «У кого именно?» с кнопками-учителями
  if (isSubgroupOnlyChoice(variants)) {
    const subMap = (tagCtx && tagCtx.subgroupNames) || new Map();
    const keyboard = variants.map((s) => {
      const info = subMap.get(s.subgroupId) || {};
      const label = info.teacher || info.name || s.subgroupId || s.subjectName;
      return [{ text: label, callback_data: `hw_pick:${s.id}` }];
    });
    keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);
    await ctx.reply(`📚 ${subjectName}: у кого именно?`, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }
  const shortDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const keyboard = variants.map((s) => {
    const tag = buildAudienceTag(s, tagCtx || {}, tagCtx || {});
    const label = `${tag || s.subjectName} · ${shortDays[s.dayOfWeek] || ''} ${s.lessonNumber} ур.`;
    return [{ text: label, callback_data: `hw_pick:${s.id}` }];
  });
  keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);
  await ctx.reply(`📚 ${subjectName}: несколько вариантов — выбери:`, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Общая точка: schedule выбран → проверяем существующие записи (P2 §13.1).
 * Пусто → сразу просим текст (next); есть → показ с автором/временем + кнопки (ждём выбор).
 * @param {object} ctx
 * @param {object} schedule
 */
async function proceedWithSchedule(ctx, schedule) {
  const date = nextDateForSchedule(schedule);
  ctx.wizard.state.scheduleId = schedule.id;
  ctx.wizard.state.date = date;
  ctx.wizard.state.subjectName = schedule.subjectName;
  ctx.wizard.state.pendingPick = null;

  // Строка даты из тех же локальных Y-M-D (инвариант с заголовком и расписанием)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let rows = [];
  try {
    rows = await fetchExistingHomework(schedule.id, dateStr);
  } catch (e) {
    logger.error('fetchExistingHomework', e.message || e);
    rows = [];
  }
  if (!rows || rows.length === 0) {
    ctx.wizard.state.pendingMode = 'add';
    // date — календарная: день её собственных Y-M-D
    const dayOfWeek = getCalendarDayOfWeek(date);
    await ctx.reply(
      `✅ Найден ближайший урок:\n\n` +
        `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n` +
        `📚 ${schedule.lessonNumber} урок: ${schedule.subjectName}\n\n` +
        `📝 Теперь введите текст домашнего задания:`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
        }
      }
    );
    return ctx.wizard.next();
  }
  const last = rows[rows.length - 1];
  ctx.wizard.state.pendingMode = null;
  ctx.wizard.state.seenLastId = last.id;
  ctx.wizard.state.seenUpdatedAt = last.updatedAt;
  const text = await formatExistingHomeworkText({ subjectName: schedule.subjectName, date, rows });
  await ctx.reply(text, { reply_markup: existingHomeworkKeyboard() });
}

/**
 * Резолв предмета в schedule: scope all + >1 вариант → disambiguation, иначе proceed.
 * @param {object} ctx
 * @param {string} subjectName
 */
async function resolveSubject(ctx, subjectName) {
  const { enabled, scope, profile } = await getWriteScope(ctx);
  if (enabled && scope === 'all' && profile) {
    const variants = await findAllVariants(subjectName, profile);
    if (!variants || variants.length === 0) {
      await ctx.reply(
        `❌ Предмет "${subjectName}" не найден в расписании.\n\n` +
          `Пожалуйста, убедитесь, что название предмета совпадает с расписанием, ` +
          `или обратитесь к администратору для добавления предмета в расписание.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        }
      );
      return ctx.scene.leave();
    }
    if (variants.length > 1) {
      await showVariantPicker(ctx, subjectName, variants);
      return;
    }
    await proceedWithSchedule(ctx, variants[0]);
    return;
  }
  // own / флаг выкл: как раньше — ближайший урок твоего профиля
  const nextLesson = await findNextLesson(subjectName, new Date(), await resolveAudienceProfile(ctx));

  if (!nextLesson) {
    await ctx.reply(
      `❌ Предмет "${subjectName}" не найден в расписании.\n\n` +
        `Пожалуйста, убедитесь, что название предмета совпадает с расписанием, ` +
        `или обратитесь к администратору для добавления предмета в расписание.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
        }
      }
    );
    return ctx.scene.leave();
  }

  const { schedule } = nextLesson;
  ctx.wizard.state.subjectName = subjectName;
  await proceedWithSchedule(ctx, schedule);
}

/**
 * Сцена для добавления домашнего задания
 * Шаг 1: Пользователь вводит название предмета
 * Шаг 2: Бот находит ближайший урок (в all — уточнение варианта) и показывает существующие
 * Шаг 3: Пользователь вводит текст (добавление новой строкой / условная замена)
 */
const addHomeworkScene = new Scenes.WizardScene(
  'addHomework',
  async (ctx) => {
    // Обработка callback_query (кнопка "Вернуться в меню")
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery();
      return ctx.scene.leave();
    }

    // Шаг 1: Запрашиваем название предмета + быстрые кнопки последних уроков
    let quickRows = [];
    try {
      const quickProfile = await resolveAudienceProfile(ctx);
      quickRows = await getRecentLessonRows({ limit: 4, now: new Date(), profile: quickProfile });
    } catch (e) {
      logger.error('quick rows error', e);
      quickRows = [];
    }
    let quickTagCtx = null;
    try {
      quickTagCtx = await getTagContext();
    } catch (_e) {
      quickTagCtx = null;
    }
    const keyboard = [];
    for (const row of quickRows) {
      keyboard.push([{ text: buildQuickPickLabel(row, quickTagCtx), callback_data: `quick:${row.id}` }]);
    }
    keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);

    const quickHint = quickRows.length ? '\n\n_Или выберите быстрый вариант из последних уроков:_' : '';
    await ctx.reply('📚 Введите название предмета, по которому хотите добавить домашнее задание:' + quickHint, {
      parse_mode: quickRows.length ? 'Markdown' : undefined,
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Обработка callback_query
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

      if (await handleChoiceCallback(ctx, data)) return;

      if (data.startsWith('hw_pick:')) {
        const id = Number(data.split(':')[1]);
        await ctx.answerCbQuery().catch(() => {});
        await dismissKeyboard(ctx);
        let row = null;
        try {
          row = await scheduleService.findById(id);
        } catch (e) {
          logger.error('hw_pick lookup error', e);
          row = null;
        }
        if (!row || !(ctx.wizard.state.pendingPick || []).includes(id)) {
          await ctx.reply('❌ Вариант не найден. Попробуйте ещё раз.');
          return;
        }
        await proceedWithSchedule(ctx, row);
        return;
      }

      if (data.startsWith('quick:')) {
        const id = Number(data.split(':')[1]);
        let row;
        try {
          row = await scheduleService.findById(id);
        } catch (e) {
          logger.error('quick lookup error', e);
          row = null;
        }
        if (!row) {
          await ctx.answerCbQuery('❌ Урок не найден');
          return;
        }
        await ctx.answerCbQuery();
        await dismissKeyboard(ctx);
        // quick-выбор — конкретный урок, disambiguation не нужен
        await proceedWithSchedule(ctx, row);
        return;
      }

      await ctx.answerCbQuery();
      const action = data;

      if (action === 'back_to_menu' || action === 'homework_cancel') {
        await ctx.reply('❌ Действие отменено.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        });
        return ctx.scene.leave();
      }
      return;
    }

    // Проверяем, что это текстовое сообщение
    if (!ctx.message || !ctx.message.text) {
      return;
    }

    // Показан список существующих — ждём кнопки, а не текст
    if (ctx.wizard.state.seenLastId != null && ctx.wizard.state.pendingMode == null) {
      await ctx.reply('Выбери действие кнопками: ➕ Добавить / 🔄 Заменить / ❌ Отмена');
      return;
    }

    // Сохраняем название предмета
    const subjectName = ctx.message.text.trim();
    ctx.wizard.state.subjectName = subjectName;
    ctx.wizard.state.pendingPick = null;
    ctx.wizard.state.seenLastId = null;

    try {
      await resolveSubject(ctx, subjectName);
    } catch (error) {
      logger.error('Ошибка при поиске урока:', error);
      await ctx.reply('❌ Произошла ошибка при поиске урока. Попробуйте позже.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
        }
      });
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    // Обработка callback_query
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (await handleChoiceCallback(ctx, data)) return;
      await ctx.answerCbQuery();
      const action = ctx.callbackQuery.data;

      if (action === 'back_to_menu' || action === 'homework_cancel') {
        await ctx.reply('❌ Действие отменено.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        });
        return ctx.scene.leave();
      }
      return;
    }

    // Проверяем, что это текстовое сообщение
    if (!ctx.message || !ctx.message.text) {
      return;
    }

    // Шаг 3: Сохраняем домашнее задание
    const content = ctx.message.text.trim();
    const { scheduleId, date, subjectName, pendingMode, seenLastId, seenUpdatedAt } = ctx.wizard.state;

    if (pendingMode == null) {
      await ctx.reply('Выбери действие кнопками: ➕ Добавить / 🔄 Заменить / ❌ Отмена');
      return;
    }

    if (!content || content.length === 0) {
      await ctx.reply('❌ Текст домашнего задания не может быть пустым. Попробуйте еще раз:', {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
        }
      });
      return; // Остаемся на том же шаге
    }

    if (pendingMode === 'replace') {
      try {
        // Строка даты из тех же локальных Y-M-D (инвариант с заголовком и расписанием)
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const res = await replaceHomeworkConditional({
          scheduleId,
          dateStr,
          lastId: seenLastId,
          seenUpdatedAt,
          content,
          userId: ctx.from.id
        });
        if (res.ok) {
          // date — календарная: день её собственных Y-M-D
    const dayOfWeek = getCalendarDayOfWeek(date);
          await ctx.reply(
            `✅ Домашнее задание заменено!\n\n` +
              `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n` +
              `📚 ${subjectName}\n` +
              `📝 ${content}`,
            {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
              }
            }
          );
          return ctx.scene.leave();
        }
        // Конфликт: перепоказ свежего (P2 §13.2)
        const rows = res.rows || [];
        if (rows.length === 0) {
          await ctx.reply('⚠️ Запись пропала, пока ты писал. Попробуй добавить заново:', {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
            }
          });
          return ctx.scene.leave();
        }
        const last = rows[rows.length - 1];
        ctx.wizard.state.pendingMode = null;
        ctx.wizard.state.seenLastId = last.id;
        ctx.wizard.state.seenUpdatedAt = last.updatedAt;
        const fresh = await formatExistingHomeworkText({ subjectName, date, rows });
        await ctx.reply(`⚠️ Пока ты писал, запись изменилась. Вот свежие:\n\n${fresh}`, {
          reply_markup: existingHomeworkKeyboard()
        });
        return;
      } catch (error) {
        logger.error('Ошибка при замене домашнего задания:', error);
        await ctx.reply('❌ Произошла ошибка при замене домашнего задания. Попробуйте позже.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        });
        return ctx.scene.leave();
      }
    }

    try {
      // Сохраняем домашнее задание
      await Homework.create({
        userId: ctx.from.id,
        scheduleId: scheduleId,
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        content: content
      });
      // P3: счётчик добавленных ДЗ (путь «Заменить» — не инкрементит, создания нет)
      try {
        const { incrementHomeworkCount } = require('../utils/homeworkWrite');
        await incrementHomeworkCount(ctx.from.id);
      } catch (_hc) {
        void _hc;
      }

      // date — календарная: день её собственных Y-M-D
    const dayOfWeek = getCalendarDayOfWeek(date);
      await ctx.reply(
        `✅ Домашнее задание успешно добавлено!\n\n` +
          `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n` +
          `📚 ${subjectName}\n` +
          `📝 ${content}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        }
      );
    } catch (error) {
      logger.error('Ошибка при сохранении домашнего задания:', error);
      await ctx.reply('❌ Произошла ошибка при сохранении домашнего задания. Попробуйте позже.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
        }
      });
    }

    return ctx.scene.leave();
  }
);

module.exports = addHomeworkScene;
module.exports.showVariantPicker = showVariantPicker;
module.exports.dismissKeyboard = dismissKeyboard;
