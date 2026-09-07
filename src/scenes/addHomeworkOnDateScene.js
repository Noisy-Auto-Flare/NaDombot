const { Scenes } = require('telegraf');
const { Homework } = require('../models');
const scheduleService = require('../services/scheduleService');
const { getMoscowNow, getMoscowDayOfWeek } = require('../utils/moscowTime');
const { formatDate, getDayName } = require('../utils/dateUtils');
const { getRecentLessonRows } = require('../utils/recentLessons');

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
 * Показывает только даты где есть урок (начиная с завтра), без серых кнопок
 * @param {Array} schedules - все Schedule по предмету (отфильтрованные по subjectsMatch)
 * @param {Date} baseDate - базовый Date (12:00) московской сегодняшней даты
 * @returns {Array<Array<{text:string,callback_data:string}>>|null} null если нет дат с уроком
 */
function buildDateKeyboard(schedules, baseDate) {
  const buttons = [];

  for (let i = 1; i <= 14; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);

    const dayOfWeek = getMoscowDayOfWeek(d);
    const matching = schedules.filter((s) => s.dayOfWeek === dayOfWeek).sort((a, b) => a.lessonNumber - b.lessonNumber);

    if (matching.length === 0) continue;

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${getShortDayName(dayOfWeek)} ${dd}.${mm}`;

    buttons.push({
      text: label,
      callback_data: `hw_date:${isoDate}:${matching[0].id}`
    });
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
 * Сцена выбора даты для домашнего задания
 * Шаг 1: ввод предмета
 * Шаг 2: выбор даты из 14 дней (только дни с уроком кликабельны)
 * Шаг 3: ввод текста домашки
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
    // Обработка callback_query (выбор даты / отмена)
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

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
          const schedules = await scheduleService.findBySubjectNormalized(subjectName);
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
          const keyboard = buildDateKeyboard(schedules, baseDate);
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
          console.error('Ошибка при поиске предмета:', error);
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

          // Сохраняем выбор
          const date = new Date(isoDate);
          ctx.wizard.state.scheduleId = schedule.id;
          ctx.wizard.state.date = date;
          ctx.wizard.state.selectedSchedule = schedule;
          // subjectName уже сохранён на этапе ввода предмета

          await ctx.answerCbQuery();

          const dayOfWeek = getMoscowDayOfWeek(date);
          await ctx.reply(
            `📝 Теперь введите текст домашнего задания для ${schedule.subjectName} на ${getDayName(dayOfWeek)}, ${formatDate(date)} (${schedule.lessonNumber} урок):`,
            {
              reply_markup: {
                inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
              }
            }
          );
          return ctx.wizard.next();
        } catch (error) {
          console.error('Ошибка при выборе даты:', error);
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

    // Проверяем текстовое сообщение — ввод названия предмета
    if (!ctx.message || !ctx.message.text) {
      return;
    }

    const subjectName = ctx.message.text.trim();
    ctx.wizard.state.subjectName = subjectName;

    try {
      const schedules = await scheduleService.findBySubjectNormalized(subjectName);

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

      const keyboard = buildDateKeyboard(schedules, baseDate);

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
      // Остаёмся на этом же шаге — ждём callback с выбором даты
      return;
    } catch (error) {
      console.error('Ошибка при поиске предмета:', error);
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
    const { scheduleId, date, subjectName, selectedSchedule } = ctx.wizard.state;

    if (!content || content.length === 0) {
      await ctx.reply('❌ Текст домашнего задания не может быть пустым. Попробуйте еще раз:', {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
        }
      });
      return;
    }

    try {
      await Homework.create({
        userId: ctx.from.id,
        scheduleId: scheduleId,
        date: date.toISOString().split('T')[0],
        content: content
      });

      const dayOfWeek = getMoscowDayOfWeek(date);
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

module.exports = addHomeworkOnDateScene;
