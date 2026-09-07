const { Scenes } = require('telegraf');
const scheduleService = require('../services/scheduleService');
const { groupByDay, formatWeeklySchedule, formatScheduleForEdit } = require('../utils/scheduleFormatter');
const { isAdmin } = require('../middleware/isAdmin');
const { cancelKeyboard, backKeyboard, backToMenuKeyboard, manageScheduleKeyboard } = require('../utils/keyboards');
const { getQuickPickThreshold } = require('../utils/quickPickSettings');
const {
  handleEditSelect,
  handleAdd,
  handleAddRoom,
  handleEdit,
  handleEditRoom,
  handleDelete,
  handleBellSelect,
  handleBellTime,
  handleQuickPickThreshold,
} = require('./helpers/manageScheduleHelpers');

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

    if (action === 'edit_bells') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      await ctx.reply('🔔 Настройка звонков\n\nВведите номер урока (1-10) для редактирования:', cancelKeyboard);
      ctx.wizard.state.action = 'edit_bells_select';
      return ctx.wizard.next();
    }

    if (action === 'edit_quick_pick_threshold') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      const current = await getQuickPickThreshold().catch(() => '16:30');
      await ctx.reply(
        `⏰ Текущий порог быстрых кнопок: ${current}\n\nПосле этого времени будут показываться ВСЕ уроки сегодня (7-8), до — только последние 4 прошедших.\n\nВведите новое время в формате HH:MM (например 16:30 или 17:00):`,
        cancelKeyboard
      );
      ctx.wizard.state.action = 'edit_quick_pick_threshold';
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
    if (action === 'edit_room') return handleEditRoom(ctx);
    if (action === 'add') return handleAdd(ctx);
    if (action === 'add_room') return handleAddRoom(ctx);
    if (action === 'delete') return handleDelete(ctx);
    if (action === 'edit_bells_select') return handleBellSelect(ctx);
    if (action === 'edit_bells_time') return handleBellTime(ctx);
    if (action === 'edit_quick_pick_threshold') return handleQuickPickThreshold(ctx);
  },
);

module.exports = manageScheduleScene;
