const { getMoscowNow, parseHHMM, isTimeBetween } = require('./moscowTime');

function findRow(rows, lessonNumber, todayDay) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const withDay = rows.find((r) => r.lessonNumber === lessonNumber && r.dayOfWeek === todayDay);
  if (withDay) return withDay;
  const hasDay = rows.some((r) => r.dayOfWeek !== undefined);
  if (hasDay && todayDay !== null && todayDay !== undefined) {
    return rows.find((r) => r.lessonNumber === lessonNumber) || null;
  }
  return rows.find((r) => r.lessonNumber === lessonNumber) || null;
}

function toInfo(row) {
  if (!row) return null;
  return { lessonNumber: row.lessonNumber, subjectName: row.subjectName ?? null, room: row.room ?? null, dayOfWeek: row.dayOfWeek ?? null };
}

function resolveCurrentLesson({ now, scheduleRows, bellMap }) {
  const rows = Array.isArray(scheduleRows) ? scheduleRows : [];
  const map = bellMap instanceof Map ? bellMap : new Map();
  let nowMinutes;
  let todayDay = null;
  if (now instanceof Date) {
    const m = getMoscowNow(now);
    nowMinutes = parseHHMM(m.hhmm);
    todayDay = m.dayOfWeek;
  } else if (typeof now === 'string') {
    nowMinutes = parseHHMM(now);
  } else if (now && typeof now === 'object' && typeof now.hours === 'number' && typeof now.minutes === 'number') {
    nowMinutes = now.hours * 60 + now.minutes;
    if (typeof now.dayOfWeek === 'number') todayDay = now.dayOfWeek;
  } else if (now && typeof now === 'object' && typeof now.hhmm === 'string') {
    nowMinutes = parseHHMM(now.hhmm);
    if (typeof now.dayOfWeek === 'number') todayDay = now.dayOfWeek;
  } else {
    const m = getMoscowNow(new Date());
    nowMinutes = parseHHMM(m.hhmm);
    todayDay = m.dayOfWeek;
  }
  const bells = [];
  for (const [lessonNumber, v] of map.entries()) {
    bells.push({ lessonNumber, start: v.start, end: v.end, startMin: parseHHMM(v.start), endMin: parseHHMM(v.end) });
  }
  bells.sort((a, b) => a.lessonNumber - b.lessonNumber);
  if (bells.length === 0) {
    return { status: 'before', lessonNumber: null, subjectName: null, room: null, currentBell: null, nextBell: null, prevBell: null, nextLesson: null, prevLesson: null };
  }
  const first = bells[0];
  const last = bells[bells.length - 1];
  if (nowMinutes < first.startMin) {
    return { status: 'before', lessonNumber: null, subjectName: null, room: null, currentBell: null, nextBell: { start: first.start, end: first.end }, prevBell: null, nextLesson: toInfo(findRow(rows, first.lessonNumber, todayDay)), prevLesson: null };
  }
  if (nowMinutes >= last.endMin) {
    return { status: 'after', lessonNumber: null, subjectName: null, room: null, currentBell: null, nextBell: null, prevBell: { start: last.start, end: last.end }, nextLesson: null, prevLesson: toInfo(findRow(rows, last.lessonNumber, todayDay)) };
  }
  for (let i = 0; i < bells.length; i++) {
    const b = bells[i];
    if (isTimeBetween(nowMinutes, b.start, b.end)) {
      const row = findRow(rows, b.lessonNumber, todayDay);
      const prevBell = i > 0 ? { start: bells[i - 1].start, end: bells[i - 1].end } : null;
      const nextBell = i < bells.length - 1 ? { start: bells[i + 1].start, end: bells[i + 1].end } : null;
      const prevRow = i > 0 ? findRow(rows, bells[i - 1].lessonNumber, todayDay) : null;
      const nextRow = i < bells.length - 1 ? findRow(rows, bells[i + 1].lessonNumber, todayDay) : null;
      return { status: 'lesson', lessonNumber: b.lessonNumber, subjectName: row ? (row.subjectName ?? null) : null, room: row ? (row.room ?? null) : null, currentBell: { start: b.start, end: b.end }, nextBell, prevBell, nextLesson: toInfo(nextRow), prevLesson: toInfo(prevRow) };
    }
  }
  for (let i = 0; i < bells.length - 1; i++) {
    const cur = bells[i];
    const nxt = bells[i + 1];
    if (nowMinutes >= cur.endMin && nowMinutes < nxt.startMin) {
      return { status: 'break', lessonNumber: null, subjectName: null, room: null, currentBell: null, nextBell: { start: nxt.start, end: nxt.end }, prevBell: { start: cur.start, end: cur.end }, nextLesson: toInfo(findRow(rows, nxt.lessonNumber, todayDay)), prevLesson: toInfo(findRow(rows, cur.lessonNumber, todayDay)) };
    }
  }
  return { status: 'break', lessonNumber: null, subjectName: null, room: null, currentBell: null, nextBell: null, prevBell: null, nextLesson: null, prevLesson: null };
}

module.exports = { resolveCurrentLesson };
