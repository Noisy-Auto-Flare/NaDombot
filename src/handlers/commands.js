const { getHomeworkForDate, getHomeworkForWeek, formatHomework } = require('../utils/scheduleUtils');
const { getNextWorkDay } = require('../utils/dateUtils');
const { toggleHomeworkVisibility, getHomeworkVisibilityLabel } = require('../utils/settings');
const { isAdmin } = require('../middleware/isAdmin');

/**
 * Обработчики команд бота
 */

/**
 * Команда /start - главное меню
 */
async function handleStart(ctx) {
  const admin = isAdmin(ctx);

  const keyboard = [
    [{ text: '➕ Добавить домашнее задание', callback_data: 'add_homework' }],
    [{ text: '📅 Домашнее задание на завтра', callback_data: 'homework_tomorrow' }],
    [{ text: '📆 Домашнее задание на неделю', callback_data: 'homework_week' }]
  ];

  if (admin) {
    keyboard.push([
      { text: '⚙️ Управление расписанием', callback_data: 'manage_schedule' }
    ]);
    keyboard.push([
      { text: '👥 Режим домашнего задания', callback_data: 'toggle_hw_visibility' }
    ]);
  }

  await ctx.reply(
    `👋 Привет, ${ctx.from.first_name}!\n\n` +
    `Это бот для ведения домашнего задания.\n` +
    `Выберите действие из меню:`,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

/**
 * Команда /help - справка
 */
async function handleHelp(ctx) {
  const admin = isAdmin(ctx);

  let helpText = 
    '📚 Справка по использованию бота:\n\n' +
    'Основные функции:\n' +
    '• Добавить домашнее задание - добавьте ДЗ по любому предмету\n' +
    '• Домашнее задание на завтра - просмотр ДЗ на следующий день\n' +
    '• Домашнее задание на неделю - просмотр ДЗ на всю неделю\n\n';

  if (admin) {
    helpText += 
      'Функции администратора:\n' +
      '• Управление расписанием - добавление и редактирование расписания\n\n';
  }

  helpText += 'Команды:\n' +
    '/start - Главное меню\n' +
    '/help - Эта справка';

  await ctx.reply(helpText);
}

/**
 * Обработчик кнопки "Добавить домашнее задание"
 */
async function handleAddHomework(ctx) {
  await ctx.answerCbQuery();
  await ctx.scene.enter('addHomework');
}

/**
 * Обработчик кнопки "Домашнее задание на завтра"
 * Показывает ДЗ на следующий рабочий день (пропускает выходные)
 */
async function handleHomeworkTomorrow(ctx) {
  await ctx.answerCbQuery();
  
  try {
    const nextWorkDay = getNextWorkDay(new Date());
    const homeworkData = await getHomeworkForDate(ctx.from.id, nextWorkDay);
    const formatted = formatHomework(homeworkData);

    await ctx.reply(formatted, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
        ]
      }
    });
  } catch (error) {
    console.error('Ошибка при получении домашнего задания:', error);
    await ctx.reply(
      '❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );
  }
}

/**
 * Обработчик кнопки "Домашнее задание на неделю"
 */
async function handleHomeworkWeek(ctx) {
  await ctx.answerCbQuery();
  
  try {
    const today = new Date();
    const weekHomework = await getHomeworkForWeek(ctx.from.id, today);

    if (weekHomework.length === 0) {
      await ctx.reply(
        '📅 На этой неделе нет домашнего задания.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return;
    }

    // Форматируем каждую дату
    let message = '📆 Домашнее задание на неделю:\n\n';
    
    for (const dayData of weekHomework) {
      const formatted = formatHomework(dayData);
      message += formatted + '\n';
    }

    // Разбиваем на части, если сообщение слишком длинное
    const maxLength = 4000; // Лимит Telegram
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
      
      if (currentPart) {
        parts.push(currentPart);
      }

      for (let i = 0; i < parts.length; i++) {
        await ctx.reply(parts[i], {
          reply_markup: i === parts.length - 1 ? {
            inline_keyboard: [
              [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
            ]
          } : undefined
        });
      }
    } else {
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
          ]
        }
      });
    }
  } catch (error) {
    console.error('Ошибка при получении домашнего задания на неделю:', error);
    await ctx.reply(
      '❌ Произошла ошибка при получении домашнего задания. Попробуйте позже.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );
  }
}

/**
 * Обработчик кнопки "Управление расписанием" (только для админа)
 */
async function handleManageSchedule(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ У вас нет прав администратора');
    return;
  }

  await ctx.answerCbQuery();
  await ctx.scene.enter('manageSchedule');
}

/**
 * Переключение режима видимости домашнего задания (только для админа)
 * personal — у каждого своё; shared — общее для всех.
 */
async function handleToggleHomeworkVisibility(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ У вас нет прав администратора');
    return;
  }

  await ctx.answerCbQuery();

  const newMode = await toggleHomeworkVisibility();
  const label = getHomeworkVisibilityLabel(newMode);

  await ctx.reply(
    `👥 Режим домашнего задания переключён.\n\n` +
    `Теперь домашнее задание: ${label}.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );
}

/**
 * Обработчик кнопки "Вернуться в меню"
 */
async function handleBackToMenu(ctx) {
  await ctx.answerCbQuery();
  await handleStart(ctx);
}

module.exports = {
  handleStart,
  handleHelp,
  handleAddHomework,
  handleHomeworkTomorrow,
  handleHomeworkWeek,
  handleManageSchedule,
  handleBackToMenu,
  handleToggleHomeworkVisibility
};
