const { getDayName } = require('../../utils/dateUtils');
const scheduleService = require('../../services/scheduleService');
const lessonTimeService = require('../../services/LessonTimeService');
const { parseLessonInput, parseRoomInput } = require('../../utils/scheduleValidator');
const { validateTimeRange } = require('../../utils/lessonTimeValidator');
const { cancelKeyboard, backKeyboard } = require('../../utils/keyboards');
const { setQuickPickThreshold } = require('../../utils/quickPickSettings');
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
    console.error('Ошибка при поиске урока для редактирования:', error);
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
  const { dayOfWeek, lessonNumber } = parsed;
  try {
    const existing = await scheduleService.isSlotTaken(dayOfWeek, lessonNumber);
    if (existing) {
      await ctx.reply(`❌ Урок уже существует:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\nИспользуйте удаление для изменения.`);
      return ctx.wizard.back();
    }
    ctx.wizard.state.pending = parsed;
    ctx.wizard.state.action = 'add_room';
    await ctx.reply(ROOM_PROMPT, cancelKeyboard);
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
  try {
    const created = await scheduleService.create({ dayOfWeek, lessonNumber, subjectName, room });
    const roomSuffix = room ? ` — каб. ${room}` : '';
    await ctx.reply(`✅ Урок успешно добавлен!\n\nID: ${created.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}${roomSuffix}`, backKeyboard);
    ctx.wizard.state.pending = null;
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
async function handleEdit(ctx) {
  let parsed;
  try {
    parsed = parseLessonInput(ctx.message.text);
  } catch (e) {
    await ctx.reply(e.message, cancelKeyboard);
    return;
  }
  const { dayOfWeek, lessonNumber } = parsed;
  const editId = ctx.wizard.state.editId;
  try {
    const existing = await scheduleService.isSlotTaken(dayOfWeek, lessonNumber, editId);
    if (existing) {
      await ctx.reply(`❌ Этот слот уже занят другим уроком:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${existing.subjectName}\n\nВыберите другой слот.`, cancelKeyboard);
      return;
    }
    ctx.wizard.state.pendingEdit = parsed;
    ctx.wizard.state.action = 'edit_room';
    await ctx.reply(ROOM_PROMPT, cancelKeyboard);
  } catch (error) {
    if (error.message === 'SLOT_TAKEN') {
      await ctx.reply(`❌ Этот слот уже занят другим уроком:\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${error.existing.subjectName}\n\nВыберите другой слот.`, cancelKeyboard);
      return;
    }
    console.error('Ошибка при редактировании урока:', error);
    await ctx.reply('❌ Произошла ошибка при редактировании урока: ' + error.message, backKeyboard);
    return ctx.wizard.back();
  }
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
  try {
    const schedule = await scheduleService.update(editId, { dayOfWeek, lessonNumber, subjectName, room });
    if (!schedule) {
      await ctx.reply('❌ Урок не найден.');
      return ctx.wizard.back();
    }
    const roomSuffix = room ? ` — каб. ${room}` : '';
    await ctx.reply(`✅ Урок успешно отредактирован!\n\nID: ${schedule.id}\n${getDayName(dayOfWeek)}, ${lessonNumber} урок: ${subjectName}${roomSuffix}`, backKeyboard);
    ctx.wizard.state.pendingEdit = null;
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
    console.error('Ошибка при редактировании урока:', error);
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
    console.error('Ошибка при удалении урока:', error);
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
    console.error('Ошибка при обновлении звонков:', error);
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

module.exports = {
  handleEditSelect,
  handleAdd,
  handleAddRoom,
  handleEdit,
  handleEditRoom,
  handleDelete,
  handleBellSelect,
  handleBellTime,
  handleQuickPickThreshold,
  parseBellInput,
  ROOM_PROMPT,
};
