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
  handleAddAudienceClass,
  handleAddAudienceTrack,
  handleAddAudienceSubgroup,
  handleEdit,
  handleEditRoom,
  handleEditAudienceClass,
  handleEditAudienceTrack,
  handleEditAudienceSubgroup,
  handleDelete,
  handleBellSelect,
  handleBellTime,
  handleQuickPickThreshold,
  handleToggleMultiprofile,
  handleClassList,
  handleClassAdd,
  handleClassDelete,
  handleTrackList,
  handleTrackAdd,
  handleTrackDelete,
  handleSubgroupList,
  handleSubgroupAdd,
  handleSubgroupDelete,
  handleStats,
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

    if (action === 'schedule_classes') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      ctx.wizard.state.action = 'classes_list';
      await handleClassList(ctx);
      return ctx.wizard.next();
    }

    if (action === 'schedule_tracks') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      ctx.wizard.state.action = 'tracks_list';
      await handleTrackList(ctx);
      return ctx.wizard.next();
    }

    if (action === 'schedule_subgroups') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      ctx.wizard.state.action = 'subgroups_list';
      await handleSubgroupList(ctx);
      return ctx.wizard.next();
    }

    if (action === 'schedule_stats') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      ctx.wizard.state.action = 'stats';
      await handleStats(ctx);
      return;
    }

    if (action === 'schedule_toggle_multiprofile') {
      if (!isAdmin(ctx)) {
        await ctx.reply('❌ У вас нет прав администратора');
        return;
      }
      ctx.wizard.state.action = 'toggle_multiprofile';
      await handleToggleMultiprofile(ctx);
      return;
    }

    if (action === 'schedule_back') {
      await ctx.reply('📅 Управление расписанием\n\nВыберите действие:', manageScheduleKeyboard);
    }
  },
  async (ctx) => {
    // Handle callbackQuery for audience selection and cancel/back
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => {});
      const a = ctx.callbackQuery.data;
      if (a === 'back_to_menu' || a === 'schedule_cancel') {
        await ctx.reply('❌ Действие отменено.', backToMenuKeyboard);
        return ctx.scene.leave();
      }
      const action = ctx.wizard.state.action;
      // Audience callbacks
      if (action === 'add_audience_class' || action === 'edit_audience_class') {
        if (a.startsWith('audience_class_')) {
          // For edit, delegate to edit handler (same logic)
          if (action === 'edit_audience_class') return handleEditAudienceClass(ctx);
          return handleAddAudienceClass(ctx);
        }
      }
      if (action === 'add_audience_track' || action === 'edit_audience_track') {
        if (a.startsWith('audience_track_')) {
          if (action === 'edit_audience_track') return handleEditAudienceTrack(ctx);
          return handleAddAudienceTrack(ctx);
        }
      }
      if (action === 'add_audience_subgroup' || action === 'edit_audience_subgroup') {
        if (a.startsWith('audience_subgroup_')) {
          if (action === 'edit_audience_subgroup') return handleEditAudienceSubgroup(ctx);
          return handleAddAudienceSubgroup(ctx);
        }
      }
      return;
    }
    if (!ctx.message || !ctx.message.text) return;

    const action = ctx.wizard.state.action;

    if (action === 'edit_select') return handleEditSelect(ctx);
    if (action === 'edit') return handleEdit(ctx);
    if (action === 'edit_audience_class') return handleAddAudienceClass(ctx);
    if (action === 'edit_audience_track') return handleAddAudienceTrack(ctx);
    if (action === 'edit_audience_subgroup') return handleAddAudienceSubgroup(ctx);
    if (action === 'edit_room') return handleEditRoom(ctx);
    if (action === 'add') return handleAdd(ctx);
    if (action === 'add_audience_class') return handleAddAudienceClass(ctx);
    if (action === 'add_audience_track') return handleAddAudienceTrack(ctx);
    if (action === 'add_audience_subgroup') return handleAddAudienceSubgroup(ctx);
    if (action === 'add_room') return handleAddRoom(ctx);
    if (action === 'delete') return handleDelete(ctx);
    if (action === 'edit_bells_select') return handleBellSelect(ctx);
    if (action === 'edit_bells_time') return handleBellTime(ctx);
    if (action === 'edit_quick_pick_threshold') return handleQuickPickThreshold(ctx);
    if (action === 'toggle_multiprofile') return handleToggleMultiprofile(ctx);
    if (action === 'stats') return handleStats(ctx);
    // Classes / Tracks / Subgroups list handling
    if (action === 'classes_list' || action.startsWith('classes')) {
      const text = ctx.message.text.trim();
      // Heuristic: delete if starts with delete/удалить/del/-
      const lower = text.toLowerCase();
      if (lower.startsWith('delete ') || lower.startsWith('удалить ') || lower.startsWith('del ') || lower.startsWith('remove ')) {
        const id = text.split(/\s+/).slice(1).join(' ').trim() || text;
        ctx.message.text = id;
        return handleClassDelete(ctx);
      }
      // If text is single token that looks like existing class ID and user might want delete,
      // try add first; if SLOT_TAKEN and next word is delete hint, but we can't disambiguate.
      // Default to add; for delete user can use explicit "delete <id>"
      // Also support "🗑 <id>" style
      if (text.startsWith('🗑')) {
        ctx.message.text = text.replace('🗑', '').trim();
        return handleClassDelete(ctx);
      }
      return handleClassAdd(ctx);
    }
    if (action === 'tracks_list' || action.startsWith('tracks')) {
      const text = ctx.message.text.trim();
      const lower = text.toLowerCase();
      if (lower.startsWith('delete ') || lower.startsWith('удалить ') || lower.startsWith('del ') || lower.startsWith('remove ')) {
        const rest = text.split(/\s+/).slice(1).join(' ').trim();
        ctx.message.text = rest;
        return handleTrackDelete(ctx);
      }
      if (text.startsWith('🗑')) {
        ctx.message.text = text.replace('🗑', '').trim();
        return handleTrackDelete(ctx);
      }
      // Try add first; if that fails because format needs 3 tokens, fallback to delete
      try {
        return await handleTrackAdd(ctx);
      } catch (_e) {
        return handleTrackDelete(ctx);
      }
    }
    if (action === 'subgroups_list' || action.startsWith('subgroups')) {
      const text = ctx.message.text.trim();
      const lower = text.toLowerCase();
      if (lower.startsWith('delete ') || lower.startsWith('удалить ') || lower.startsWith('del ') || lower.startsWith('remove ')) {
        const rest = text.split(/\s+/).slice(1).join(' ').trim();
        ctx.message.text = rest;
        return handleSubgroupDelete(ctx);
      }
      if (text.startsWith('🗑')) {
        ctx.message.text = text.replace('🗑', '').trim();
        return handleSubgroupDelete(ctx);
      }
      const parts = text.split(/\s+/);
      if (parts.length === 1) {
        return handleSubgroupDelete(ctx);
      }
      return handleSubgroupAdd(ctx);
    }
    if (action === 'classes_add') return handleClassAdd(ctx);
    if (action === 'classes_delete') return handleClassDelete(ctx);
    if (action === 'tracks_add') return handleTrackAdd(ctx);
    if (action === 'tracks_delete') return handleTrackDelete(ctx);
    if (action === 'subgroups_add') return handleSubgroupAdd(ctx);
    if (action === 'subgroups_delete') return handleSubgroupDelete(ctx);
  },
);

module.exports = manageScheduleScene;
