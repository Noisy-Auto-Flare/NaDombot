const { Scenes } = require('telegraf');
const { Homework } = require('../models');
const { findNextLesson } = require('../utils/scheduleUtils');
const { formatDate, getDayName, getDayOfWeek } = require('../utils/dateUtils');
const scheduleService = require('../services/scheduleService');
const { getRecentLessonRows } = require('../utils/recentLessons');

/**
 * Сцена для добавления домашнего задания
 * Шаг 1: Пользователь вводит название предмета
 * Шаг 2: Бот находит ближайший урок и спрашивает подтверждение
 * Шаг 3: Пользователь вводит текст домашнего задания
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
      quickRows = await getRecentLessonRows({ limit: 4, now: new Date() });
    } catch (e) {
      console.error('quick rows error', e);
      quickRows = [];
    }
    const keyboard = [];
    for (const row of quickRows) {
      keyboard.push([{ text: `📚 ${row.subjectName} (${row.lessonNumber} урок)`, callback_data: `quick:${row.id}` }]);
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

      if (data.startsWith('quick:')) {
        const id = Number(data.split(':')[1]);
        let row;
        try {
          row = await scheduleService.findById(id);
        } catch (e) {
          console.error('quick lookup error', e);
          row = null;
        }
        if (!row) {
          await ctx.answerCbQuery('❌ Урок не найден');
          return;
        }
        await ctx.answerCbQuery();
        const subjectName = row.subjectName;
        ctx.wizard.state.subjectName = subjectName;
        try {
          const nextLesson = await findNextLesson(subjectName, new Date());
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
          const { schedule, date } = nextLesson;
          ctx.wizard.state.scheduleId = schedule.id;
          ctx.wizard.state.date = date;
          const dayOfWeek = getDayOfWeek(date);
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
        } catch (error) {
          console.error('Ошибка при поиске урока:', error);
          await ctx.reply('❌ Произошла ошибка при поиске урока. Попробуйте позже.', {
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
            }
          });
          return ctx.scene.leave();
        }
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

    // Сохраняем название предмета
    const subjectName = ctx.message.text.trim();
    ctx.wizard.state.subjectName = subjectName;

    try {
      // Ищем ближайший урок по этому предмету
      const nextLesson = await findNextLesson(subjectName, new Date());

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

      const { schedule, date } = nextLesson;
      ctx.wizard.state.scheduleId = schedule.id;
      ctx.wizard.state.date = date;

      const dayOfWeek = getDayOfWeek(date);
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
    } catch (error) {
      console.error('Ошибка при поиске урока:', error);
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
    const { scheduleId, date, subjectName } = ctx.wizard.state;

    if (!content || content.length === 0) {
      await ctx.reply('❌ Текст домашнего задания не может быть пустым. Попробуйте еще раз:', {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
        }
      });
      return; // Остаемся на том же шаге
    }

    try {
      // Сохраняем домашнее задание
      await Homework.create({
        userId: ctx.from.id,
        scheduleId: scheduleId,
        date: date.toISOString().split('T')[0],
        content: content
      });

      const dayOfWeek = getDayOfWeek(date);
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
      console.error('Ошибка при сохранении домашнего задания:', error);
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
