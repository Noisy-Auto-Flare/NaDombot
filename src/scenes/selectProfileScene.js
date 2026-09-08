const { Scenes } = require('telegraf');
const { getAvailableClasses, getAvailableTracks, getAvailableSubgroups, setUserProfile, getUserProfile } = require('../utils/userProfile');
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
  // if editMode is track/subgroup and originalProfile exists, keep unchanged fields where needed
  const editMode = ctx.wizard.state.editMode || ctx.scene.state.edit;
  const original = ctx.wizard.state.originalProfile;
  let saveClassId = classId;
  let saveTrackId = finalTrackId;
  let saveSubgroupId = finalSubgroupId;
  if (editMode && original) {
    if (editMode === 'track') {
      // class stays, subgroup stays unless we just finalized subgroup separately
      saveClassId = original.classId;
      // saveTrackId already set to new selection
      saveSubgroupId = finalSubgroupId !== undefined ? finalSubgroupId : original.subgroupId;
      // subgroup was not changed in track-only flow if we are finalizing via subgroup step later
      // when handling track selection we haven't finalized yet; finalize happens at subgroup step
    } else if (editMode === 'subgroup') {
      saveClassId = original.classId;
      saveTrackId = original.trackId;
      // saveSubgroupId already new
    }
    // for editMode class, all fields will be set via full flow, keep as is but ensure fallback to original subgroup/track if not yet set
    if (editMode === 'class' && original && (saveTrackId === undefined || saveSubgroupId === undefined)) {
      // will be filled during flow
    }
  }
  try {
    await setUserProfile(ctx.from.id, { classId: saveClassId, trackId: saveTrackId, subgroupId: saveSubgroupId });
  } catch (e) {
    console.error('finalizeProfile', e.message || e);
    await ctx.reply('❌ Не удалось сохранить профиль. Попробуйте позже через /profile');
    return ctx.scene.leave();
  }
  // build human labels
  let trackLabel = 'Общий';
  if (saveTrackId) {
    try {
      const t = await Track.findByPk(saveTrackId);
      trackLabel = t ? t.name : saveTrackId;
    } catch (_e) {
      trackLabel = saveTrackId;
    }
  }
  let subgroupLabel = 'Без группы';
  if (saveSubgroupId) {
    try {
      const s = await Subgroup.findByPk(saveSubgroupId);
      subgroupLabel = s ? s.teacherName || s.id : saveSubgroupId;
    } catch (_e) {
      subgroupLabel = saveSubgroupId;
    }
  }
  const isEdit = !!(editMode || original);
  const prefix = isEdit ? '✅ Профиль обновлен' : '✅ Профиль сохранен';
  await ctx.reply(`${prefix}: ${saveClassId} ${trackLabel} ${subgroupLabel}\nТеперь покажу меню`);
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
  // Step 0 — показать классы или обработку edit режима
  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'back_to_menu') {
      await ctx.answerCbQuery().catch(() => {});
      return ctx.scene.leave();
    }
    const edit = ctx.scene.state.edit || ctx.wizard.state.editMode || null;
    // partial edit handling
    if (edit === 'track' || edit === 'subgroup' || edit === 'class') {
      ctx.wizard.state.editMode = edit;
      // preload original profile for merge
      try {
        const prof = await getUserProfile(ctx.from.id);
        if (prof) {
          ctx.wizard.state.originalProfile = { classId: prof.classId, trackId: prof.trackId, subgroupId: prof.subgroupId };
          ctx.wizard.state.classId = prof.classId;
          ctx.wizard.state.trackId = prof.trackId;
          ctx.wizard.state.subgroupId = prof.subgroupId;
        }
      } catch (_e) { void _e; }
      if (edit === 'class') {
        // show class picker same as normal
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
          console.error('selectProfile step0 edit class', e.message || e);
          await ctx.reply('❌ Ошибка при загрузке классов. Попробуйте позже.');
          return ctx.scene.leave();
        }
      }
      if (edit === 'track') {
        const prof = ctx.wizard.state.originalProfile;
        if (!prof || !prof.classId) {
          // no profile — fallback to full flow
          try {
            const classes = await getAvailableClasses();
            if (!classes || classes.length === 0) {
              await ctx.reply('❌ Нет доступных классов. Обратитесь к администратору.');
              return ctx.scene.leave();
            }
            const kb = buildClassKeyboard(classes);
            await ctx.reply('👋 Выберите класс', { reply_markup: { inline_keyboard: kb } });
            ctx.wizard.state.editMode = null;
            return ctx.wizard.next();
          } catch (e) {
            console.error('selectProfile edit track fallback', e.message || e);
            await ctx.reply('❌ Ошибка при загрузке классов. Попробуйте позже.');
            return ctx.scene.leave();
          }
        }
        // check grade <10 → no tracks
        const grade = parseInt(String(prof.classId), 10);
        const g = Number.isNaN(grade) ? 0 : grade;
        const tracks = await getAvailableTracks(prof.classId);
        if (g < 10 || !tracks || tracks.length === 0) {
          await ctx.reply('ℹ️ Для вашего класса нет выбора профиля. Профиль остается Общим.');
          // keep track null, go to subgroup edit? just keep as is
          ctx.wizard.state.trackId = null;
          // if track not applicable, finish directly keeping other fields
          try {
            await setUserProfile(ctx.from.id, { classId: prof.classId, trackId: null, subgroupId: prof.subgroupId });
            await ctx.reply('✅ Профиль обновлен: ' + prof.classId + ' Общий ' + (prof.subgroupId || 'Без группы'));
            try {
              const { handleStart } = require('../handlers/commands');
              await handleStart(ctx);
            } catch (_e) { void _e; }
            return ctx.scene.leave();
          } catch (e) {
            console.error('edit track no tracks finalize', e.message || e);
            await ctx.reply('❌ Не удалось сохранить профиль. Попробуйте позже через /profile');
            return ctx.scene.leave();
          }
        }
        const kb = buildTrackKeyboard(tracks);
        await ctx.reply('🧬 Выберите профиль', { reply_markup: { inline_keyboard: kb } });
        // jump to track handling step (which is step 2 index 2)
        // set next step to handle track selection: step 2 handles select_track
        // we are at step 0, need to go to step 2. Wizard next goes to 1, so set state and use selectStep if available
        if (typeof ctx.wizard.selectStep === 'function') {
          ctx.wizard.selectStep(2);
        } else {
          // fallback: set cursor manually to step 2 (wizard state)
          ctx.wizard.cursor = 2;
        }
        return;
      }
      if (edit === 'subgroup') {
        const prof = ctx.wizard.state.originalProfile;
        if (!prof || !prof.classId) {
          try {
            const classes = await getAvailableClasses();
            if (!classes || classes.length === 0) {
              await ctx.reply('❌ Нет доступных классов. Обратитесь к администратору.');
              return ctx.scene.leave();
            }
            const kb = buildClassKeyboard(classes);
            await ctx.reply('👋 Выберите класс', { reply_markup: { inline_keyboard: kb } });
            ctx.wizard.state.editMode = null;
            return ctx.wizard.next();
          } catch (e) {
            console.error('selectProfile edit subgroup fallback', e.message || e);
            await ctx.reply('❌ Ошибка при загрузке классов. Попробуйте позже.');
            return ctx.scene.leave();
          }
        }
        try {
          const subgroups = await getAvailableSubgroups('английский', prof.classId);
          const kb = buildSubgroupKeyboard(subgroups);
          await ctx.reply('👩‍🏫 У кого английский?', { reply_markup: { inline_keyboard: kb } });
          // jump to final step handling subgroup (step 3 index 3, but step2 also handles subgroup when track skipped)
          // place to step 2 which handles both track and subgroup
          if (typeof ctx.wizard.selectStep === 'function') {
            ctx.wizard.selectStep(2);
          } else {
            ctx.wizard.cursor = 2;
          }
          return;
        } catch (e) {
          console.error('selectProfile edit subgroup', e.message || e);
          await ctx.reply('❌ Ошибка при загрузке подгрупп. Попробуйте позже.');
          return ctx.scene.leave();
        }
      }
    }
    // normal flow — показать классы
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
  // Step 1 — обработка выбора класса (и для edit class)
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
        // if editMode class, continue to track/subgroup as full flow (new class resets track/subgroup)
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
  // Step 2 — обработка выбора трека ИЛИ подгруппы (если трек скипнут) + также подгруппы для edit subgroup/track
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
        const editMode = ctx.wizard.state.editMode;
        // if editMode track — after picking new track we should save directly preserving subgroup
        if (editMode === 'track') {
          const original = ctx.wizard.state.originalProfile;
          const finalTrackId = trackId === 'null' ? null : trackId;
          const finalClassId = original ? original.classId : ctx.wizard.state.classId;
          const finalSubgroupId = original ? original.subgroupId : null;
          try {
            await setUserProfile(ctx.from.id, { classId: finalClassId, trackId: finalTrackId, subgroupId: finalSubgroupId });
            let trackLabel = finalTrackId || 'Общий';
            if (finalTrackId) {
              try {
                const t = await Track.findByPk(finalTrackId);
                trackLabel = t ? t.name : finalTrackId;
              } catch (_e) { trackLabel = finalTrackId; }
            }
            let subLabel = finalSubgroupId || 'Без группы';
            if (finalSubgroupId) {
              try {
                const s = await Subgroup.findByPk(finalSubgroupId);
                subLabel = s ? s.teacherName || s.id : finalSubgroupId;
              } catch (_e) { subLabel = finalSubgroupId; }
            }
            await ctx.reply(`✅ Профиль обновлен: ${finalClassId} ${trackLabel} ${subLabel}\nТеперь покажу меню`);
            try {
              const { handleStart } = require('../handlers/commands');
              await handleStart(ctx);
            } catch (_e) { void _e; }
            return ctx.scene.leave();
          } catch (e) {
            console.error('edit track finalize', e.message || e);
            await ctx.reply('❌ Не удалось сохранить профиль. Попробуйте позже через /profile');
            return ctx.scene.leave();
          }
        }
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
        // это случай когда трек был скипнут и второй шаг уже ждёт подгруппу (grade<10) или edit subgroup direct
        await ctx.answerCbQuery().catch(() => {});
        const subgroupId = data.split(':').slice(1).join(':');
        // for edit subgroup, finalize with original class/track
        const editMode = ctx.wizard.state.editMode;
        if (editMode === 'subgroup' || editMode === 'track') {
          const original = ctx.wizard.state.originalProfile;
          if (editMode === 'subgroup' && original) {
            // directly save
            const finalSubgroupId = subgroupId === 'null' ? null : subgroupId;
            try {
              await setUserProfile(ctx.from.id, { classId: original.classId, trackId: original.trackId, subgroupId: finalSubgroupId });
              let trackLabel = original.trackId || 'Общий';
              if (original.trackId) {
                try {
                  const t = await Track.findByPk(original.trackId);
                  trackLabel = t ? t.name : original.trackId;
                } catch (_e) { trackLabel = original.trackId; }
              }
              let subLabel = finalSubgroupId || 'Без группы';
              if (finalSubgroupId) {
                try {
                  const s = await Subgroup.findByPk(finalSubgroupId);
                  subLabel = s ? s.teacherName || s.id : finalSubgroupId;
                } catch (_e) { subLabel = finalSubgroupId; }
              }
              await ctx.reply(`✅ Профиль обновлен: ${original.classId} ${trackLabel} ${subLabel}\nТеперь покажу меню`);
              try {
                const { handleStart } = require('../handlers/commands');
                await handleStart(ctx);
              } catch (_e) { void _e; }
              return ctx.scene.leave();
            } catch (e) {
              console.error('edit subgroup finalize', e.message || e);
              await ctx.reply('❌ Не удалось сохранить профиль. Попробуйте позже через /profile');
              return ctx.scene.leave();
            }
          }
        }
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
