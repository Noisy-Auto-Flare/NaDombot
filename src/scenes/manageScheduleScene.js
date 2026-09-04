const { Scenes } = require('telegraf');
const { getDayName } = require('../utils/dateUtils');
const scheduleService = require('../services/scheduleService');
const { parseLessonInput } = require('../utils/scheduleValidator');
const { groupByDay, formatWeeklySchedule, formatScheduleForEdit } = require('../utils/scheduleFormatter');
const { isAdmin } = require('../middleware/isAdmin');
const { cancelKeyboard, backKeyboard, backToMenuKeyboard, manageScheduleKeyboard } = require('../utils/keyboards');

/**
 * Сцена управления расписанием (только для администратора)
 */
const manageScheduleScene = new Scenes.WizardScene(
  'manageSchedule',
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery();
      return ctx.scene.leave();
    }
    if (!isAdmin(ctx)) {
      await ctx.reply('❌ У вас нет прав администратора');
      return ctx.scene.leave();
    }
    await ctx.reply('📅 Управление расписанием\n\nВыберите действие:', manageScheduleKeyboard);
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery) return;
    await ctx.answerCbQuery();
    const action = ctx.callbackQuery.data;

    if (action === 'back_to_menu') return ctx.scene.leave();

    if (action === 'schedule_add') {
      await ctx.reply(
        'Введите данные урока в формате:\n<день_недели> <номер_урока> <название_предмета>\n\nПример: 0 1 Математика\n\nДни недели: 0-Понедельник, 1-Вторник, 2-Среда, 3-Четверг, 4-Пятница, 5-Суббота, 6-Воскресенье',
        cancelKeyboard,
      );
      ctx.wizard.state.action = 'add';
      return ctx.wizard.next();
    }

    if (action === 'schedule_edit') {
      const schedules = await scheduleService.findAll();
      if (schedules.length === 0) {
        await ctx.reply('Расписание пусто. Нечего редактировать.', backKeyboard);
        return;
      }
      const grouped = groupByDay(schedules);
      await ctx.reply(formatScheduleForEdit(grouped), cancelKeyboard);
      ctx.wizard.state.action = 'edit_select';
      return ctx.wizard.next();
    }

    if (action === 'schedule_cancel') {
      await ctx.reply('❌ Действие отменено.', backToMenuKeyboard);
      return ctx.scene.leave();
    }

    if (action === 'schedule_view') {
      const schedules = await scheduleService.findAll();
      if (schedules.length === 0) {
        await ctx.reply('Расписание пусто.', backKeyboard);
        return;
      }
      const grouped = groupByDay(schedules);
      await ctx.reply(formatWeeklySchedule(grouped), backKeyboard);
      return;
    }

    if (action === 'schedule_delete') {
      await ctx.reply('Введите ID урока для удаления (ID можно увидеть в просмотре расписания):', cancelKeyboard);
      ctx.wizard.state.action = 'delete';
      return ctx.wizard.next();
    }

    if (action === 'schedule_back') {
      await ctx.reply('📅 Управление расписанием\n\nВыберите действие:', manageScheduleKeyboard);
    }
  },
  async (ctx) => {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      const a = ctx.callbackQuery.data;
      if (a === 'back_to_menu' || a === 'schedule_cancel') {
        await ctx.reply('❌ Действие отменено.', backToMenuKeyboard);
        return ctx.scene.leave();
      }
      return;
    }
    if (!ctx.message || !ctx.message.text) return;

    const action = ctx.wizard.state.action;

    if (action === 'edit_select') return handleEditSelect(ctx);
    if (action === 'edit') return handleEdit(ctx);
    if (action === 'add') return handleAdd(ctx);
    if (action === 'delete') return handleDelete(ctx);
  },
);

async function handleEditSelect(ctx) {
  const id = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(id)) {
    await ctx.reply('❌ Неверный формат ID. Введите число.', cancelKeyboard);
    return;
  }
  try {
    const schedule = await scheduleService.findById(id);
    if (!schedule) {
      await ctx.reply('❌ Урок с таким ID не найден.', cancelKeyboard);
      return;
    }
    ctx.wizard.state.editId = id;
    await ctx.reply(
      `📝 Редактирование урока:\n\nТекущие данные:\nДень недели: ${getDayName(schedule.dayOfWeek)} (${schedule.dayOfWeek})\nНомер урока: ${schedule.lessonNumber}\nПредмет: ${schedule.subjectName}\n\nВведите новые данные в формате:\n<день_недели> <номер_урока> <название_предмета>\n\nПример: 0 1 Математика\n\nДни недели: 0-Понедельник, 1-Вторник, 2-Среда, 3-Четверг, 4-Пятница, 5-Суббота, 6-Воскресенье`,
      cancelKeyboard,
    );
    ctx.wizard.state.action = 'edit';
  } catch (error) {
    console.error('Ошибка при поиске урока для редактирования:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.', cancelKeyboard);
    return ctx.wizard.back();
  }
}

async function handleEdit(ctx) {
  let parsed;
  try {
    parsed = parseLessonInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const { dayOfWeek, lessonNumber, subjectName } = parsed;
  try {
    const editId = ctx.wizard.state.editId;
    const existing = await scheduleService.isSlotTaken(dayOfWeek, lessonNumber, editId);
    if (existing) {
      await ctx.reply(
        `❌ Этот слот уже занят другим уроком:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\nВыберите другой слот.`,
        cancelKeyboard,
      );
      return;
    }
    const schedule = await scheduleService.update(editId, { dayOfWeek, lessonNumber, subjectName });
    if (!schedule) {
      await ctx.reply('❌ Урок не найден.');
      return ctx.wizard.back();
    }
    await ctx.reply(
      `✅ Урок успешно отредактирован!\n\nID: ${schedule.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}`,
      backKeyboard,
    );
    return ctx.wizard.back();
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      await ctx.reply('❌ Урок не найден.');
      return ctx.wizard.back();
    }
    if (error.message === 'SLOT_TAKEN') {
      await ctx.reply(
        `❌ Этот слот уже занят другим уроком:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${error.existing.subjectName}\n\nВыберите другой слот.`,
        cancelKeyboard,
      );
      return;
    }
    console.error('Ошибка при редактировании урока:', error);
    await ctx.reply('❌ Произошла ошибка при редактировании урока: ' + error.message, backKeyboard);
    return ctx.wizard.back();
  }
}

async function handleAdd(ctx) {
  let parsed;
  try {
    parsed = parseLessonInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const { dayOfWeek, lessonNumber, subjectName } = parsed;
  try {
    const existing = await scheduleService.isSlotTaken(dayOfWeek, lessonNumber);
    if (existing) {
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
    const created = await scheduleService.create({ dayOfWeek, lessonNumber, subjectName });
    await ctx.reply(
      `✅ Урок успешно добавлен!\n\nID: ${created.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}`,
      backKeyboard,
    );
    return ctx.wizard.back();
  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${error.existing.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
    console.error('Ошибка при добавлении урока:', error);
    await ctx.reply('❌ Произошла ошибка при добавлении урока.');
    return ctx.wizard.back();
  }
}

async function handleDelete(ctx) {
  const id = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(id)) {
    await ctx.reply('❌ Неверный формат ID. Введите число.', cancelKeyboard);
    return;
  }
  try {
    const result = await scheduleService.deleteWithHomework(id);
    let message = `✅ Урок удален:\n${getDayName(result.deletedDay)}, ${result.deletedLesson} урок: ${result.deletedSubject}`;
    if (result.deletedCount > 0) message += `\n\n🗑 Также удалено ${result.deletedCount} связанных домашних заданий.`;
    await ctx.reply(message, backKeyboard);
    return ctx.wizard.back();
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      await ctx.reply('❌ Урок с таким ID не найден.');
      return ctx.wizard.back();
    }
    console.error('Ошибка при удалении урока:', error);
    await ctx.reply('❌ Произошла ошибка при удалении урока: ' + error.message);
    return ctx.wizard.back();
  }
}

module.exports = manageScheduleScene;
