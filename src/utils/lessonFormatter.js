const { parseHHMM } = require('./moscowTime');

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
  const minsToStr = (n) => `${n} мин`;
  const nowMinutes = typeof result.nowMinutes === 'number' ? result.nowMinutes : null;

  if (result.status === 'lesson') {
    const lines = [];
    lines.push(`🏫 Сейчас ${result.lessonNumber} урок — ${s(result.subjectName)}, каб. ${r(result.room)} (${range(result.currentBell)})`);
    if (nowMinutes !== null && result.currentBell) {
      try {
        const remaining = parseHHMM(result.currentBell.end) - nowMinutes;
        if (remaining >= 0) lines.push(`⏳ До конца урока: ${minsToStr(remaining)}`);
      } catch (_e) {
        void _e;
      }
    }
    if (result.nextBell && result.currentBell) {
      try {
        const breakDur = parseHHMM(result.nextBell.start) - parseHHMM(result.currentBell.end);
        if (breakDur > 0) lines.push(`☕ Перемена после урока: ${minsToStr(breakDur)} (${result.currentBell.end}–${result.nextBell.start})`);
      } catch (_e) {
        void _e;
      }
    } else if (!result.nextBell) {
      lines.push('🎉 После этого уроки закончатся');
    }
    if (result.nextLesson) {
      const nl = result.nextLesson;
      const nb = result.nextBell;
      if (nb) {
        lines.push(`➡️ Далее ${nl.lessonNumber} урок — ${s(nl.subjectName)}, каб. ${r(nl.room)} (${range(nb)})`);
      } else {
        lines.push(`➡️ Далее ${nl.lessonNumber} урок — ${s(nl.subjectName)}, каб. ${r(nl.room)}`);
      }
    } else if (result.nextBell) {
      lines.push(`➡️ Следующий звонок: ${range(result.nextBell)}`);
    }
    if (!result.room) lines.push('Кабинет не указан — обратитесь к админу');
    return lines.join('\n');
  }
  if (result.status === 'break') {
    const n = result.nextLesson;
    const b = result.nextBell;
    const prev = result.prevBell;
    const lines = [];
    if (b && prev) {
      try {
        const breakDur = parseHHMM(b.start) - parseHHMM(prev.end);
        if (breakDur > 0) {
          lines.push(`☕ Перемена ${minsToStr(breakDur)} (${prev.end}–${b.start})`);
        } else {
          lines.push(`☕ Перемена (${range(prev)} → ${range(b)})`);
        }
      } catch (_e) {
        void _e;
        lines.push(`☕ Перемена (${range(prev)} → ${range(b)})`);
      }
    } else if (b) {
      lines.push(`☕ Перемена (${range(b)} — перемена)`);
    } else {
      lines.push('☕ Перемена');
    }
    if (nowMinutes !== null && b) {
      try {
        const remaining = parseHHMM(b.start) - nowMinutes;
        if (remaining >= 0) lines.push(`⏳ До конца перемены: ${minsToStr(remaining)}`);
      } catch (_e) {
        void _e;
      }
    }
    if (n && b) {
      lines.push(`➡️ Следующий ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)} (${range(b)})`);
      if (!n.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (n) {
      lines.push(`➡️ Следующий ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)}`);
      if (!n.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (b) {
      // already shown break range, add next bell info if no lesson
      if (lines.length === 1) {
        // already have break line, keep as is
      }
    }
    // Optionally show previous lesson info
    if (result.prevLesson && lines.length > 0) {
      // prepend finished lesson info implicitly via break duration; keep minimal
    }
    return lines.join('\n');
  }
  if (result.status === 'before') {
    const n = result.nextLesson;
    const b = result.nextBell;
    const lines = [];
    lines.push('⏰ Уроки ещё не начались');
    if (n && b) {
      lines.push(`📚 Первый ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)} (${range(b)})`);
      if (!n.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (n) {
      lines.push(`📚 Первый ${n.lessonNumber} урок — ${s(n.subjectName)}, каб. ${r(n.room)}`);
      if (!n.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (b) {
      lines.push(`📚 Первый урок (${range(b)})`);
    }
    if (nowMinutes !== null && b) {
      try {
        const remaining = parseHHMM(b.start) - nowMinutes;
        if (remaining >= 0) lines.push(`⏳ До начала: ${minsToStr(remaining)}`);
      } catch (_e) {
        void _e;
      }
    }
    return lines.join('\n');
  }
  if (result.status === 'after') {
    const lines = [];
    lines.push('🎉 Уроки закончились');
    const p = result.prevLesson;
    const pb = result.prevBell;
    if (p && pb) {
      lines.push(`📚 Последний был ${p.lessonNumber} урок — ${s(p.subjectName)}, каб. ${r(p.room)} (${range(pb)})`);
      if (!p.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (p) {
      lines.push(`📚 Последний был ${p.lessonNumber} урок — ${s(p.subjectName)}, каб. ${r(p.room)}`);
      if (!p.room) lines.push('Кабинет не указан — обратитесь к админу');
    } else if (pb) {
      lines.push(`📚 Последний звонок: ${range(pb)}`);
    }
    return lines.join('\n');
  }
  return '❓ Нет данных о расписании.';
}

module.exports = {
  formatBellRow,
  formatBellSchedule,
  formatBellMap,
  formatCurrentLessonMessage,
};
