const logger = require('../utils/logger');
const { Scenes } = require('telegraf');
const { Homework } = require('../models');
const scheduleService = require('../services/scheduleService');
const { getMoscowNow, getCalendarDayOfWeek, parseCalendarDate } = require('../utils/moscowTime');
const { formatDate, getDayName } = require('../utils/dateUtils');
const { getRecentLessonRows, buildQuickPickLabel } = require('../utils/recentLessons');
const { getTagContext } = require('../utils/scheduleUtils');
const { buildAudienceTag, isSubgroupOnlyChoice } = require('../utils/audience');
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
 * Опции аудитории для записи (D4 + P2 scope): при отсутствии профиля — null
 * (старое поведение, findBySubjectNormalized без фильтра; при выключенном флаге
 * фильтр тоже не применяется). Scope пробрасываем для классового фильтра в all.
 * @param {object} ctx - Telegraf context
 * @returns {Promise<object|null>}
 */
async function resolveAudienceOpts(ctx) {
  try {
    const { getUserProfile } = require('../utils/userProfile');
    const p = await getUserProfile(ctx.from && ctx.from.id);
    if (!p || !p.classId) return null;
    return { classId: p.classId, trackId: p.trackId || null, subgroupId: p.subgroupId || null, scope: p.scope || 'own' };
  } catch (_e) {
    return null;
  }
}

/**
 * Короткое название дня недели для клавиатуры дат
 * @param {number} dayOfWeek 0=Пн ... 6=Вс
 * @returns {string}
 */
function getShortDayName(dayOfWeek) {
  const short = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  return short[dayOfWeek] || '';
}

/**
 * Сгенерировать клавиатуру дат на 14 дней вперёд для предмета
 * Показывает только даты где есть урок (начиная с завтра), без серых кнопок.
 * В scope all при >1 варианте на дату — кнопка уточнения (P2 disambiguation).
 * @param {Array} schedules - все Schedule по предмету (отфильтрованные по subjectsMatch)
 * @param {Date} baseDate - базовый Date (12:00) московской сегодняшней даты
 * @param {boolean} [isAll=false] - scope all: даты с несколькими вариантами ведут на уточнение
 * @returns {Array<Array<{text:string,callback_data:string}>>|null} null если нет дат с уроком
 */
function buildDateKeyboard(schedules, baseDate, isAll = false) {
  const buttons = [];

  for (let i = 1; i <= 14; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);

    // d — календарная дата: день её собственных Y-M-D
    const dayOfWeek = getCalendarDayOfWeek(d);
    const matching = schedules.filter((s) => s.dayOfWeek === dayOfWeek).sort((a, b) => a.lessonNumber - b.lessonNumber);

    if (matching.length === 0) continue;

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${getShortDayName(dayOfWeek)} ${dd}.${mm}`;

    if (isAll && matching.length > 1) {
      buttons.push({
        text: `${label} · ${matching.length} вар.`,
        callback_data: `hw_variants:${isoDate}`
      });
    } else {
      buttons.push({
        text: label,
        callback_data: `hw_date:${isoDate}:${matching[0].id}`
      });
    }
  }

  if (buttons.length === 0) return null;

  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 3) {
    keyboard.push(buttons.slice(i, i + 3));
  }
  keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);

  return keyboard;
}

/**
 * Человекочитаемая метка даты для пикера вариантов (F12): «Ср, 07.10», не ISO.
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {string}
 */
function humanDateLabel(isoDate) {
  try {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${getShortDayName(getCalendarDayOfWeek(dt))}, ${dd}.${mm}`;
  } catch (_e) {
    return String(isoDate);
  }
}

/**
 * Общая точка: schedule + date выбраны → проверка существующих (P2 §13.1).
 * @param {object} ctx
 * @param {object} schedule
 * @param {Date} date
 */
async function proceedWithScheduleDate(ctx, schedule, date) {
  ctx.wizard.state.scheduleId = schedule.id;
  ctx.wizard.state.date = date;
  ctx.wizard.state.selectedSchedule = schedule;

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
      `📝 Теперь введите текст домашнего задания для ${schedule.subjectName} на ${getDayName(dayOfWeek)}, ${formatDate(date)} (${schedule.lessonNumber} урок):`,
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
 * Показать disambiguation вариантов на дату (P2: в all при >1 варианте — кнопки с scheduleId).
 * @param {object} ctx
 * @param {string} isoDate - YYYY-MM-DD
 * @param {Array} matching - schedule-строки этого дня недели
 */
async function showDateVariantPicker(ctx, isoDate, matching) {
  let tagCtx = null;
  try {
    tagCtx = await getTagContext();
  } catch (_e) {
    tagCtx = null;
  }
  const humanDate = humanDateLabel(isoDate);
  ctx.wizard.state.pendingVariants = matching.map((s) => s.id);
  // F11: различаются только подгруппой → явный вопрос «У кого именно?» с кнопками-учителями
  if (isSubgroupOnlyChoice(matching)) {
    const subMap = (tagCtx && tagCtx.subgroupNames) || new Map();
    const keyboard = matching.map((s) => {
      const info = subMap.get(s.subgroupId) || {};
      const label = info.teacher || info.name || s.subgroupId || s.subjectName;
      return [{ text: label, callback_data: `hw_variant:${s.id}:${isoDate}` }];
    });
    keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);
    await ctx.reply(`📚 ${humanDate}: у кого именно?`, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }
  const keyboard = matching.map((s) => {
    const tag = buildAudienceTag(s, tagCtx || {}, tagCtx || {});
    const label = `${tag || s.subjectName} · ${s.lessonNumber} ур.`;
    return [{ text: label, callback_data: `hw_variant:${s.id}:${isoDate}` }];
  });
  keyboard.push([{ text: '❌ Отменить', callback_data: 'homework_cancel' }]);
  await ctx.reply(`📚 ${humanDate}: несколько вариантов — выбери:`, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Сцена выбора даты для домашнего задания
 * Шаг 1: ввод предмета
 * Шаг 2: выбор даты из 14 дней (в all — уточнение варианта) + показ существующих
 * Шаг 3: ввод текста домашки (добавление / условная замена)
 */
const addHomeworkOnDateScene = new Scenes.WizardScene(
  'addHomeworkOnDate',
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery();
      return ctx.scene.leave();
    }

    let quickRows = [];
    try {
      const quickProfile = await resolveAudienceOpts(ctx);
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
    await ctx.reply(
      '📚 Введите название предмета, по которому хотите добавить домашнее задание на конкретную дату:' + quickHint,
      {
        parse_mode: quickRows.length ? 'Markdown' : undefined,
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Обработка callback_query (выбор даты / варианта / отмена)
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

      if (await handleChoiceCallback(ctx, data)) return;

      if (data === 'back_to_menu' || data === 'homework_cancel') {
        await ctx.answerCbQuery();
        await ctx.reply('❌ Действие отменено.', {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        });
        return ctx.scene.leave();
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
        const subjectName = row.subjectName;
        ctx.wizard.state.subjectName = subjectName;
        try {
          const schedules = await scheduleService.findBySubjectNormalized(subjectName, await resolveAudienceOpts(ctx));
          if (!schedules || schedules.length === 0) {
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
          const { isoDate } = getMoscowNow();
          const [y, m, d] = isoDate.split('-').map(Number);
          const baseDate = new Date(y, m - 1, d, 12, 0, 0, 0);
          const isAll = await isWriteScopeAll(ctx);
          const keyboard = buildDateKeyboard(schedules, baseDate, isAll);
          if (!keyboard) {
            await ctx.reply(`❌ В ближайшие 2 недели нет уроков по предмету "${subjectName}".`, {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
              }
            });
            return ctx.scene.leave();
          }
          await ctx.reply(
            `📅 Выберите дату для предмета "${subjectName}" на ближайшие 2 недели:\n\nПоказаны только дни с уроком (начиная с завтра):`,
            {
              reply_markup: {
                inline_keyboard: keyboard
              }
            }
          );
          return;
        } catch (error) {
          logger.error('Ошибка при поиске предмета:', error);
          await ctx.reply('❌ Произошла ошибка при поиске предмета. Попробуйте позже.', {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
            }
          });
          return ctx.scene.leave();
        }
      }

      if (data.startsWith('hw_date_na:')) {
        await ctx.answerCbQuery('❌ В этот день нет урока по этому предмету');
        return;
      }

      // Уточнение варианта на дату: hw_variants:YYYY-MM-DD
      if (data.startsWith('hw_variants:')) {
        await ctx.answerCbQuery().catch(() => {});
        await dismissKeyboard(ctx);
        const isoDate = data.split(':')[1];
        const subjectName = ctx.wizard.state.subjectName;
        try {
          const schedules = await scheduleService.findBySubjectNormalized(subjectName, await resolveAudienceOpts(ctx));
          const date = parseCalendarDate(isoDate);
      // date — календарная: день её собственных Y-M-D
      const dayOfWeek = getCalendarDayOfWeek(date);
          const matching = (schedules || [])
            .filter((s) => s.dayOfWeek === dayOfWeek)
            .sort((a, b) => a.lessonNumber - b.lessonNumber);
          if (matching.length <= 1) {
            await ctx.reply('❌ Варианты не найдены. Выберите дату заново.');
            return;
          }
          await showDateVariantPicker(ctx, isoDate, matching);
          return;
        } catch (error) {
          logger.error('Ошибка при уточнении варианта:', error);
          await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
          return;
        }
      }

      // Выбор варианта: hw_variant:<scheduleId>:<YYYY-MM-DD>
      if (data.startsWith('hw_variant:')) {
        const parts = data.split(':');
        const scheduleId = Number(parts[1]);
        const isoDate = parts[2];
        await ctx.answerCbQuery().catch(() => {});
        await dismissKeyboard(ctx);
        if (!(ctx.wizard.state.pendingVariants || []).includes(scheduleId)) {
          await ctx.reply('❌ Вариант не найден. Попробуйте ещё раз.');
          return;
        }
        try {
          const schedule = await scheduleService.findById(scheduleId);
          if (!schedule) {
            await ctx.reply('❌ Урок не найден. Попробуйте ещё раз.');
            return;
          }
          ctx.wizard.state.pendingVariants = null;
          const date = parseCalendarDate(isoDate);
          await proceedWithScheduleDate(ctx, schedule, date);
          return;
        } catch (error) {
          logger.error('Ошибка при выборе варианта:', error);
          await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
          return;
        }
      }

      if (data.startsWith('hw_date:')) {
        // Формат hw_date:YYYY-MM-DD:scheduleId
        const parts = data.split(':');
        // parts[0]=hw_date, parts[1]=YYYY-MM-DD, parts[2]=scheduleId
        const isoDate = parts[1];
        const scheduleId = Number(parts[2]);

        try {
          const schedule = await scheduleService.findById(scheduleId);
          if (!schedule) {
            await ctx.answerCbQuery();
            await ctx.reply('❌ Урок не найден. Попробуйте ещё раз.', {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
              }
            });
            return ctx.scene.leave();
          }
          // D4 quick-путь: выбранный урок должен быть виден профилю (при флаге)
          try {
            const { isMultiprofileEnabled } = require('../utils/settings');
            const { isVisibleWithScope } = require('../utils/audience');
            const audienceOpts = await resolveAudienceOpts(ctx);
            const enabled = await isMultiprofileEnabled();
            if (audienceOpts && enabled && !isVisibleWithScope(schedule, audienceOpts, enabled)) {
              await ctx.answerCbQuery();
              await ctx.reply('❌ Урок не найден. Попробуйте ещё раз.', {
                reply_markup: {
                  inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
                }
              });
              return ctx.scene.leave();
            }
          } catch (_vis) {
            void _vis;
          }

          // Сохраняем выбор
          const date = parseCalendarDate(isoDate);
          // subjectName уже сохранён на этапе ввода предмета

          await ctx.answerCbQuery();

          await dismissKeyboard(ctx);
          await proceedWithScheduleDate(ctx, schedule, date);
          return;
        } catch (error) {
          logger.error('Ошибка при выборе даты:', error);
          await ctx.answerCbQuery();
          await ctx.reply('❌ Произошла ошибка. Попробуйте позже.', {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
            }
          });
          return ctx.scene.leave();
        }
      }

      await ctx.answerCbQuery();
      return;
    }

    // Показан список существующих — ждём кнопки, а не текст
    if (ctx.wizard.state.seenLastId != null && ctx.wizard.state.pendingMode == null) {
      if (ctx.message && ctx.message.text) {
        await ctx.reply('Выбери действие кнопками: ➕ Добавить / 🔄 Заменить / ❌ Отмена');
      }
      return;
    }

    // Проверяем текстовое сообщение — ввод названия предмета
    if (!ctx.message || !ctx.message.text) {
      return;
    }

    const subjectName = ctx.message.text.trim();
    ctx.wizard.state.subjectName = subjectName;
    ctx.wizard.state.pendingVariants = null;
    ctx.wizard.state.seenLastId = null;

    try {
      const schedules = await scheduleService.findBySubjectNormalized(subjectName, await resolveAudienceOpts(ctx));

      if (!schedules || schedules.length === 0) {
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

      // Генерируем клавиатуру на 14 дней от сегодня по Москве
      const { isoDate } = getMoscowNow();
      const [y, m, d] = isoDate.split('-').map(Number);
      const baseDate = new Date(y, m - 1, d, 12, 0, 0, 0);

      const isAll = await isWriteScopeAll(ctx);
      const keyboard = buildDateKeyboard(schedules, baseDate, isAll);

      if (!keyboard) {
        await ctx.reply(`❌ В ближайшие 2 недели нет уроков по предмету "${subjectName}".`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
          }
        });
        return ctx.scene.leave();
      }

      await ctx.reply(
        `📅 Выберите дату для предмета "${subjectName}" на ближайшие 2 недели:\n\nПоказаны только дни с уроком (начиная с завтра):` +
          (isAll ? '\n\nДаты с пометкой «· N вар.» — несколько вариантов, уточню после выбора.' : ''),
        {
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
      // Остаёмся на этом же шаге — ждём callback с выбором даты
      return;
    } catch (error) {
      logger.error('Ошибка при поиске предмета:', error);
      await ctx.reply('❌ Произошла ошибка при поиске предмета. Попробуйте позже.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
        }
      });
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
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

    if (!ctx.message || !ctx.message.text) {
      return;
    }

    const content = ctx.message.text.trim();
    const { scheduleId, date, subjectName, selectedSchedule, pendingMode, seenLastId, seenUpdatedAt } = ctx.wizard.state;

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
      return;
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
          const lessonNumber = selectedSchedule ? selectedSchedule.lessonNumber : '';
          await ctx.reply(
            `✅ Домашнее задание заменено!\n\n` +
              `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n` +
              `📚 ${subjectName} (${lessonNumber} урок)\n` +
              `📝 ${content}`,
            {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
              }
            }
          );
          return ctx.scene.leave();
        }
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
      const lessonNumber = selectedSchedule ? selectedSchedule.lessonNumber : '';

      await ctx.reply(
        `✅ Домашнее задание успешно добавлено!\n\n` +
          `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n` +
          `📚 ${subjectName} (${lessonNumber} урок)\n` +
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

/**
 * Пишет ли текущий пользователь в scope all (нужен disambiguation).
 * Master OFF ≡ all для всех (P2 §3.1) — но запись идёт как в OLD, без уточнений.
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
async function isWriteScopeAll(ctx) {
  try {
    const { isMultiprofileEnabled } = require('../utils/settings');
    const enabled = await isMultiprofileEnabled();
    if (!enabled) return false;
    const opts = await resolveAudienceOpts(ctx);
    return !!(opts && opts.scope === 'all');
  } catch (_e) {
    return false;
  }
}

module.exports = addHomeworkOnDateScene;
module.exports.buildDateKeyboard = buildDateKeyboard;
module.exports.showDateVariantPicker = showDateVariantPicker;
module.exports.humanDateLabel = humanDateLabel;
module.exports.dismissKeyboard = dismissKeyboard;
