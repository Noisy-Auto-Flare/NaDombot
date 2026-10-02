const logger = require('../../utils/logger');
const { getDayName } = require('../../utils/dateUtils');
const scheduleService = require('../../services/scheduleService');
const lessonTimeService = require('../../services/LessonTimeService');
const { parseLessonInput, parseRoomInput } = require('../../utils/scheduleValidator');
const { validateTimeRange } = require('../../utils/lessonTimeValidator');
const { cancelKeyboard, backKeyboard, lessonsManageKeyboard, adminBackKeyboard } = require('../../utils/keyboards');
const { setQuickPickThreshold } = require('../../utils/quickPickSettings');
const { normalizeSubject } = require('../../utils/subjectNormalizer');

const ROOM_PROMPT = 'В каком кабинете проходит урок? (отправьте номер, или \'-\' чтобы пропустить)';

function parseBellInput(text) {
  const t = String(text).trim();
  const normalized = t.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  let start; let end;
  if (normalized.includes('-')) {
    const parts = normalized.split('-').map((p) => p.trim());
    [start, end] = parts;
  } else {
    const parts = normalized.split(' ');
    if (parts.length === 2) [start, end] = parts;
  }
  if (!start || !end) throw new Error('❌ Неверный формат. Используйте HH:MM-HH:MM, например 08:30-09:15');
  return { start, end };
}

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
    const roomInfo = schedule.room ? `, каб. ${schedule.room}` : '';
    await ctx.reply(
      `📝 Редактирование урока:\n\nТекущие данные:\nДень недели: ${getDayName(schedule.dayOfWeek)} (${schedule.dayOfWeek})\nНомер урока: ${schedule.lessonNumber}\nПредмет: ${schedule.subjectName}${roomInfo}\n\nВведите новые данные в формате:\n<день_недели> <номер_урока> <название_предмета>\n\nПример: 0 1 Математика\n\nДни недели: 0-Понедельник, 1-Вторник, 2-Среда, 3-Четверг, 4-Пятница, 5-Суббота, 6-Воскресенье`,
      cancelKeyboard,
    );
    ctx.wizard.state.action = 'edit';
  } catch (error) {
    logger.error('Ошибка при поиске урока для редактирования:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.', cancelKeyboard);
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
  ctx.wizard.state.pending = parsed;
  ctx.wizard.state.audience = { classId: '10А', trackId: null, subgroupId: null };
  // Переходим к выбору аудитории: класс
  ctx.wizard.state.action = 'add_audience_class';
  await promptAudienceClass(ctx);
}

async function promptAudienceClass(ctx) {
  try {
    const { Class } = require('../../models');
    const classes = await Class.findAll({ order: [['id', 'ASC']] });
    if (classes.length === 0) {
      await ctx.reply('🏫 Классов нет, используется класс по умолчанию 10А.\nВведите ID трека (например tech) или \'-\' чтобы пропустить:', cancelKeyboard);
      ctx.wizard.state.audience = { classId: '10А', trackId: null, subgroupId: null };
      ctx.wizard.state.action = 'add_audience_track';
      await promptAudienceTrack(ctx);
      return;
    }
    const list = classes.map((c) => `${c.id} (${c.grade != null ? c.grade : '?'}${c.letter || ''}) ${c.enabled ? '✅' : '❌'}`).join('\n');
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          ...classes.map((c) => [{ text: c.id, callback_data: `audience_class_${c.id}` }]),
          [{ text: '➖ Пропустить (10А)', callback_data: 'audience_class_skip' }],
        ],
      },
    };
    await ctx.reply(`🏫 Выберите класс для урока:\n${list}\n\nОтправьте ID класса сообщением (например 10А) или выберите кнопкой:`, keyboard);
  } catch (e) {
    logger.error('promptAudienceClass error', e);
    await ctx.reply('🏫 Введите ID класса (например 10А) или \'-\' для 10А:', cancelKeyboard);
  }
}

async function promptAudienceTrack(ctx) {
  try {
    const currentClassId = ctx.wizard.state.audience && ctx.wizard.state.audience.classId ? ctx.wizard.state.audience.classId : '10А';
    const { Track } = require('../../models');
    const tracks = await Track.findAll({ where: { classId: currentClassId }, order: [['id', 'ASC']] });
    const list = tracks.length ? tracks.map((t) => `${t.id} — ${t.name}${t.isCommon ? ' (общий)' : ''}`).join('\n') : 'Нет профилей для этого класса.';
    const keyboard = tracks.length
      ? {
        reply_markup: {
          inline_keyboard: [
            ...tracks.map((t) => [{ text: t.name, callback_data: `audience_track_${t.id}` }]),
            [{ text: '➖ Общий (без профиля)', callback_data: 'audience_track_skip' }],
          ],
        },
      }
      : cancelKeyboard;
    await ctx.reply(`🧬 Выберите профиль для класса ${currentClassId}:\n${list}\n\nОтправьте ID профиля (например tech) или '-' чтобы сделать общим:`, keyboard);
  } catch (e) {
    logger.error('promptAudienceTrack error', e);
    await ctx.reply('🧬 Введите ID профиля или \'-\' чтобы пропустить:', cancelKeyboard);
  }
}

async function promptAudienceSubgroup(ctx) {
  try {
    const pending = ctx.wizard.state.pending || ctx.wizard.state.pendingEdit;
    const subject = pending ? pending.subjectName : 'английский';
    const { Subgroup } = require('../../models');
    const subgroups = await Subgroup.findAll({ order: [['id', 'ASC']] });
    // Фильтруем по subject если возможно, но показываем все с пометкой
    const list = subgroups.length
      ? subgroups.map((s) => `${s.id} — ${s.division || s.subject || '—'} — ${s.teacher || s.name || '—'} ${s.classId ? '(' + s.classId + ')' : '(все классы)'}`).join('\n')
      : 'Нет подгрупп.';
    const keyboard = subgroups.length
      ? {
        reply_markup: {
          inline_keyboard: [
            ...subgroups.map((s) => [{ text: `${s.id} (${s.teacher || s.name || s.id})`, callback_data: `audience_subgroup_${s.id}` }]),
            [{ text: '➖ Без подгруппы', callback_data: 'audience_subgroup_skip' }],
          ],
        },
      }
      : cancelKeyboard;
    await ctx.reply(`👩‍🏫 Выберите подгруппу (предмет урока: ${subject}):\n${list}\n\nОтправьте ID подгруппы (например belova) или '-' чтобы пропустить. Если подгруппа указана, её предмет должен совпадать с предметом урока.`, keyboard);
  } catch (e) {
    logger.error('promptAudienceSubgroup error', e);
    await ctx.reply('👩‍🏫 Введите ID подгруппы или \'-\' чтобы пропустить:', cancelKeyboard);
  }
}

async function handleAddAudienceClass(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  // callback handling
  if (ctx.callbackQuery && ctx.callbackQuery.data) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('audience_class_')) {
      await ctx.answerCbQuery().catch(() => {});
      const val = data.replace('audience_class_', '');
      if (val === 'skip') {
        ctx.wizard.state.audience.classId = '10А';
      } else {
        ctx.wizard.state.audience.classId = val;
      }
      ctx.wizard.state.action = 'add_audience_track';
      await promptAudienceTrack(ctx);
      return;
    }
  }
  if (!text) return;
  if (text === '-' || text.toLowerCase() === 'пропустить' || text.toLowerCase() === 'skip') {
    ctx.wizard.state.audience.classId = '10А';
  } else {
    const id = text.split(/\s+/)[0];
    try {
      const { Class } = require('../../models');
      const found = await Class.findByPk(id);
      if (!found) {
        await ctx.reply(`❌ Класс не найден: ${id}. Попробуйте ещё раз или '-' для 10А.`, cancelKeyboard);
        return;
      }
      ctx.wizard.state.audience.classId = found.id;
    } catch (e) {
      logger.error('handleAddAudienceClass error', e);
      await ctx.reply('❌ Ошибка проверки класса. Попробуйте ещё раз.', cancelKeyboard);
      return;
    }
  }
  ctx.wizard.state.action = 'add_audience_track';
  await promptAudienceTrack(ctx);
}

async function handleAddAudienceTrack(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  if (ctx.callbackQuery && ctx.callbackQuery.data) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('audience_track_')) {
      await ctx.answerCbQuery().catch(() => {});
      const val = data.replace('audience_track_', '');
      if (val === 'skip') {
        ctx.wizard.state.audience.trackId = null;
      } else {
        ctx.wizard.state.audience.trackId = val;
      }
      // validate track belongs to class
      if (ctx.wizard.state.audience.trackId) {
        try {
          const { Track } = require('../../models');
          const found = await Track.findOne({ where: { classId: ctx.wizard.state.audience.classId, id: ctx.wizard.state.audience.trackId } });
          if (!found) {
            // try global lookup
            const globalFound = await Track.findByPk(ctx.wizard.state.audience.trackId);
            if (!globalFound) {
              await ctx.reply(`❌ Профиль не найден: ${ctx.wizard.state.audience.trackId}. Попробуйте ещё раз.`, cancelKeyboard);
              ctx.wizard.state.action = 'add_audience_track';
              return;
            }
          }
        } catch (_e) { void _e; }
      }
      ctx.wizard.state.action = 'add_audience_subgroup';
      await promptAudienceSubgroup(ctx);
      return;
    }
  }
  if (!text && !ctx.callbackQuery) return;
  if (text) {
    if (text === '-' || text.toLowerCase() === 'пропустить' || text.toLowerCase() === 'skip') {
      ctx.wizard.state.audience.trackId = null;
    } else {
      const id = text.split(/\s+/)[0];
      try {
        const { Track } = require('../../models');
        const foundByClass = await Track.findOne({ where: { classId: ctx.wizard.state.audience.classId, id } });
        const foundGlobal = foundByClass ? foundByClass : await Track.findByPk(id);
        if (!foundGlobal) {
          await ctx.reply(`❌ Профиль не найден: ${id}. Попробуйте ещё раз или '-' чтобы пропустить.`, cancelKeyboard);
          return;
        }
        ctx.wizard.state.audience.trackId = foundGlobal.id;
      } catch (e) {
        logger.error('handleAddAudienceTrack error', e);
        await ctx.reply('❌ Ошибка проверки профиля.', cancelKeyboard);
        return;
      }
    }
    ctx.wizard.state.action = 'add_audience_subgroup';
    await promptAudienceSubgroup(ctx);
  }
}

async function handleAddAudienceSubgroup(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  let subgroupId = null;
  if (ctx.callbackQuery && ctx.callbackQuery.data) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('audience_subgroup_')) {
      await ctx.answerCbQuery().catch(() => {});
      const val = data.replace('audience_subgroup_', '');
      if (val !== 'skip') subgroupId = val;
      // fall through to validation
    } else {
      return;
    }
  } else if (text) {
    if (text === '-' || text.toLowerCase() === 'пропустить' || text.toLowerCase() === 'skip') {
      subgroupId = null;
    } else {
      subgroupId = text.split(/\s+/)[0];
    }
  } else {
    return;
  }

  // Validate subgroup if provided
  if (subgroupId) {
    try {
      const { Subgroup } = require('../../models');
      const sg = await Subgroup.findByPk(subgroupId);
      if (!sg) {
        await ctx.reply(`❌ Подгруппа не найдена: ${subgroupId}. Попробуйте ещё раз или '-' чтобы пропустить.`, cancelKeyboard);
        return;
      }
      const pending = ctx.wizard.state.pending || ctx.wizard.state.pendingEdit;
      const subjectName = pending ? pending.subjectName : '';
      // P1 v2: subject задан → валидация как раньше; null → подгруппа годится для любого предмета
      if (sg.subject != null && String(sg.subject).trim() !== '') {
        const subNorm = normalizeSubject(sg.subject);
        const subjNorm = normalizeSubject(subjectName);
        const isEnglishMatch = subNorm === 'английский' && subjNorm.includes('английский');
        if (subNorm !== subjNorm && !isEnglishMatch) {
          await ctx.reply(`❌ Подгруппа ${sg.teacher || sg.name || sg.id} для предмета ${sg.subject}, а вы ввели ${subjectName}`, cancelKeyboard);
          return;
        }
      }
      ctx.wizard.state.audience.subgroupId = sg.id;
    } catch (e) {
      if (e.message && e.message.startsWith('❌ Подгруппа')) throw e;
      logger.error('handleAddAudienceSubgroup error', e);
      await ctx.reply('❌ Ошибка проверки подгруппы.', cancelKeyboard);
      return;
    }
  } else {
    ctx.wizard.state.audience.subgroupId = null;
  }

  // After subgroup chosen, check slot taken with full audience, then ask room
  const pending = ctx.wizard.state.pending;
  const isEdit = !!ctx.wizard.state.pendingEdit;
  const targetPending = isEdit ? ctx.wizard.state.pendingEdit : pending;
  if (!targetPending) {
    await ctx.reply('❌ Сессия истекла. Начните заново.', backKeyboard);
    return ctx.wizard.back();
  }
  const { dayOfWeek, lessonNumber } = targetPending;
  try {
    const audience = ctx.wizard.state.audience;
    const excludeId = isEdit ? ctx.wizard.state.editId : null;
    const existing = await scheduleService.isSlotTaken(dayOfWeek, lessonNumber, audience, excludeId);
    if (existing) {
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
  } catch (e) {
    if (e.message === 'SLOT_TAKEN') {
      const ex = e.existing;
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(ex.dayOfWeek)}, ${ex.lessonNumber} урок: ${ex.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
    logger.error('slot check error', e);
  }

  if (isEdit) {
    ctx.wizard.state.action = 'edit_room';
  } else {
    ctx.wizard.state.action = 'add_room';
  }
  await ctx.reply(ROOM_PROMPT, cancelKeyboard);
}

// Forwards for edit audience — reuse same logic but start from pendingEdit
async function handleEditAudienceClass(ctx) {
  return handleAddAudienceClass(ctx);
}
async function handleEditAudienceTrack(ctx) {
  return handleAddAudienceTrack(ctx);
}
async function handleEditAudienceSubgroup(ctx) {
  return handleAddAudienceSubgroup(ctx);
}

async function handleAddRoom(ctx) {
  let room;
  try {
    room = parseRoomInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const pending = ctx.wizard.state.pending;
  if (!pending) {
    await ctx.reply('❌ Сессия истекла. Начните заново.', backKeyboard);
    return ctx.wizard.back();
  }
  const { dayOfWeek, lessonNumber, subjectName } = pending;
  const audience = ctx.wizard.state.audience || { classId: '10А', trackId: null, subgroupId: null };
  try {
    const created = await scheduleService.create({ dayOfWeek, lessonNumber, subjectName, room, classId: audience.classId, trackId: audience.trackId, subgroupId: audience.subgroupId });
    const roomSuffix = room ? ` — каб. ${room}` : '';
    const audienceSuffix = audience.subgroupId ? ` [${audience.classId}/${audience.trackId || 'общий'}/${audience.subgroupId}]` : audience.trackId ? ` [${audience.classId}/${audience.trackId}]` : ` [${audience.classId}]`;
    await ctx.reply(`✅ Урок успешно добавлен!\n\nID: ${created.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}${roomSuffix}${audienceSuffix}`, backKeyboard);
    ctx.wizard.state.pending = null;
    ctx.wizard.state.audience = null;
    return ctx.wizard.back();
  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${error.existing.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
    if (error.message === 'SUBGROUP_NOT_FOUND') {
      await ctx.reply('❌ Подгруппа не найдена.', cancelKeyboard);
      return;
    }
    if (error.message === 'SUBGROUP_SUBJECT_MISMATCH') {
      // Need teacher name for message — try lookup
      try {
        const { Subgroup } = require('../../models');
        const sg = audience.subgroupId ? await Subgroup.findByPk(audience.subgroupId) : null;
        const teacher = sg ? (sg.teacher || sg.name || sg.id) : audience.subgroupId;
        const subj = sg ? sg.subject : 'unknown';
        await ctx.reply(`❌ Подгруппа ${teacher} для предмета ${subj}, а вы ввели ${subjectName}`, cancelKeyboard);
      } catch (_e) {
        await ctx.reply(`❌ Подгруппа для предмета не совпадает с ${subjectName}`, cancelKeyboard);
      }
      return;
    }
    logger.error('Ошибка при добавлении урока:', error);
    await ctx.reply('❌ Произошла ошибка при добавлении урока.');
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
  ctx.wizard.state.pendingEdit = parsed;
  // init audience from existing schedule if not set
  if (!ctx.wizard.state.audience) {
    try {
      const existing = await scheduleService.findById(ctx.wizard.state.editId);
      ctx.wizard.state.audience = {
        classId: existing ? existing.classId : '10А',
        trackId: existing ? existing.trackId : null,
        subgroupId: existing ? existing.subgroupId : null
      };
    } catch (_e) {
      ctx.wizard.state.audience = { classId: '10А', trackId: null, subgroupId: null };
    }
  } else {
    // keep current audience as base for next prompt
  }
  ctx.wizard.state.action = 'edit_audience_class';
  await promptAudienceClass(ctx);
}

async function handleEditRoom(ctx) {
  let room;
  try {
    room = parseRoomInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const pending = ctx.wizard.state.pendingEdit;
  const editId = ctx.wizard.state.editId;
  if (!pending || editId == null) {
    await ctx.reply('❌ Сессия истекла. Начните заново.', backKeyboard);
    return ctx.wizard.back();
  }
  const { dayOfWeek, lessonNumber, subjectName } = pending;
  const audience = ctx.wizard.state.audience || {};
  try {
    const schedule = await scheduleService.update(editId, { dayOfWeek, lessonNumber, subjectName, room, classId: audience.classId, trackId: audience.trackId, subgroupId: audience.subgroupId });
    if (!schedule) {
      await ctx.reply('❌ Урок не найден.');
      return ctx.wizard.back();
    }
    const roomSuffix = room ? ` — каб. ${room}` : '';
    const audienceSuffix = audience.subgroupId ? ` [${audience.classId}/${audience.trackId || 'общий'}/${audience.subgroupId}]` : audience.trackId ? ` [${audience.classId}/${audience.trackId}]` : audience.classId ? ` [${audience.classId}]` : '';
    await ctx.reply(`✅ Урок успешно отредактирован!\n\nID: ${schedule.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}${roomSuffix}${audienceSuffix}`, backKeyboard);
    ctx.wizard.state.pendingEdit = null;
    ctx.wizard.state.audience = null;
    return ctx.wizard.back();
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      await ctx.reply('❌ Урок не найден.');
      return ctx.wizard.back();
    }
    if (error.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Этот слот уже занят другим уроком:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${error.existing.subjectName}\n\nВыберите другой слот.`, cancelKeyboard);
      return;
    }
    if (error.message === 'SUBGROUP_NOT_FOUND') {
      await ctx.reply('❌ Подгруппа не найдена.', cancelKeyboard);
      return;
    }
    if (error.message === 'SUBGROUP_SUBJECT_MISMATCH') {
      try {
        const { Subgroup } = require('../../models');
        const sg = audience.subgroupId ? await Subgroup.findByPk(audience.subgroupId) : null;
        const teacher = sg ? (sg.teacher || sg.name || sg.id) : audience.subgroupId;
        const subj = sg ? sg.subject : 'unknown';
        await ctx.reply(`❌ Подгруппа ${teacher} для предмета ${subj}, а вы ввели ${subjectName}`, cancelKeyboard);
      } catch (_e) {
        await ctx.reply(`❌ Подгруппа для предмета не совпадает с ${subjectName}`, cancelKeyboard);
      }
      return;
    }
    logger.error('Ошибка при редактировании урока:', error);
    await ctx.reply('❌ Произошла ошибка при редактировании урока: ' + error.message, backKeyboard);
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
    logger.error('Ошибка при удалении урока:', error);
    await ctx.reply('❌ Произошла ошибка при удалении урока: ' + error.message);
    return ctx.wizard.back();
  }
}

async function handleBellSelect(ctx) {
  const n = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(n) || n < 1 || n > 10) {
    await ctx.reply('❌ Неверный номер урока. Введите число от 1 до 10.', cancelKeyboard);
    return;
  }
  ctx.wizard.state.bellLessonNumber = n;
  ctx.wizard.state.action = 'edit_bells_time';
  const existing = await lessonTimeService.findByLessonNumber(n).catch(() => null);
  const hint = existing ? `Текущее время: ${existing.startTime}–${existing.endTime}\n` : '';
  await ctx.reply(`${hint}Введите время для урока ${n} в формате HH:MM-HH:MM\nПример: 08:30-09:15`, cancelKeyboard);
}

async function handleBellTime(ctx) {
  let parsed;
  try {
    parsed = parseBellInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const { start, end } = parsed;
  const lessonNumber = ctx.wizard.state.bellLessonNumber;
  try {
    validateTimeRange(start, end);
  } catch (e) {
    await ctx.reply(`❌ Неверный диапазон времени: ${e.message}`, cancelKeyboard);
    return;
  }
  try {
    const record = await lessonTimeService.upsert(lessonNumber, start, end);
    await ctx.reply(`✅ Звонки обновлены!\n${lessonNumber} урок: ${record.startTime}–${record.endTime}`, backKeyboard);
    ctx.wizard.state.bellLessonNumber = null;
    return ctx.wizard.back();
  } catch (error) {
    if (error.name === 'ValidationError') {
      await ctx.reply(`❌ ${error.message}`, cancelKeyboard);
      return;
    }
    logger.error('Ошибка при обновлении звонков:', error);
    await ctx.reply('❌ Произошла ошибка при обновлении звонков: ' + error.message, backKeyboard);
    return ctx.wizard.back();
  }
}

/**
 * Обработка ввода порога быстрых кнопок HH:MM.
 * @param {import('telegraf').Context} ctx
 */
async function handleQuickPickThreshold(ctx) {
  const text = ctx.message.text.trim();
  try {
    const hhmm = await setQuickPickThreshold(text);
    await ctx.reply(
      `✅ Порог быстрых кнопок обновлён! Теперь после ${hhmm} будут показываться все уроки дня (вместо последних 4).`,
      backKeyboard
    );
    return ctx.wizard.back();
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
  }
}

// ── Новые хендлеры: toggle multiprofile / classes / tracks / subgroups / stats ──

async function handleToggleMultiprofile(ctx) {
  try {
    const { getMultiprofileEnabled, setMultiprofileEnabled } = require('../../utils/settings');
    const current = await getMultiprofileEnabled();
    const next = !current;
    await setMultiprofileEnabled(next);
    await ctx.reply(`🧩 Мульти-профиль: ${next ? 'Вкл' : 'Выкл'}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    logger.error('handleToggleMultiprofile error', e);
    await ctx.reply('❌ Ошибка переключения мульти-профиля.', backKeyboard);
    return ctx.wizard.back();
  }
}

async function handleClassList(ctx) {
  try {
    const { Class } = require('../../models');
    const classes = await Class.findAll({ order: [['id', 'ASC']] });
    if (classes.length === 0) {
      await ctx.reply('🏫 Классов пока нет.', backKeyboard);
      return ctx.wizard.back();
    }
    const lines = classes.map((c) => `ID: ${c.id} (${c.grade != null ? c.grade : '?'}${c.letter || ''}) ${c.enabled ? '✅' : '❌'}`);
    await ctx.reply(`🏫 Классы:\n${lines.join('\n')}\n\nДля добавления отправьте: "<ID>" или "<grade> <letter> [enabled]"\nПример: 11Б или 11 Б true\nДля удаления: отправьте ID класса.`, backKeyboard);
    // stay on same action to allow add/delete via next message
    ctx.wizard.state.action = 'classes_list';
  } catch (e) {
    logger.error('handleClassList error', e);
    await ctx.reply('❌ Ошибка загрузки классов.', backKeyboard);
    return ctx.wizard.back();
  }
}

async function handleClassAdd(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  if (!text) {
    await ctx.reply('❌ Введите данные класса. Пример: 11Б', cancelKeyboard);
    return;
  }
  // if numeric-like delete? we treat add here; delete is separate
  try {
    const classService = require('../../services/classService');
    const created = await classService.create(text);
    await ctx.reply(`✅ Класс создан: ${created.id} (${created.grade != null ? created.grade : ''}${created.letter || ''}) ${created.enabled ? '✅' : '❌'}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Класс уже существует: ${e.existing.id}`, cancelKeyboard);
      return;
    }
    await ctx.reply(e.message || '❌ Ошибка создания класса.', cancelKeyboard);
  }
}

async function handleClassDelete(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim().split(/\s+/)[0] : '';
  if (!text) {
    await ctx.reply('❌ Введите ID класса для удаления.', cancelKeyboard);
    return;
  }
  try {
    const classService = require('../../services/classService');
    await classService.remove(text);
    await ctx.reply(`✅ Класс удалён: ${text}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'NOT_FOUND') {
      await ctx.reply('❌ Класс не найден.', cancelKeyboard);
      return;
    }
    await ctx.reply('❌ Ошибка удаления: ' + e.message, cancelKeyboard);
  }
}

async function handleTrackList(ctx) {
  try {
    const { Track } = require('../../models');
    const tracks = await Track.findAll({ order: [['classId', 'ASC'], ['id', 'ASC']] });
    if (tracks.length === 0) {
      await ctx.reply('🧬 Профилей пока нет.', backKeyboard);
      return ctx.wizard.back();
    }
    const lines = tracks.map((t) => `ID: ${t.id} — ${t.classId} — ${t.name}${t.isCommon ? ' (общий)' : ''}`);
    await ctx.reply(`🧬 Профили:\n${lines.join('\n')}\n\nДля добавления: "<classId> <trackId> <название>"\nПример: 10А tech Тех. профиль\nДля удаления: "<classId> <trackId>"`, backKeyboard);
    ctx.wizard.state.action = 'tracks_list';
  } catch (e) {
    logger.error('handleTrackList error', e);
    await ctx.reply('❌ Ошибка загрузки профилей.', backKeyboard);
    return ctx.wizard.back();
  }
}

async function handleTrackAdd(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  if (!text) {
    await ctx.reply('❌ Введите данные профиля.', cancelKeyboard);
    return;
  }
  try {
    const trackService = require('../../services/trackService');
    const created = await trackService.create(text);
    await ctx.reply(`✅ Профиль создан: ${created.id} (${created.classId}) — ${created.name}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Профиль уже существует: ${e.existing.id} в ${e.existing.classId}`, cancelKeyboard);
      return;
    }
    await ctx.reply(e.message || '❌ Ошибка создания профиля.', cancelKeyboard);
  }
}

async function handleTrackDelete(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  if (!text) {
    await ctx.reply('❌ Введите "<classId> <trackId>" для удаления.', cancelKeyboard);
    return;
  }
  try {
    const trackService = require('../../services/trackService');
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      // try single trackId
      await trackService.remove(parts[0]);
    } else {
      await trackService.remove(parts[0], parts[1]);
    }
    await ctx.reply(`✅ Профиль удалён: ${text}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'NOT_FOUND') {
      await ctx.reply('❌ Профиль не найден.', cancelKeyboard);
      return;
    }
    await ctx.reply('❌ Ошибка удаления: ' + e.message, cancelKeyboard);
  }
}

async function handleSubgroupList(ctx) {
  try {
    const { Subgroup } = require('../../models');
    const subs = await Subgroup.findAll({ order: [['subject', 'ASC'], ['id', 'ASC']] });
    if (subs.length === 0) {
      await ctx.reply('👩‍🏫 Подгрупп пока нет.', backKeyboard);
      return ctx.wizard.back();
    }
    const lines = subs.map((s) => `ID: ${s.id} — ${s.division || s.subject || '—'} — ${s.teacher || s.name || '—'} ${s.classId ? '(' + s.classId + ')' : '(все)'} ${s.active ? '✅' : '❌'}`);
    await ctx.reply(`👩‍🏫 Подгруппы:\n${lines.join('\n')}\n\nДля добавления: "<предмет> <id> <учитель> [classId]"\nПример: английский belova Белова 10А\nДля удаления: отправьте ID подгруппы.`, backKeyboard);
    ctx.wizard.state.action = 'subgroups_list';
  } catch (e) {
    logger.error('handleSubgroupList error', e);
    await ctx.reply('❌ Ошибка загрузки подгрупп.', backKeyboard);
    return ctx.wizard.back();
  }
}

async function handleSubgroupAdd(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  if (!text) {
    await ctx.reply('❌ Введите данные подгруппы.', cancelKeyboard);
    return;
  }
  try {
    const subgroupService = require('../../services/subgroupService');
    const created = await subgroupService.create(text);
    await ctx.reply(`✅ Подгруппа создана: ${created.id} — ${created.division} — ${created.teacher || created.name || '—'}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Подгруппа уже существует: ${e.existing.id}`, cancelKeyboard);
      return;
    }
    await ctx.reply(e.message || '❌ Ошибка создания подгруппы.', cancelKeyboard);
  }
}

async function handleSubgroupDelete(ctx) {
  const text = ctx.message && ctx.message.text ? ctx.message.text.trim().split(/\s+/)[0] : '';
  if (!text) {
    await ctx.reply('❌ Введите ID подгруппы для удаления.', cancelKeyboard);
    return;
  }
  try {
    const subgroupService = require('../../services/subgroupService');
    await subgroupService.remove(text);
    await ctx.reply(`✅ Подгруппа удалена: ${text}`, backKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    if (e.message === 'NOT_FOUND') {
      await ctx.reply('❌ Подгруппа не найдена.', cancelKeyboard);
      return;
    }
    await ctx.reply('❌ Ошибка удаления: ' + e.message, cancelKeyboard);
  }
}

async function handleStats(ctx) {
  try {
    const { getStatsSummary, getUserCountsByClass } = require('../../utils/userAnalytics');
    const summary = await getStatsSummary();
    const byClassExtra = await getUserCountsByClass().catch(() => []);
    const total = summary.totalUsers;
    const classParts = (summary.byClass && summary.byClass.length)
      ? summary.byClass.map((c) => `${c.classId}:${c.count}`).join(', ')
      : (byClassExtra.length ? byClassExtra.map((c) => `${c.classId}:${c.count}`).join(', ') : '—');
    // subgroup counts map teacher names via Subgroup
    let subgroupLabel = '';
    try {
      const { Subgroup } = require('../../models');
      const subs = await Subgroup.findAll();
      const subMap = new Map(subs.map((s) => [s.id, s.teacher || s.name || s.id]));
      if (summary.bySubgroup && summary.bySubgroup.length) {
        subgroupLabel = summary.bySubgroup.map((s) => `${subMap.get(s.subgroupId) || s.subgroupId} ${s.count}`).join('/');
      } else {
        subgroupLabel = '0';
      }
    } catch (_e) {
      subgroupLabel = summary.bySubgroup ? summary.bySubgroup.map((s) => `${s.subgroupId} ${s.count}`).join('/') : '0';
    }
    const withoutProfile = summary.withoutProfile;
    const classCountsStr = classParts || '—';
    const msg = `📊 Всего ${total}, ${classCountsStr}, без профиля ${withoutProfile}, ${subgroupLabel || 'подгрупп 0'}`;
    await ctx.reply(`📊 Статистика\n${msg}\n\nАктивных за 24ч: ${summary.active24h}`, adminBackKeyboard);
    return ctx.wizard.back();
  } catch (e) {
    logger.error('handleStats error', e);
    await ctx.reply('❌ Ошибка загрузки статистики.', adminBackKeyboard);
    return ctx.wizard.back();
  }
}

function formatMoscowDateTime(date) {
  if (!date) return '—';
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
  } catch (_e) {
    try {
      return new Date(date).toISOString().slice(0, 16).replace('T', ' ');
    } catch (_e2) {
      return String(date);
    }
  }
}

function formatMoscowDate(date) {
  if (!date) return '—';
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    // fallback simple
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    if (map.year && map.month && map.day) return `${map.year}-${map.month}-${map.day}`;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch (_e) {
    try {
      return new Date(date).toISOString().slice(0, 10);
    } catch (_e2) {
      return String(date);
    }
  }
}

function formatEventTime(date) {
  if (!date) return '--:--';
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.hour}:${map.minute}`;
  } catch (_e) {
    return '--:--';
  }
}

/**
 * Список пользователей с пагинацией (10 на страницу).
 * @param {import('telegraf').Context} ctx
 * @param {number} [page=0]
 */
async function handleUsersList(ctx, page = 0) {
  const { isAdmin } = require('../../middleware/isAdmin');
  if (!isAdmin(ctx)) {
    try { await ctx.answerCbQuery('❌ У вас нет прав администратора'); } catch (_e) { /* ignore */ }
    return;
  }
  let targetPage = Number.isFinite(page) ? page : 0;
  if (ctx.callbackQuery && ctx.callbackQuery.data) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('users_page:')) {
      const p = parseInt(data.split(':')[1], 10);
      if (!isNaN(p)) targetPage = p;
    } else if (data === 'users_list' || data === 'schedule_users' || data === 'schedule_stats') {
      targetPage = 0;
    }
  }
  if (targetPage < 0) targetPage = 0;
  try { await ctx.answerCbQuery().catch(() => {}); } catch (_e) { /* ignore */ }

  const { getAllUsersWithProfile, getUsersPaginated } = require('../../utils/userAnalytics');
  const { User } = require('../../models');
  const limit = 10;
  const offset = targetPage * limit;
  let users = [];
  try {
    if (typeof getUsersPaginated === 'function') {
      users = await getUsersPaginated(limit, offset);
    } else {
      users = await getAllUsersWithProfile(limit, offset);
    }
  } catch (_e) {
    users = await getAllUsersWithProfile(limit, offset);
  }

  let total = 0;
  try { total = await User.count(); } catch (_e) { total = users.length; }

  if (users.length === 0 && targetPage === 0) {
    await ctx.reply('📊 Пользователей пока нет.', adminBackKeyboard);
    return;
  }
  if (users.length === 0 && targetPage > 0) {
    await ctx.reply('📊 Больше пользователей нет.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '◀️ Назад', callback_data: `users_page:${targetPage - 1}` }],
          [{ text: '🔙 Назад', callback_data: 'admin_back' }],
        ],
      },
    });
    return;
  }

  const hasNext = (offset + users.length) < total;
  const hasPrev = targetPage > 0;

  let text = `📊 Пользователи (стр. ${targetPage + 1}, всего ${total}):\n\n`;
  for (const u of users) {
    const p = u.profile || null;
    const classId = p ? p.classId : (u.classId || '—');
    const trackId = p ? (p.trackId || '—') : (u.trackId || '—');
    const subgroupId = p ? (p.subgroupId || '—') : (u.subgroupId || '—');
    const audience = `${classId}/${trackId}/${subgroupId}`;
    const uname = u.username ? `@${u.username} ` : '';
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
    const lastSeen = u.lastSeenAt ? formatMoscowDateTime(u.lastSeenAt) : '—';
    text += `${u.userId} ${uname}${name} (${audience}) ${lastSeen}\n`;
  }

  const keyboard = [];
  for (const u of users) {
    const label = `${u.userId} ${u.username ? '@' + u.username : (u.firstName || '')}`.trim().slice(0, 32);
    keyboard.push([{ text: label, callback_data: `user_detail:${u.userId}:${targetPage}` }]);
  }
  const navRow = [];
  if (hasPrev) navRow.push({ text: '◀️ Назад', callback_data: `users_page:${targetPage - 1}` });
  if (hasNext) navRow.push({ text: '▶️ Вперед', callback_data: `users_page:${targetPage + 1}` });
  if (navRow.length) keyboard.push(navRow);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'admin_back' }]);

  await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
}

/**
 * Детальный просмотр пользователя по ID.
 * Ожидает callback_data формата `user_detail:<userId>:<page>`
 * @param {import('telegraf').Context} ctx
 */
async function handleUserDetail(ctx) {
  const { isAdmin } = require('../../middleware/isAdmin');
  if (!isAdmin(ctx)) {
    try { await ctx.answerCbQuery('❌ У вас нет прав администратора'); } catch (_e) { /* ignore */ }
    return;
  }
  try { await ctx.answerCbQuery().catch(() => {}); } catch (_e) { /* ignore */ }

  let userId = null;
  let page = 0;
  if (ctx.callbackQuery && ctx.callbackQuery.data) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('user_detail:')) {
      const parts = data.split(':');
      userId = parts[1];
      if (parts[2] != null) {
        const p = parseInt(parts[2], 10);
        if (!isNaN(p)) page = p;
      }
    }
  }
  // fallback: if ctx.match или напрямую передан
  if (!userId && ctx.match && ctx.match[1]) userId = ctx.match[1];

  if (!userId) {
    await ctx.reply('❌ Не указан ID пользователя.', adminBackKeyboard);
    return;
  }

  const { getUserDetail } = require('../../utils/userAnalytics');
  let detail;
  try {
    detail = await getUserDetail(userId);
  } catch (e) {
    logger.error('handleUserDetail getUserDetail error', e);
    await ctx.reply('❌ Ошибка загрузки пользователя.', adminBackKeyboard);
    return;
  }
  if (!detail || !detail.user) {
    await ctx.reply(`❌ Пользователь ${userId} не найден.`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 К списку', callback_data: `users_page:${page}` }], [{ text: '🔙 Назад', callback_data: 'admin_back' }]] },
    });
    return;
  }
  const { user, profile, events } = detail;
  const p = profile || user.profile || null;
  const classId = p ? p.classId : (user.classId || '—');
  const trackId = p ? (p.trackId || '—') : (user.trackId || '—');
  let teacherLabel = '—';
  const subgroupId = p ? p.subgroupId : user.subgroupId;
  if (subgroupId) {
    try {
      const { Subgroup } = require('../../models');
      const sg = await Subgroup.findByPk(subgroupId);
      teacherLabel = sg ? (sg.teacher || sg.name || sg.id) : subgroupId;
    } catch (_e) {
      teacherLabel = subgroupId;
    }
  }
  const usernameLine = user.username ? `@${user.username}` : '—';
  const nameLine = [user.firstName, user.lastName].filter(Boolean).join(' ') || '—';
  const firstSeen = user.firstSeenAt ? formatMoscowDate(user.firstSeenAt) : '—';
  const lastSeen = user.lastSeenAt ? formatMoscowDateTime(user.lastSeenAt) : '—';
  const actionsCount = user.interactionCount != null ? user.interactionCount : (events ? events.length : 0);

  let text = `👤 ID: ${user.userId}\n${usernameLine}\nИмя: ${nameLine}\nКласс: ${classId}\nПрофиль: ${trackId}\nУчитель: ${teacherLabel}\nПервый вход: ${firstSeen}\nПоследний: ${lastSeen}\nДействий: ${actionsCount}`;

  if (events && events.length) {
    text += '\n\nПоследние 10 действий:\n';
    for (const ev of events) {
      const t = formatEventTime(ev.createdAt);
      const payload = ev.payload ? String(ev.payload).slice(0, 40) : '';
      const metaStr = payload ? `: ${payload}` : '';
      text += `- ${t} ${ev.type}${metaStr}\n`;
    }
  } else {
    text += '\n\nПоследние 10 действий:\n— нет действий —';
  }

  const keyboard = [
    [{ text: '🔙 К списку', callback_data: `users_page:${page}` }],
    [{ text: '🔙 Назад', callback_data: 'admin_back' }],
  ];

  await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
}

async function handleShowModes(ctx) {
  try {
    const { getHomeworkVisibility, getHomeworkVisibilityLabel } = require('../../utils/settings');
    const mode = await getHomeworkVisibility();
    const label = getHomeworkVisibilityLabel(mode);
    await ctx.reply(`🧩 Режимы\n\n👥 Режим домашнего задания: ${label}\n\nНажмите чтобы переключить:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `👥 Переключить: ${label}`, callback_data: 'toggle_hw_visibility' }],
          [{ text: '🔙 Назад', callback_data: 'admin_back' }],
        ],
      },
    });
  } catch (e) {
    logger.error('handleShowModes error', e);
    await ctx.reply('❌ Ошибка загрузки режимов.', backKeyboard);
  }
}

async function handleLessonsMenu(ctx) {
  await ctx.reply('📚 Управление уроками\n\nВыберите действие:', lessonsManageKeyboard);
}

async function handleToggleHomeworkVisibility(ctx) {
  try {
    const { toggleHomeworkVisibility } = require('../../utils/settings');
    await toggleHomeworkVisibility();
    await handleShowModes(ctx);
  } catch (e) {
    logger.error('handleToggleHomeworkVisibility error', e);
    await ctx.reply('❌ Ошибка переключения режима.', backKeyboard);
  }
}

module.exports = {
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
  handleUsersList,
  handleUserDetail,
  handleShowModes,
  handleLessonsMenu,
  handleToggleHomeworkVisibility,
  parseBellInput,
  ROOM_PROMPT,
  promptAudienceClass,
  promptAudienceTrack,
  promptAudienceSubgroup,
};
