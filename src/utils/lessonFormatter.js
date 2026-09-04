/**
 * Format bell schedule rows
 */

/**
 * Format single bell row
 * @param {{lessonNumber:number,startTime:string,endTime:string}} row
 * @returns {string}
 */
function formatBellRow(row) {
  return `${row.lessonNumber} урок: ${row.startTime}–${row.endTime}`;
}

/**
 * Format full schedule array into multiline text
 * @param {Array<{lessonNumber:number,startTime:string,endTime:string}>} rows
 * @param {string} [header]
 * @returns {string}
 */
function formatBellSchedule(rows, header = '🔔 Расписание звонков:\n') {
  if (!rows || rows.length === 0) return `${header}(пусто)`;
  const sorted = [...rows].sort((a, b) => a.lessonNumber - b.lessonNumber);
  return header + sorted.map(formatBellRow).join('\n');
}

/**
 * Format Map<number,{start,end}> into text
 * @param {Map<number,{start:string,end:string}>} map
 * @returns {string}
 */
function formatBellMap(map) {
  if (!map || map.size === 0) return '🔔 Расписание звонков:\n(пусто)';
  const rows = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lessonNumber, v]) => ({ lessonNumber, startTime: v.start, endTime: v.end }));
  return formatBellSchedule(rows);
}

function formatCurrentLessonMessage(result) {
  if (!result || !result.status) return '❓ Нет данных о расписании.';
  const r = (room) => (room ? String(room) : 'не указан');
  const s = (sub) => (sub ? String(sub) : '—');
  const range = (b) => (b ? `${b.start}–${b.end}` : '');
  if (result.status === 'lesson') {
    const msg = `🏫 Сейчас ${result.lessonNumber} урок — ${s(result.subjectName)}, каб. ${r(result.room)} (${range(result.currentBell)})`;
    return !result.room ? `${msg}\nКабинет не указан — обратитесь к админу` : msg;
  }
  if (result.status === 'break') {
    const n = result.nextLesson;
    const b = result.nextBell;
    if (n) {
      const msg = `☕ Перемена, следующий ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)} (${range(b)})`;
      return !n.room ? `${msg}\nКабинет не указан — обратитесь к админу` : msg;
    }
    return b ? `☕ Перемена (${range(b)} — перемена)` : '☕ Перемена';
  }
  if (result.status === 'before') {
    const n = result.nextLesson;
    const b = result.nextBell;
    if (n) {
      const msg = `⏰ Уроки ещё не начались, первый ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)} (${range(b)})`;
      return !n.room ? `${msg}\nКабинет не указан — обратитесь к админу` : msg;
    }
    return b ? `⏰ Уроки ещё не начались, первый урок (${range(b)})` : '⏰ Уроки ещё не начались';
  }
  if (result.status === 'after') return '🎉 Уроки закончились';
  return '❓ Нет данных о расписании.';
}

module.exports = {
  formatBellRow,
  formatBellSchedule,
  formatBellMap,
  formatCurrentLessonMessage,
};
