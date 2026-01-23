const { Scenes } = require('telegraf');
const { Schedule } = require('../models');
const { getDayName } = require('../utils/dateUtils');
const { Op } = require('sequelize');

/**
 * Сцена для управления расписанием (только для администратора)
 * Позволяет добавлять, просматривать и удалять уроки из расписания
 */
const manageScheduleScene = new Scenes.WizardScene(
  'manageSchedule',
  async (ctx) => {
    // Обработка callback_query (кнопка "Вернуться в меню")
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery();
      return ctx.scene.leave();
    }

    // Проверка прав администратора
    const isAdmin = ctx.from.id.toString() === process.env.ADMIN_ID;
    if (!isAdmin) {
      await ctx.reply('❌ У вас нет прав администратора');
      return ctx.scene.leave();
    }

    // Шаг 1: Выбор действия
    await ctx.reply(
      '📅 Управление расписанием\n\n' +
      'Выберите действие:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Добавить урок', callback_data: 'schedule_add' }],
            [{ text: '✏️ Редактировать урок', callback_data: 'schedule_edit' }],
            [{ text: '📋 Просмотреть расписание', callback_data: 'schedule_view' }],
            [{ text: '🗑 Удалить урок', callback_data: 'schedule_delete' }],
            [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
          ]
        }
      }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Обработка выбора действия через callback_query
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      const action = ctx.callbackQuery.data;

      if (action === 'back_to_menu') {
        return ctx.scene.leave();
      }

      if (action === 'schedule_add') {
        await ctx.reply(
          'Введите данные урока в формате:\n' +
          '<день_недели> <номер_урока> <название_предмета>\n\n' +
          'Пример: 0 1 Математика\n\n' +
          'Дни недели: 0-Понедельник, 1-Вторник, 2-Среда, 3-Четверг, 4-Пятница, 5-Суббота, 6-Воскресенье',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
              ]
            }
          }
        );
        ctx.wizard.state.action = 'add';
        return ctx.wizard.next();
      }

      if (action === 'schedule_edit') {
        // Сначала показываем расписание для выбора урока
        const schedules = await Schedule.findAll({
          order: [['dayOfWeek', 'ASC'], ['lessonNumber', 'ASC']]
        });

        if (schedules.length === 0) {
          await ctx.reply('Расписание пусто. Нечего редактировать.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
              ]
            }
          });
          return;
        }

        // Группируем по дням недели
        const byDay = {};
        schedules.forEach(s => {
          if (!byDay[s.dayOfWeek]) {
            byDay[s.dayOfWeek] = [];
          }
          byDay[s.dayOfWeek].push(s);
        });

        let message = '📅 Выберите урок для редактирования:\n\n';
        for (let day = 0; day < 7; day++) {
          if (byDay[day]) {
            message += `${getDayName(day)}:\n`;
            byDay[day].forEach(s => {
              message += `  [ID: ${s.id}] ${s.lessonNumber}. ${s.subjectName}\n`;
            });
            message += '\n';
          }
        }
        message += '\nВведите ID урока для редактирования:';

        await ctx.reply(message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        ctx.wizard.state.action = 'edit_select';
        return ctx.wizard.next();
      }

      if (action === 'schedule_cancel') {
        await ctx.reply('❌ Действие отменено.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
            ]
          }
        });
        return ctx.scene.leave();
      }

      if (action === 'schedule_view') {
        const schedules = await Schedule.findAll({
          order: [['dayOfWeek', 'ASC'], ['lessonNumber', 'ASC']]
        });

        if (schedules.length === 0) {
          await ctx.reply('Расписание пусто.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
              ]
            }
          });
          return;
        }

        // Группируем по дням недели
        const byDay = {};
        schedules.forEach(s => {
          if (!byDay[s.dayOfWeek]) {
            byDay[s.dayOfWeek] = [];
          }
          byDay[s.dayOfWeek].push(s);
        });

        let message = '📅 Расписание на неделю:\n\n';
        for (let day = 0; day < 7; day++) {
          if (byDay[day]) {
            message += `${getDayName(day)}:\n`;
            byDay[day].forEach(s => {
              message += `  [ID: ${s.id}] ${s.lessonNumber}. ${s.subjectName}\n`;
            });
            message += '\n';
          }
        }

        await ctx.reply(message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
            ]
          }
        });
        return;
      }

      if (action === 'schedule_delete') {
        await ctx.reply(
          'Введите ID урока для удаления (ID можно увидеть в просмотре расписания):',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
              ]
            }
          }
        );
        ctx.wizard.state.action = 'delete';
        return ctx.wizard.next();
      }

      if (action === 'schedule_back') {
        // Возвращаемся к первому шагу
        await ctx.reply(
          '📅 Управление расписанием\n\n' +
          'Выберите действие:',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Добавить урок', callback_data: 'schedule_add' }],
                [{ text: '✏️ Редактировать урок', callback_data: 'schedule_edit' }],
                [{ text: '📋 Просмотреть расписание', callback_data: 'schedule_view' }],
                [{ text: '🗑 Удалить урок', callback_data: 'schedule_delete' }],
                [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
              ]
            }
          }
        );
        return;
      }
    }
    
    // Если это не callback_query, остаемся на том же шаге
    return;
  },
  async (ctx) => {
    // Обработка callback_query
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      const action = ctx.callbackQuery.data;

      if (action === 'back_to_menu' || action === 'schedule_cancel') {
        await ctx.reply('❌ Действие отменено.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]
            ]
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

    // Шаг 2: Обработка ввода данных
    const action = ctx.wizard.state.action;

    // Обработка выбора урока для редактирования
    if (action === 'edit_select') {
      const id = parseInt(ctx.message.text.trim());

      if (isNaN(id)) {
        await ctx.reply('❌ Неверный формат ID. Введите число.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      try {
        const schedule = await Schedule.findByPk(id);
        if (!schedule) {
          await ctx.reply('❌ Урок с таким ID не найден.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
              ]
            }
          });
          return;
        }

        // Сохраняем ID урока для редактирования
        ctx.wizard.state.editId = id;
        ctx.wizard.state.editSchedule = schedule;

        await ctx.reply(
          `📝 Редактирование урока:\n\n` +
          `Текущие данные:\n` +
          `День недели: ${getDayName(schedule.dayOfWeek)} (${schedule.dayOfWeek})\n` +
          `Номер урока: ${schedule.lessonNumber}\n` +
          `Предмет: ${schedule.subjectName}\n\n` +
          `Введите новые данные в формате:\n` +
          `<день_недели> <номер_урока> <название_предмета>\n\n` +
          `Пример: 0 1 Математика\n\n` +
          `Дни недели: 0-Понедельник, 1-Вторник, 2-Среда, 3-Четверг, 4-Пятница, 5-Суббота, 6-Воскресенье`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
              ]
            }
          }
        );
        ctx.wizard.state.action = 'edit';
        return;
      } catch (error) {
        console.error('Ошибка при поиске урока для редактирования:', error);
        await ctx.reply('❌ Произошла ошибка. Попробуйте позже.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return ctx.wizard.back();
      }
    }

    // Обработка редактирования урока
    if (action === 'edit') {
      const input = ctx.message.text.trim();
      const parts = input.split(' ');

      if (parts.length < 3) {
        await ctx.reply('❌ Неверный формат. Попробуйте еще раз:\n<день_недели> <номер_урока> <название_предмета>', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      const dayOfWeek = parseInt(parts[0]);
      const lessonNumber = parseInt(parts[1]);
      const subjectName = parts.slice(2).join(' ');

      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        await ctx.reply('❌ Неверный день недели. Используйте числа от 0 до 6.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      if (isNaN(lessonNumber) || lessonNumber < 1 || lessonNumber > 7) {
        await ctx.reply('❌ Неверный номер урока. Используйте числа от 1 до 7.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      try {
        const editId = ctx.wizard.state.editId;
        const schedule = await Schedule.findByPk(editId);
        
        if (!schedule) {
          await ctx.reply('❌ Урок не найден.');
          return ctx.wizard.back();
        }

        // Проверяем, не занят ли этот слот другим уроком (кроме редактируемого)
        const existing = await Schedule.findOne({
          where: {
            dayOfWeek: dayOfWeek,
            lessonNumber: lessonNumber,
            id: {
              [Op.ne]: editId
            }
          }
        });

        if (existing) {
          await ctx.reply(
            `❌ Этот слот уже занят другим уроком:\n` +
            `${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\n` +
            `Выберите другой слот.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
                ]
              }
            }
          );
          return;
        }

        // Обновляем урок
        await schedule.update({
          dayOfWeek: dayOfWeek,
          lessonNumber: lessonNumber,
          subjectName: subjectName
        });

        await ctx.reply(
          `✅ Урок успешно отредактирован!\n\n` +
          `ID: ${schedule.id}\n` +
          `${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
              ]
            }
          }
        );
        return ctx.wizard.back();
      } catch (error) {
        console.error('Ошибка при редактировании урока:', error);
        await ctx.reply('❌ Произошла ошибка при редактировании урока: ' + error.message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
            ]
          }
        });
        return ctx.wizard.back();
      }
    }

    if (action === 'add') {
      const input = ctx.message.text.trim();
      const parts = input.split(' ');

      if (parts.length < 3) {
        await ctx.reply('❌ Неверный формат. Попробуйте еще раз:\n<день_недели> <номер_урока> <название_предмета>', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      const dayOfWeek = parseInt(parts[0]);
      const lessonNumber = parseInt(parts[1]);
      const subjectName = parts.slice(2).join(' ');

      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        await ctx.reply('❌ Неверный день недели. Используйте числа от 0 до 6.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      if (isNaN(lessonNumber) || lessonNumber < 1 || lessonNumber > 7) {
        await ctx.reply('❌ Неверный номер урока. Используйте числа от 1 до 7.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      try {
        // Проверяем, не существует ли уже такой урок
        const existing = await Schedule.findOne({
          where: {
            dayOfWeek: dayOfWeek,
            lessonNumber: lessonNumber
          }
        });

        if (existing) {
          await ctx.reply(
            `❌ Урок уже существует:\n` +
            `${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\n` +
            `Используйте удаление для изменения.`
          );
          return ctx.wizard.back();
        }

        await Schedule.create({
          dayOfWeek: dayOfWeek,
          lessonNumber: lessonNumber,
          subjectName: subjectName
        });

        const newSchedule = await Schedule.findOne({
          where: {
            dayOfWeek: dayOfWeek,
            lessonNumber: lessonNumber
          }
        });

        await ctx.reply(
          `✅ Урок успешно добавлен!\n\n` +
          `ID: ${newSchedule.id}\n` +
          `${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
              ]
            }
          }
        );
        return ctx.wizard.back();
      } catch (error) {
        console.error('Ошибка при добавлении урока:', error);
        await ctx.reply('❌ Произошла ошибка при добавлении урока.');
        return ctx.wizard.back();
      }
    }

    if (action === 'delete') {
      const id = parseInt(ctx.message.text.trim());

      if (isNaN(id)) {
        await ctx.reply('❌ Неверный формат ID. Введите число.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
            ]
          }
        });
        return;
      }

      try {
        const { Homework } = require('../models');
        const schedule = await Schedule.findByPk(id);
        if (!schedule) {
          await ctx.reply('❌ Урок с таким ID не найден.');
          return ctx.wizard.back();
        }

        const deletedSubject = schedule.subjectName;
        const deletedDay = schedule.dayOfWeek;
        const deletedLesson = schedule.lessonNumber;
        
        // Удаляем все связанные домашние задания
        const deletedCount = await Homework.destroy({
          where: {
            scheduleId: id
          }
        });
        
        // Теперь удаляем сам урок
        await schedule.destroy();
        
        let message = `✅ Урок удален:\n` +
          `${getDayName(deletedDay)}, ${deletedLesson} урок: ${deletedSubject}`;
        
        if (deletedCount > 0) {
          message += `\n\n🗑 Также удалено ${deletedCount} связанных домашних заданий.`;
        }
        
        await ctx.reply(message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'schedule_back' }]
            ]
          }
        });
        return ctx.wizard.back();
      } catch (error) {
        console.error('Ошибка при удалении урока:', error);
        await ctx.reply('❌ Произошла ошибка при удалении урока: ' + error.message);
        return ctx.wizard.back();
      }
    }
  }
);

module.exports = manageScheduleScene;
