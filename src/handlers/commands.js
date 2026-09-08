const { getHomeworkForDate, getHomeworkForWeek, formatHomework } = require('../utils/scheduleUtils');
const { getNextWorkDay } = require('../utils/dateUtils');
const { toggleHomeworkVisibility, getHomeworkVisibilityLabel } = require('../utils/settings');
const { isAdmin } = require('../middleware/isAdmin');
const { getMoscowNow } = require('../utils/moscowTime');
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
    [{ text: '🏫 В каком кабинете урок', callback_data: 'current_lesson' }]
  ];
  // onboarding button if multiprofile enabled and no profile
  try {
    const { isMultiprofileEnabled } = require('../utils/settings');
    const { getUserProfile } = require('../utils/userProfile');
    const enabled = await isMultiprofileEnabled();
    if (enabled && ctx.from && ctx.from.id) {
      const profile = await getUserProfile(ctx.from.id);
      if (!profile) {
        keyboard.unshift([{ text: '👋 Выберите профиль', callback_data: 'select_profile' }]);
      }
    }
  } catch (_e) {
    // ignore
  }
  if (admin) {
    keyboard.push([{ text: '⚙️ Управление расписанием', callback_data: 'manage_schedule' }]);
    keyboard.push([{ text: '👥 Режим домашнего задания', callback_data: 'toggle_hw_visibility' }]);
  }
  await ctx.reply(
    `👋 Привет, ${ctx.from.first_name}!\n\n` +
    `Это бот для ведения домашнего задания.\n` +
    `Выберите действие из меню:`,
    { reply_markup: { inline_keyboard: keyboard } }
  );
}

/**
 * Показать текущий профиль и кнопку изменить.
 * @param {object} ctx
 */
async function handleProfile(ctx) {
  try {
    const { getUserProfile } = require('../utils/userProfile');
    const { Track, Subgroup } = require('../models');
    const profile = await getUserProfile(ctx.from.id);
    if (!profile) {
      await ctx.reply('👤 Профиль не выбран.\n\nНажмите кнопку ниже чтобы выбрать.', {
        reply_markup: { inline_keyboard: [[{ text: '👋 Выберите профиль', callback_data: 'select_profile' }]] }
      });
      return;
    }
    let trackLabel = 'Общий';
    if (profile.trackId) {
      try {
        const t = await Track.findByPk(profile.trackId);
        trackLabel = t ? t.name : profile.trackId;
      } catch (_e) {
        trackLabel = profile.trackId;
      }
    }
    let subgroupLabel = 'Без группы';
    if (profile.subgroupId) {
      try {
        const s = await Subgroup.findByPk(profile.subgroupId);
        subgroupLabel = s ? s.teacherName || s.id : profile.subgroupId;
      } catch (_e) {
        subgroupLabel = profile.subgroupId;
      }
    }
    await ctx.reply(`👤 Ваш профиль: ${profile.classId} ${trackLabel} ${subgroupLabel}`, {
      reply_markup: { inline_keyboard: [[{ text: '✏️ Изменить', callback_data: 'select_profile' }]] }
    });
  } catch (e) {
    console.error('handleProfile', e.message || e);
    await ctx.reply('❌ Ошибка при получении профиля. Попробуйте позже.');
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
    '• Домашнее задание на неделю - просмотр ДЗ на всю неделю\n\n';
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
    const nextWorkDay = getNextWorkDay(new Date());
    const homeworkData = await getHomeworkForDate(ctx.from.id, nextWorkDay);
    const formatted = formatHomework(homeworkData);
    await ctx.reply(formatted, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  } catch (error) {
    console.error('Ошибка при получении домашнего задания:', error);
    await ctx.reply('❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

async function handleHomeworkWeek(ctx) {
  await ctx.answerCbQuery();
  try {
    const today = new Date();
    const weekHomework = await getHomeworkForWeek(ctx.from.id, today);
    if (weekHomework.length === 0) {
      await ctx.reply('📅 На этой неделе нет домашнего задания.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
      });
      return;
    }
    let message = '📆 Домашнее задание на неделю:\n\n';
    for (const dayData of weekHomework) {
      const formatted = formatHomework(dayData);
      message += formatted + '\n';
    }
    const maxLength = 4000;
    if (message.length > maxLength) {
      const parts = [];
      let currentPart = '';
      for (const dayData of weekHomework) {
        const dayText = formatHomework(dayData) + '\n\n';
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
    console.error('Ошибка при получении домашнего задания на неделю:', error);
    await ctx.reply('❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]] }
    });
  }
}

async function handleManageSchedule(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ У вас нет прав администратора');
    return;
  }
  await ctx.answerCbQuery();
  await ctx.scene.enter('manageSchedule');
}

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
          const { isVisible } = require('../utils/audience');
          todayRows = todayRows.filter((r) => isVisible(r, profile));
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
    console.error('Ошибка при получении текущего кабинета:', error);
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

module.exports = {
  handleStart,
  handleHelp,
  handleAddHomework,
  handleAddHomeworkOnDate,
  handleHomeworkTomorrow,
  handleHomeworkWeek,
  handleManageSchedule,
  handleBackToMenu,
  handleToggleHomeworkVisibility,
  handleCurrentLesson,
  handleProfile,
  handleSelectProfile
};
