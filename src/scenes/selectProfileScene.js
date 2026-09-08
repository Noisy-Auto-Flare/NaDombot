const { Scenes } = require('telegraf');
const { getAvailableClasses, getAvailableTracks, getAvailableSubgroups, setUserProfile } = require('../utils/userProfile');
const { Track, Subgroup } = require('../models');

const CANCEL_MSG = '❌ Выбор отменен, вы сможете выбрать позже через /profile';

function buildClassKeyboard(classes) {
  const kb = [];
  for (const c of classes) {
    kb.push([{ text: String(c.id), callback_data: `select_class:${c.id}` }]);
  }
  kb.push([{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]);
  return kb;
}

function buildTrackKeyboard(tracks) {
  const kb = [];
  for (const t of tracks) {
    kb.push([{ text: t.name, callback_data: `select_track:${t.id}` }]);
  }
  kb.push([{ text: 'Общий', callback_data: 'select_track:null' }]);
  kb.push([{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]);
  return kb;
}

function buildSubgroupKeyboard(subgroups) {
  const kb = [];
  for (const s of subgroups) {
    kb.push([{ text: s.teacherName || s.id, callback_data: `select_subgroup:${s.id}` }]);
  }
  kb.push([{ text: 'Без группы/Все', callback_data: 'select_subgroup:null' }]);
  kb.push([{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]);
  return kb;
}

async function finalizeProfile(ctx, subgroupId) {
  const { classId, trackId } = ctx.wizard.state;
  // normalize literal "null"
  const finalSubgroupId = subgroupId === 'null' ? null : subgroupId;
  const finalTrackId = trackId === 'null' ? null : trackId || null;
  try {
    await setUserProfile(ctx.from.id, { classId, trackId: finalTrackId, subgroupId: finalSubgroupId });
  } catch (e) {
    console.error('finalizeProfile', e.message || e);
    await ctx.reply('❌ Не удалось сохранить профиль. Попробуйте позже через /profile');
    return ctx.scene.leave();
  }
  // build human labels
  let trackLabel = 'Общий';
  if (finalTrackId) {
    try {
      const t = await Track.findByPk(finalTrackId);
      trackLabel = t ? t.name : finalTrackId;
    } catch (_e) {
      trackLabel = finalTrackId;
    }
  }
  let subgroupLabel = 'Без группы';
  if (finalSubgroupId) {
    try {
      const s = await Subgroup.findByPk(finalSubgroupId);
      subgroupLabel = s ? s.teacherName || s.id : finalSubgroupId;
    } catch (_e) {
      subgroupLabel = finalSubgroupId;
    }
  }
  await ctx.reply(`✅ Профиль сохранен: ${classId} ${trackLabel} ${subgroupLabel}\nТеперь покажу меню`);
  // показать меню
  try {
    const { handleStart } = require('../handlers/commands');
    await handleStart(ctx);
  } catch (_e) {
    // fallback simple
  }
  return ctx.scene.leave();
}

const selectProfileScene = new Scenes.WizardScene(
  'selectProfile',
  // Step 0 — показать классы
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.scene.leave();
    }
    try {
      const classes = await getAvailableClasses();
      if (!classes || classes.length === 0) {
        await ctx.reply('❌ Нет доступных классов. Обратитесь к администратору.');
        return ctx.scene.leave();
      }
      const kb = buildClassKeyboard(classes);
      await ctx.reply('👋 Выберите класс', { reply_markup: { inline_keyboard: kb } });
      return ctx.wizard.next();
    } catch (e) {
      console.error('selectProfile step0', e.message || e);
      await ctx.reply('❌ Ошибка при загрузке классов. Попробуйте позже.');
      return ctx.scene.leave();
    }
  },
  // Step 1 — обработка выбора класса
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data.startsWith('select_class:')) {
        await ctx.answerCbQuery().catch(() => {});
        const classId = data.split(':').slice(1).join(':');
        ctx.wizard.state.classId = classId;
        try {
          const grade = parseInt(String(classId), 10);
          const g = Number.isNaN(grade) ? 0 : grade;
          const tracks = await getAvailableTracks(classId);
          if (g < 10 || !tracks || tracks.length === 0) {
            ctx.wizard.state.trackId = null;
            // сразу к подгруппам
            const subgroups = await getAvailableSubgroups('английский', classId);
            const kb = buildSubgroupKeyboard(subgroups);
            await ctx.reply('У кого английский?', { reply_markup: { inline_keyboard: kb } });
            return ctx.wizard.next();
          }
          // показать треки
          const kb = buildTrackKeyboard(tracks);
          await ctx.reply('Выберите профиль', { reply_markup: { inline_keyboard: kb } });
          return ctx.wizard.next();
        } catch (e) {
          console.error('select_class error', e.message || e);
          await ctx.reply('❌ Ошибка при загрузке профилей. Попробуйте позже.');
          return ctx.scene.leave();
        }
      }
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    // текстовые сообщения игнорируем
  },
  // Step 2 — обработка выбора трека ИЛИ подгруппы (если трек скипнут)
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data.startsWith('select_track:')) {
        await ctx.answerCbQuery().catch(() => {});
        const trackId = data.split(':').slice(1).join(':');
        ctx.wizard.state.trackId = trackId;
        try {
          const classId = ctx.wizard.state.classId;
          const subgroups = await getAvailableSubgroups('английский', classId);
          const kb = buildSubgroupKeyboard(subgroups);
          await ctx.reply('У кого английский?', { reply_markup: { inline_keyboard: kb } });
          return ctx.wizard.next();
        } catch (e) {
          console.error('select_track error', e.message || e);
          await ctx.reply('❌ Ошибка при загрузке подгрупп. Попробуйте позже.');
          return ctx.scene.leave();
        }
      }
      if (data.startsWith('select_subgroup:')) {
        // это случай когда трек был скипнут и второй шаг уже ждёт подгруппу
        await ctx.answerCbQuery().catch(() => {});
        const subgroupId = data.split(':').slice(1).join(':');
        return finalizeProfile(ctx, subgroupId);
      }
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
  },
  // Step 3 — обработка выбора подгруппы (после трека)
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data.startsWith('select_subgroup:')) {
        await ctx.answerCbQuery().catch(() => {});
        const subgroupId = data.split(':').slice(1).join(':');
        return finalizeProfile(ctx, subgroupId);
      }
      await ctx.answerCbQuery().catch(() => {});
    }
  }
);

module.exports = selectProfileScene;
