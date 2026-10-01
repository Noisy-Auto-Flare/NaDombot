const { getHomeworkForDate, mergeHomeworkBySchedule, splitMessageChunks } = require('./scheduleUtils');
const { getMoscowNow } = require('./moscowTime');

/**
 * P3 §13.3 — История ДЗ вместо автоудаления.
 * Прошлое листается (недели/месяцы назад), ничего не удаляется.
 * Скоуп = профиль/scope/visibility — через getHomeworkForDate на каждую дату.
 * Компактный плотный вид: `DD.MM — Предмет: текст` (без украшений).
 */

const HISTORY_MAX_DAYS = 62;
const HISTORY_MAX_WEEK_OFFSET = 7;

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

/**
 * Сегодня по Москве как локальный Date (полдень — без сдвигов суток).
 * @returns {Date}
 */
function getMoscowToday() {
  const { isoDate } = getMoscowNow();
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * YYYY-MM-DD по локальным частям даты.
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * DD.MM для компактного вида.
 * @param {Date} date
 * @returns {string}
 */
function formatDDMM(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}`;
}

/**
 * Сдвиг даты на n дней (полдень сохраняется).
 * @param {Date} date
 * @param {number} n
 * @returns {Date}
 */
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * История за диапазон дат включительно (прошлое и сегодня; будущее отсекается).
 * Скоуп/visibility — внутри getHomeworkForDate.
 * @param {string|number} userId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array<{date: Date, schedules: Array, homeworks: Array}>>}
 */
async function getHistoryForRange(userId, startDate, endDate) {
  const today = getMoscowToday();
  const end = endDate > today ? today : new Date(endDate);
  const start = new Date(startDate);
  const daysCount = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  if (daysCount <= 0) return [];
  if (daysCount > HISTORY_MAX_DAYS) throw new Error('HISTORY_RANGE_TOO_BIG');

  const days = [];
  for (let i = 0; i < daysCount; i++) {
    const date = addDays(start, i);
    days.push(await getHomeworkForDate(userId, date));
  }
  return days;
}

/**
 * Недельное окно истории: 7 дней, конец = сегодня − offset*7.
 * @param {string|number} userId
 * @param {number} [weekOffset=0] - недель назад (0 — текущая)
 * @returns {Promise<{days: Array, start: Date, end: Date, offset: number}>}
 */
async function getHistoryWeek(userId, weekOffset = 0) {
  const offset = Math.max(0, Math.min(HISTORY_MAX_WEEK_OFFSET, Number(weekOffset) || 0));
  const today = getMoscowToday();
  const end = addDays(today, -offset * 7);
  const start = addDays(end, -6);
  const days = await getHistoryForRange(userId, start, end);
  return { days, start, end, offset };
}

/**
 * История за календарный месяц (с 1-го числа по сегодня/конец месяца).
 * @param {string|number} userId
 * @param {number} year
 * @param {number} month - 1-12
 * @returns {Promise<{days: Array, start: Date, end: Date}>}
 */
async function getHistoryMonth(userId, year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('HISTORY_BAD_MONTH');
  }
  const today = getMoscowToday();
  const start = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const lastDay = new Date(year, month, 0, 12, 0, 0, 0);
  const end = lastDay > today ? today : lastDay;
  if (start > today) return { days: [], start, end: start };
  const days = await getHistoryForRange(userId, start, end);
  return { days, start, end };
}

/**
 * Последние n месяцев (текущий + предыдущие) для кнопок выбора месяца.
 * @param {number} [count=3]
 * @returns {Array<{year: number, month: number, label: string, callback: string}>}
 */
function getRecentMonths(count = 3) {
  const today = getMoscowToday();
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1, 12, 0, 0, 0);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const mm = String(month).padStart(2, '0');
    out.push({
      year,
      month,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      callback: `history_month:${year}-${mm}`
    });
  }
  return out;
}

/**
 * Компактный плотный вид истории: `DD.MM — Предмет: текст` (без украшений).
 * Дубли одного урока схлопнуты (дедуп как в merged-view); пустые уроки пропущены.
 * @param {Array<{date: Date, schedules: Array, homeworks: Array}>} daysData
 * @returns {string}
 */
function formatHistoryCompact(daysData) {
  const lines = [];
  for (const day of daysData || []) {
    if (!day || !day.date) continue;
    const ddmm = formatDDMM(day.date instanceof Date ? day.date : new Date(day.date));
    const byId = new Map();
    for (const s of day.schedules || []) byId.set(s.id, s);
    const merged = mergeHomeworkBySchedule(day.homeworks);
    const ordered = [...(day.schedules || [])].sort((a, b) => {
      if (a.lessonNumber !== b.lessonNumber) return a.lessonNumber - b.lessonNumber;
      return (a.id || 0) - (b.id || 0);
    });
    for (const schedule of ordered) {
      const texts = merged.get(schedule.id);
      if (!texts || texts.length === 0) continue;
      const subject = schedule.subjectName || 'Урок';
      for (const text of texts) {
        lines.push(`${ddmm} — ${subject}: ${text}`);
      }
    }
  }
  if (lines.length === 0) return 'За этот период домашних заданий нет.';
  return lines.join('\n');
}

/**
 * Разбить компактную историю на чанки для отправки (лимит 4000, как везде).
 * @param {string} text
 * @returns {Array<string>}
 */
function splitHistoryChunks(text) {
  return splitMessageChunks(text);
}

module.exports = {
  HISTORY_MAX_DAYS,
  HISTORY_MAX_WEEK_OFFSET,
  getMoscowToday,
  toISODate,
  formatDDMM,
  addDays,
  getHistoryForRange,
  getHistoryWeek,
  getHistoryMonth,
  getRecentMonths,
  formatHistoryCompact,
  splitHistoryChunks
};
