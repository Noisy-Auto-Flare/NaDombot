const { Scenes } = require('telegraf');
const { getAvailableClasses, getAvailableTracks, getAvailableSubgroups, setUserProfile, getUserProfile } = require('../utils/userProfile');
const { Track, Subgroup } = require('../models');

const CANCEL_MSG = '❌ Выбор отменен, вы сможете выбрать позже через /profile';

const SCOPE_OWN = 'select_scope:own';
const SCOPE_ALL = 'select_scope:all';

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
  kb.push([{ text: '👀 Видеть всё', callback_data: SCOPE_ALL }]);
  kb.push([{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]);
  return kb;
}

function buildSubgroupKeyboard(subgroups) {
  const kb = [];
  for (const s of subgroups) {
    kb.push([{ text: s.teacher || s.name || s.id, callback_data: `select_subgroup:${s.id}` }]);
  }
  kb.push([{ text: 'Без группы/Все', callback_data: 'select_subgroup:null' }]);
  kb.push([{ text: '👀 Видеть всё', callback_data: SCOPE_ALL }]);
  kb.push([{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]);
  return kb;
}

function buildScopeForkKeyboard() {
  return [
    [{ text: '📚 Только своё → дальше', callback_data: SCOPE_OWN }],
    [{ text: '👀 Видеть всё', callback_data: SCOPE_ALL }],
    [{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]
  ];
}

async function showScopeFork(ctx) {
  await ctx.reply('👥 Что показывать?\n\n📚 «Только своё» — уроки твоего профиля\n👀 «Видеть всё» — весь класс сразу (режим наблюдателя)', {
    reply_markup: { inline_keyboard: buildScopeForkKeyboard() }
  });
}

/**
 * Сохранить scope='all': класс остаётся, остальные поля — null (P2 §3.1).
 * @param {object} ctx
 * @returns {Promise<void>}
 */
async function saveScopeAll(ctx) {
  const editMode = ctx.wizard.state.editMode || ctx.scene.state.edit;
  const original = ctx.wizard.state.originalProfile;
  const classId = ctx.wizard.state.classId || (original && original.classId);
  if (!classId) {
    await ctx.reply('❌ Нет выбранного класса. Начните заново через /profile');
    return ctx.scene.leave();
  }
  try {
    await setUserProfile(ctx.from.id, { classId, trackId: null, subgroupId: null, scope: 'all' });
  } catch (e) {
    console.error('saveScopeAll', e.message || e);
    await ctx.reply('❌ Не удалось сохранить режим. Попробуйте позже через /profile');
    return ctx.scene.leave();
  }
  const prefix = editMode ? '✅ Режим обновлён' : '✅ Профиль сохранён';
  await ctx.reply(`${prefix}: ${classId} · Видеть всё\nТеперь покажу меню`);
  try {
    const { handleStart } = require('../handlers/commands');
    await handleStart(ctx);
  } catch (_e) {
    // fallback simple
  }
  return ctx.scene.leave();
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
  // scope: явный выбор из развилки → он; в edit-выборе конкретного поля → 'own';
  // иначе сохранить исходный (setUserProfile сам сохранит существующий).
  const scopeChoice = ctx.wizard.state.scopeChoice;
  const saveScope = scopeChoice || (editMode === 'track' || editMode === 'subgroup' ? 'own' : undefined);
  try {
    await setUserProfile(ctx.from.id, { classId: saveClassId, trackId: saveTrackId, subgroupId: saveSubgroupId, scope: saveScope });
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
      subgroupLabel = s ? s.teacher || s.name || s.id : saveSubgroupId;
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

/**
 * После выбора «Только своё»: показать треки (или сразу подгруппы, если треков нет).
 * Переход — явным selectStep(3), т.к. вызываем из разных шагов (1/2).
 * @param {object} ctx
 */
async function showOwnNextStep(ctx) {
  ctx.wizard.state.scopeChoice = 'own';
  const goTrackStep = () => {
    if (typeof ctx.wizard.selectStep === 'function') ctx.wizard.selectStep(3);
    else ctx.wizard.cursor = 3;
  };
  const classId = ctx.wizard.state.classId;
  try {
    const grade = parseInt(String(classId), 10);
    const g = Number.isNaN(grade) ? 0 : grade;
    const tracks = await getAvailableTracks(classId);
    if (g < 10 || !tracks || tracks.length === 0) {
      ctx.wizard.state.trackId = null;
      const subgroups = await getAvailableSubgroups('английский', classId);
      const kb = buildSubgroupKeyboard(subgroups);
      await ctx.reply('У кого английский?', { reply_markup: { inline_keyboard: kb } });
      goTrackStep();
      return;
    }
    const kb = buildTrackKeyboard(tracks);
    await ctx.reply('Выберите профиль', { reply_markup: { inline_keyboard: kb } });
    goTrackStep();
  } catch (e) {
    console.error('showOwnNextStep error', e.message || e);
    await ctx.reply('❌ Ошибка при загрузке профилей. Попробуйте позже.');
    return ctx.scene.leave();
  }
}

/**
 * Показать развилку scope и перейти на шаг 2 (вызываем из шагов 0/1).
 * @param {object} ctx
 */
async function showForkAndGo(ctx) {
  await showScopeFork(ctx);
  if (typeof ctx.wizard.selectStep === 'function') ctx.wizard.selectStep(2);
  else ctx.wizard.cursor = 2;
}

const selectProfileScene = new Scenes.WizardScene(
  'selectProfile',
  // Step 0 — entry: edit-диспетч или классы (с автоскипом единственного класса → развилка)
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
          ctx.wizard.state.originalProfile = { classId: prof.classId, trackId: prof.trackId, subgroupId: prof.subgroupId, scope: prof.scope };
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
            if (classes.length === 1) {
              ctx.wizard.state.classId = classes[0].id;
              ctx.wizard.state.editMode = null;
              await showForkAndGo(ctx);
              return;
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
            await setUserProfile(ctx.from.id, { classId: prof.classId, trackId: null, subgroupId: prof.subgroupId, scope: 'own' });
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
        // jump to track handling step (index 3)
        if (typeof ctx.wizard.selectStep === 'function') {
          ctx.wizard.selectStep(3);
        } else {
          ctx.wizard.cursor = 3;
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
            if (classes.length === 1) {
              ctx.wizard.state.classId = classes[0].id;
              ctx.wizard.state.editMode = null;
              await showForkAndGo(ctx);
              return;
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
          // jump to track/subgroup handling step (index 3, handles both)
          if (typeof ctx.wizard.selectStep === 'function') {
            ctx.wizard.selectStep(3);
          } else {
            ctx.wizard.cursor = 3;
          }
          return;
        } catch (e) {
          console.error('selectProfile edit subgroup', e.message || e);
          await ctx.reply('❌ Ошибка при загрузке подгрупп. Попробуйте позже.');
          return ctx.scene.leave();
        }
      }
    }
    // normal flow — класс: один доступный → молча подставляем и сразу развилка (A1)
    try {
      const classes = await getAvailableClasses();
      if (!classes || classes.length === 0) {
        await ctx.reply('❌ Нет доступных классов. Обратитесь к администратору.');
        return ctx.scene.leave();
      }
      if (classes.length === 1) {
        ctx.wizard.state.classId = classes[0].id;
        await showForkAndGo(ctx);
        return;
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
  // Step 1 — выбор класса → развилка scope (P2 §3.1)
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
        await showForkAndGo(ctx);
        return;
      }
      // развилка могла быть показана уже на step 0 (автоскип класса) — обработать здесь же
      if (data === SCOPE_OWN) {
        await ctx.answerCbQuery().catch(() => {});
        return showOwnNextStep(ctx);
      }
      if (data === SCOPE_ALL) {
        await ctx.answerCbQuery().catch(() => {});
        return saveScopeAll(ctx);
      }
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    // текстовые сообщения игнорируем
  },
  // Step 2 — развилка scope после явного выбора класса
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data === SCOPE_OWN) {
        await ctx.answerCbQuery().catch(() => {});
        return showOwnNextStep(ctx);
      }
      if (data === SCOPE_ALL) {
        await ctx.answerCbQuery().catch(() => {});
        return saveScopeAll(ctx);
      }
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
  },
  // Step 3 — обработка выбора трека ИЛИ подгруппы (если трек скипнут) + третья кнопка scope
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data === SCOPE_ALL) {
        await ctx.answerCbQuery().catch(() => {});
        return saveScopeAll(ctx);
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
            await setUserProfile(ctx.from.id, { classId: finalClassId, trackId: finalTrackId, subgroupId: finalSubgroupId, scope: 'own' });
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
                subLabel = s ? s.teacher || s.name || s.id : finalSubgroupId;
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
              await setUserProfile(ctx.from.id, { classId: original.classId, trackId: original.trackId, subgroupId: finalSubgroupId, scope: 'own' });
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
                  subLabel = s ? s.teacher || s.name || s.id : finalSubgroupId;
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
  // Step 4 — обработка выбора подгруппы (после трека) + третья кнопка scope
  async (ctx) => {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      if (data === 'schedule_cancel' || data === 'back_to_menu') {
        await ctx.answerCbQuery().catch(() => {});
        await ctx.reply(CANCEL_MSG);
        return ctx.scene.leave();
      }
      if (data === SCOPE_ALL) {
        await ctx.answerCbQuery().catch(() => {});
        return saveScopeAll(ctx);
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
