const logger = require('../utils/logger');
const { getHomeworkForDate, getHomeworkForWeek, formatHomework, getTagContext, MESSAGE_CHUNK_LIMIT } = require('../utils/scheduleUtils');
const { getNextWorkDay } = require('../utils/dateUtils');
const { toggleHomeworkVisibility, getHomeworkVisibilityLabel } = require('../utils/settings');
const { isAdmin } = require('../middleware/isAdmin');
const { getMoscowNow, getMoscowToday } = require('../utils/moscowTime');
const { resolveCurrentLesson } = require('../utils/lessonResolver');
const { formatCurrentLessonMessage } = require('../utils/lessonFormatter');
const LessonTimeService = require('../services/LessonTimeService');
const scheduleService = require('../services/scheduleService');

async function handleStart(ctx) {
  const admin = isAdmin(ctx);
  const keyboard = [
    [{ text: '➕ Добавить домашнее задание', callback_data: 'add_homework' }],
    [{ text: '✚ Добавить ДЗ на дату', callback_data: 'add_homework_on_date' }],
    [{ text: '📅 Домашнее задание на завтра', callback_data: 'homework_tomorrow' }],
    [{ text: '📆 Домашнее задание на неделю', callback_data: 'homework_week' }],
    [{ text: '📜 История', callback_data: 'history' }],
    [{ text: '🏫 В каком кабинете урок', callback_data: 'current_lesson' }]
  ];
  let profileSummaryLine = '';
  // onboarding button if multiprofile enabled and no profile, plus summary
  try {
    const { isMultiprofileEnabled } = require('../utils/settings');
    const { getUserProfile } = require('../utils/userProfile');
    const enabled = await isMultiprofileEnabled();
    if (enabled && ctx.from && ctx.from.id) {
      const profile = await getUserProfile(ctx.from.id);
      if (!profile) {
        keyboard.unshift([{ text: '👋 Выберите профиль', callback_data: 'select_profile' }]);
      } else {
        // краткий summary: 10А • Тех • Белова
        let trackShort = profile.trackId || '—';
        let subShort = profile.subgroupId || '—';
        try {
          const { Track, Subgroup } = require('../models');
          if (profile.trackId) {
            const t = await Track.findByPk(profile.trackId);
            trackShort = t ? t.name : profile.trackId;
          } else {
            trackShort = 'Общий';
          }
          if (profile.subgroupId) {
            const s = await Subgroup.findByPk(profile.subgroupId);
            subShort = s ? s.teacher || s.name || s.id : profile.subgroupId;
          } else {
            subShort = '—';
          }
        } catch (_e) {
          // fallback to ids
        }
        profileSummaryLine = `\n👤 ${profile.classId} • ${trackShort} • ${subShort}\n`;
        // ensure Профиль button exists
        keyboard.push([{ text: '👤 Профиль', callback_data: 'profile' }]);
      }
    }
  } catch (_e) {
    // ignore
  }
  // всегда показываем кнопку Профиль если multiprofile не проверялся (fallback)
  if (!keyboard.some((row) => row[0] && row[0].callback_data === 'profile')) {
    try {
      const { isMultiprofileEnabled } = require('../utils/settings');
      const enabled = await isMultiprofileEnabled();
      if (enabled) keyboard.push([{ text: '👤 Профиль', callback_data: 'profile' }]);
    } catch (_e) { void _e; }
  }
  if (admin) {
    keyboard.push([{ text: '⚙️ Управление', callback_data: 'admin_manage' }]);
  }
  const greeting =
    `👋 Привет, ${ctx.from.first_name}!\n` +
    (profileSummaryLine ? profileSummaryLine : '') +
    `\nЭто бот для ведения домашнего задания.\n` +
    `Выберите действие из меню:`;
  await ctx.reply(greeting, { reply_markup: { inline_keyboard: keyboard } });
}

/**
 * Показать карточку профиля с inline-кнопками редактирования.
 * @param {object} ctx
 */
async function handleProfile(ctx) {
  try {
    const { getUserProfile } = require('../utils/userProfile');
    const { Class, Track, Subgroup } = require('../models');
    const profile = await getUserProfile(ctx.from.id);
    if (!profile) {
      await ctx.reply('❌ Профиль не выбран. Выберите класс, профиль и учителя:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👋 Выбрать профиль', callback_data: 'select_profile' }],
            [{ text: '🔙 Меню', callback_data: 'back_to_menu' }]
          ]
        }
      });
      return;
    }
    // загрузить человекочитаемые названия
    let classLabel = profile.classId;
    try {
      const c = await Class.findByPk(profile.classId);
      if (c) classLabel = c.id;
    } catch (_e) { void _e; }
    let trackLabel = 'Общий';
    let trackIdPart = '';
    if (profile.trackId) {
      try {
        const t = await Track.findByPk(profile.trackId);
        if (t) {
          trackLabel = t.name;
          trackIdPart = ` (${t.id})`;
        } else {
          trackLabel = profile.trackId;
          trackIdPart = ` (${profile.trackId})`;
        }
      } catch (_e) {
        trackLabel = profile.trackId;
        trackIdPart = ` (${profile.trackId})`;
      }
    }
    let subgroupLabel = 'Без группы';
    if (profile.subgroupId) {
      try {
        const s = await Subgroup.findByPk(profile.subgroupId);
        if (s) subgroupLabel = s.teacher || s.name || s.id;
        else subgroupLabel = profile.subgroupId;
      } catch (_e) {
        subgroupLabel = profile.subgroupId;
      }
    }
    const scopeLabel = profile.scope === 'all' ? 'Всё (наблюдатель)' : 'Моё';
    const toggleLabel = profile.scope === 'all' ? '👁 Переключить: Моё' : '👁 Переключить: Всё';
    const text =
      '👤 Ваш профиль\n' +
      `🏫 Класс: ${classLabel}\n` +
      `🧬 Профиль: ${trackLabel}${trackIdPart}\n` +
      `👩‍🏫 Английский: ${subgroupLabel}\n` +
      `👁 Режим: ${scopeLabel}\n` +
      '\nВыберите что изменить:';
    const keyboard = [
      [{ text: '🏫 Изменить класс', callback_data: 'profile_edit_class' }],
      [{ text: '🧬 Изменить профиль', callback_data: 'profile_edit_track' }],
      [{ text: '👩‍🏫 Изменить учителя', callback_data: 'profile_edit_subgroup' }],
      [{ text: toggleLabel, callback_data: 'profile_toggle_scope' }],
      [{ text: '🔄 Сбросить профиль', callback_data: 'profile_reset' }],
      [{ text: '🔙 Меню', callback_data: 'back_to_menu' }]
    ];
    await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
  } catch (e) {
    logger.error('handleProfile', e.message || e);
    await ctx.reply('❌ Ошибка при получении профиля. Попробуйте позже.');
  }
}

/**
 * Редактирование класса — re-enter selectProfile с edit=class
 * @param {object} ctx
 */
async function handleProfileEditClass(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('selectProfile', { edit: 'class' });
}

/**
 * Редактирование профиля (track)
 * @param {object} ctx
 */
async function handleProfileEditTrack(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('selectProfile', { edit: 'track' });
}

/**
 * Редактирование подгруппы учителя
 * @param {object} ctx
 */
async function handleProfileEditSubgroup(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('selectProfile', { edit: 'subgroup' });
}

/**
 * Тоггл персонального охвата 👁 Моё / Всё (P2 §3.1).
 * Возврат на «Моё» без выбранного профиля (track+subgroup пусты) →
 * частичный онбординг через существующий editMode.
 * @param {object} ctx
 */
async function handleProfileToggleScope(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { getUserProfile, setUserScope } = require('../utils/userProfile');
    const profile = await getUserProfile(ctx.from.id);
    if (!profile) {
      await ctx.reply('❌ Профиль не выбран. Выберите класс, профиль и учителя:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👋 Выбрать профиль', callback_data: 'select_profile' }],
            [{ text: '🔙 Меню', callback_data: 'back_to_menu' }]
          ]
        }
      });
      return;
    }
    const nextScope = profile.scope === 'all' ? 'own' : 'all';
    await setUserScope(ctx.from.id, nextScope);
    if (nextScope === 'own' && !profile.trackId && !profile.subgroupId) {
      // в «Моём» нужны поля профиля — частичный онбординг (существующий editMode)
      await ctx.reply('👁 Режим «Моё»: теперь выбери свой профиль');
      await ctx.scene.enter('selectProfile', { edit: 'track' });
      return;
    }
    await ctx.reply(nextScope === 'all' ? '👀 Включён режим «Видеть всё»' : '📚 Включён режим «Моё»');
    await handleProfile(ctx);
  } catch (e) {
    logger.error('handleProfileToggleScope', e.message || e);
    await ctx.reply('❌ Не удалось переключить режим. Попробуйте позже.');
  }
}

/**
 * Сброс профиля — удаление UserProfile + денорма User
 * @param {object} ctx
 */
async function handleProfileReset(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { UserProfile, User } = require('../models');
    const uid = ctx.from.id;
    try {
      const p = await UserProfile.findByPk(uid);
      if (p) await p.destroy();
      else {
        const p2 = await UserProfile.findByPk(String(uid));
        if (p2) await p2.destroy();
      }
    } catch (_e) {
      // fallback direct destroy
      try {
        await UserProfile.destroy({ where: { userId: uid } });
      } catch (_e2) { void _e2; }
      try {
        await UserProfile.destroy({ where: { userId: String(uid) } });
      } catch (_e3) { void _e3; }
    }
    try {
      await User.update({ classId: null, trackId: null, subgroupId: null }, { where: { userId: uid } });
    } catch (_e) {
      try {
        await User.update({ classId: null, trackId: null, subgroupId: null }, { where: { userId: String(uid) } });
      } catch (_e2) { void _e2; }
    }
    await ctx.reply('🗑 Профиль сброшен', {
      reply_markup: { inline_keyboard: [[{ text: '👋 Выбрать профиль', callback_data: 'select_profile' }], [{ text: '🔙 Меню', callback_data: 'back_to_menu' }]] }
    });
  } catch (e) {
    logger.error('handleProfileReset', e.message || e);
    await ctx.reply('❌ Не удалось сбросить профиль. Попробуйте позже.');
  }
}

async function handleHelp(ctx) {
  const admin = isAdmin(ctx);
  let helpText =
    '📚 Справка по использованию бота:\n\n' +
    'Основные функции:\n' +
    '• Добавить домашнее задание - добавьте ДЗ по любому предмету\n' +
    '• Добавить ДЗ на дату - добавьте ДЗ на выбранную дату из ближайших 2 недель\n' +
    '• Домашнее задание на завтра - просмотр ДЗ на следующий день\n' +
    '• Домашнее задание на неделю - просмотр ДЗ на всю неделю\n' +
    '• История - прошлые задания (недели/месяцы назад)\n\n';
  if (admin) {
    helpText +=
      'Функции администратора:\n' +
      '• Управление расписанием - добавление и редактирование расписания\n\n';
  }
  helpText += 'Команды:\n' + '/start - Главное меню\n' + '/help - Эта справка';
  await ctx.reply(helpText);
}

async function handleAddHomework(ctx) {
  await ctx.answerCbQuery();
  await ctx.scene.enter('addHomework');
}

async function handleAddHomeworkOnDate(ctx) {
  await ctx.answerCbQuery();
  await ctx.scene.enter('addHomeworkOnDate');
}

async function handleHomeworkTomorrow(ctx) {
  await ctx.answerCbQuery();
  try {
    // База «завтра» — московская календарная дата, не instant «сейчас»
    const nextWorkDay = getNextWorkDay(getMoscowToday());
    const homeworkData = await getHomeworkForDate(ctx.from.id, nextWorkDay);
    const tagCtx = await getTagContext().catch(() => null);
    const formatted = formatHomework(homeworkData, tagCtx);
    await ctx.reply(formatted, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  } catch (error) {
    logger.error('Ошибка при получении домашнего задания:', error);
    await ctx.reply('❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

async function handleHomeworkWeek(ctx) {
  await ctx.answerCbQuery();
  try {
    // База недели — московская календарная дата, не instant «сейчас»
    const today = getMoscowToday();
    const weekHomework = await getHomeworkForWeek(ctx.from.id, today);
    if (weekHomework.length === 0) {
      await ctx.reply('📅 На этой неделе нет домашнего задания.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
      });
      return;
    }
    let message = '📆 Домашнее задание на неделю:\n\n';
    const tagCtx = await getTagContext().catch(() => null);
    for (const dayData of weekHomework) {
      const formatted = formatHomework(dayData, tagCtx);
      message += formatted + '\n';
    }
    const maxLength = MESSAGE_CHUNK_LIMIT;
    if (message.length > maxLength) {
      const parts = [];
      let currentPart = '';
      for (const dayData of weekHomework) {
        const dayText = formatHomework(dayData, tagCtx) + '\n\n';
        if (currentPart.length + dayText.length > maxLength) {
          parts.push(currentPart);
          currentPart = dayText;
        } else {
          currentPart += dayText;
        }
      }
      if (currentPart) parts.push(currentPart);
      for (let i = 0; i < parts.length; i++) {
        await ctx.reply(parts[i], {
          reply_markup: i === parts.length - 1 ? { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] } : undefined
        });
      }
    } else {
      await ctx.reply(message, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
      });
    }
  } catch (error) {
    logger.error('Ошибка при получении домашнего задания на неделю:', error);
    await ctx.reply('❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

async function handleAdminManage(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ У вас нет прав администратора');
    return;
  }
  await ctx.answerCbQuery();
  await ctx.scene.enter('manageSchedule');
}

// @deprecated alias — оставлен для совместимости
const handleManageSchedule = handleAdminManage;

async function handleToggleHomeworkVisibility(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ У вас нет прав администратора');
    return;
  }
  await ctx.answerCbQuery();
  const newMode = await toggleHomeworkVisibility();
  const label = getHomeworkVisibilityLabel(newMode);
  await ctx.reply(`👥 Режим домашнего задания переключён.\n\nТеперь домашнее задание: ${label}.`, {
    reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
  });
}

async function handleCurrentLesson(ctx) {
  await ctx.answerCbQuery();
  try {
    const moscowNow = getMoscowNow(new Date());
    const bellMap = await LessonTimeService.getBellScheduleMap();
    const allRows = await scheduleService.findAll();
    let todayRows = allRows.filter((r) => r.dayOfWeek === moscowNow.dayOfWeek);
    // Аудиторий-фильтрация если multiprofile включен
    try {
      const { isMultiprofileEnabled } = require('../utils/settings');
      const enabled = await isMultiprofileEnabled();
      if (enabled) {
        const { UserProfile } = require('../models');
        let profile = null;
        try {
          profile = await UserProfile.findByPk(ctx.from.id);
          if (!profile) profile = await UserProfile.findByPk(String(ctx.from.id));
        } catch (_e) {
          profile = null;
        }
        if (profile) {
          const { isVisibleWithScope } = require('../utils/audience');
          todayRows = todayRows.filter((r) => isVisibleWithScope(r, profile, enabled));
        }
      }
    } catch (_e) {
      // fallback to unfiltered
    }
    const result = resolveCurrentLesson({ now: moscowNow, scheduleRows: todayRows, bellMap });
    const message = formatCurrentLessonMessage(result);
    await ctx.reply(message, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  } catch (error) {
    logger.error('Ошибка при получении текущего кабинета:', error);
    await ctx.reply('❌ Не удалось определить текущий урок. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

async function handleBackToMenu(ctx) {
  await ctx.answerCbQuery();
  await handleStart(ctx);
}

async function handleSelectProfile(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.scene.enter('selectProfile');
}

/**
 * P3 §13.3 — клавиатура навигации истории: неделя назад/вперёд + выбор месяца.
 * @param {number} weekOffset - текущее недельное окно
 * @returns {{inline_keyboard: Array}}
 */
function historyNavKeyboard(weekOffset) {
  const { getRecentMonths, HISTORY_MAX_WEEK_OFFSET } = require('../utils/history');
  const rows = [];
  const navRow = [];
  if (weekOffset < HISTORY_MAX_WEEK_OFFSET) {
    navRow.push({ text: '◀ Неделя назад', callback_data: `history_week:${weekOffset + 1}` });
  }
  if (weekOffset > 0) {
    navRow.push({ text: 'Вперёд ▶', callback_data: `history_week:${weekOffset - 1}` });
  }
  if (navRow.length) rows.push(navRow);
  const months = getRecentMonths(3).map((m) => ({ text: m.label, callback_data: m.callback }));
  // по 2 кнопки месяцев в ряд
  for (let i = 0; i < months.length; i += 2) {
    rows.push(months.slice(i, i + 2));
  }
  rows.push([{ text: '📅 Ввести дату', callback_data: 'history_date' }]);
  rows.push([{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]);
  return { inline_keyboard: rows };
}

/**
 * P3 §13.3 — отправить компактную историю чанками, клавиатура на последнем.
 * @param {object} ctx
 * @param {string} text - компактный текст истории
 * @param {{inline_keyboard: Array}} keyboard
 */
async function replyHistoryChunks(ctx, text, keyboard) {
  const { splitHistoryChunks } = require('../utils/history');
  const parts = splitHistoryChunks(text);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await ctx.reply(parts[i], last ? { reply_markup: keyboard } : undefined);
  }
}

/**
 * P3 §13.3 — вход в историю: текущее недельное окно (последние 7 дней).
 * @param {object} ctx
 */
async function handleHistory(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { getHistoryWeek, formatHistoryCompact } = require('../utils/history');
    const { days, offset } = await getHistoryWeek(ctx.from.id, 0);
    await replyHistoryChunks(ctx, formatHistoryCompact(days), historyNavKeyboard(offset));
  } catch (error) {
    logger.error('Ошибка при получении истории:', error);
    await ctx.reply('❌ Не удалось получить историю. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

/**
 * P3 §13.3 — недельное окно истории (callback history_week:<offset>).
 * @param {object} ctx
 */
async function handleHistoryWeek(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const data = (ctx.callbackQuery && ctx.callbackQuery.data) || '';
    const offset = Number(data.split(':')[1]) || 0;
    const { getHistoryWeek, formatHistoryCompact } = require('../utils/history');
    const { days, offset: real } = await getHistoryWeek(ctx.from.id, offset);
    await replyHistoryChunks(ctx, formatHistoryCompact(days), historyNavKeyboard(real));
  } catch (error) {
    logger.error('Ошибка при получении истории:', error);
    await ctx.reply('❌ Не удалось получить историю. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

/**
 * P3 §13.3 — история за календарный месяц (callback history_month:<YYYY-MM>).
 * @param {object} ctx
 */
async function handleHistoryMonth(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const data = (ctx.callbackQuery && ctx.callbackQuery.data) || '';
    const ym = (data.split(':')[1] || '').split('-');
    const year = Number(ym[0]);
    const month = Number(ym[1]);
    const { getHistoryMonth, formatHistoryCompact } = require('../utils/history');
    const { days } = await getHistoryMonth(ctx.from.id, year, month);
    await replyHistoryChunks(ctx, formatHistoryCompact(days), historyNavKeyboard(0));
  } catch (error) {
    logger.error('Ошибка при получении истории:', error);
    await ctx.reply('❌ Не удалось получить историю. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

/**
 * P3 §13.3 — ввод даты истории: промпт `ДД.ММ` (год — текущий).
 * Ставит флаг ожидания в ctx.session, следующий текст разберёт handleHistoryDateInput.
 * @param {object} ctx
 */
async function handleHistoryDate(ctx) {
  await ctx.answerCbQuery().catch(() => {});
  try {
    if (ctx.session) ctx.session.pendingHistoryDate = true;
  } catch (_e) { void _e; }
  const { HISTORY_DATE_PROMPT } = require('../utils/historyDate');
  await ctx.reply(HISTORY_DATE_PROMPT);
}

/**
 * P3 §13.3 — разбор введённой даты истории (текст вне сцен).
 * При ошибке — переспрос; при успехе — компактный вид одного дня
 * через getHistoryForRange(date, date) + formatHistoryCompact (скоуп как у остальной истории).
 * @param {object} ctx
 * @returns {Promise<boolean>} true если сообщение потреблено (был pending-флаг)
 */
async function handleHistoryDateInput(ctx) {
  let pending = false;
  try {
    pending = !!(ctx.session && ctx.session.pendingHistoryDate);
  } catch (_e) {
    pending = false;
  }
  if (!pending) return false;
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  // команды обрабатываются отдельно — флаг снимаем, сообщение не потребляем
  if (!text || text.startsWith('/')) {
    try {
      if (ctx.session) ctx.session.pendingHistoryDate = false;
    } catch (_e) { void _e; }
    return false;
  }
  const { parseHistoryDateInput, HISTORY_DATE_ERROR } = require('../utils/historyDate');
  let date;
  try {
    date = parseHistoryDateInput(text);
  } catch (_e) {
    await ctx.reply(HISTORY_DATE_ERROR);
    return true;
  }
  try {
    if (ctx.session) ctx.session.pendingHistoryDate = false;
  } catch (_e) { void _e; }
  try {
    const { getHistoryForRange, formatHistoryCompact } = require('../utils/history');
    const days = await getHistoryForRange(ctx.from.id, date, date);
    await replyHistoryChunks(ctx, formatHistoryCompact(days), historyNavKeyboard(0));
  } catch (error) {
    logger.error('Ошибка при получении истории за дату:', error);
    await ctx.reply('❌ Не удалось получить историю. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
  return true;
}

module.exports = {
  handleStart,
  handleHelp,
  handleAddHomework,
  handleAddHomeworkOnDate,
  handleHomeworkTomorrow,
  handleHomeworkWeek,
  handleManageSchedule,
  handleAdminManage,
  handleBackToMenu,
  handleToggleHomeworkVisibility,
  handleCurrentLesson,
  handleProfile,
  handleProfileToggleScope,
  handleSelectProfile,
  handleProfileEditClass,
  handleProfileEditTrack,
  handleProfileEditSubgroup,
  handleProfileReset,
  handleHistory,
  handleHistoryWeek,
  handleHistoryMonth,
  handleHistoryDate,
  handleHistoryDateInput
};
