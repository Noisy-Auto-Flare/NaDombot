/**
 * Moscow wall-clock utilities using native Intl.DateTimeFormat
 * Timezone Europe/Moscow, no external deps, works when host TZ=UTC
 */

const WEEKDAY_MAP = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function getMoscowParts(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return map;
}

/**
 * Get Moscow wall-clock for a given date (or now)
 * @param {Date} [date=new Date()]
 * @returns {{dayOfWeek:number,hours:number,minutes:number,hhmm:string,dateStr:string,isoDate:string}}
 */
function getMoscowNow(date = new Date()) {
  const p = getMoscowParts(date);
  let hours = Number(p.hour);
  // Some engines may return 24 at midnight with h23; normalize
  if (hours === 24) hours = 0;
  const minutes = Number(p.minute);
  const dayOfWeek = WEEKDAY_MAP[p.weekday];
  const hhmm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const dateStr = `${p.day}.${p.month}.${p.year}`;
  const isoDate = `${p.year}-${p.month}-${p.day}`;
  return { dayOfWeek, hours, minutes, hhmm, dateStr, isoDate };
}

/**
 * Get Moscow day of week 0=Mon ... 6=Sun for an INSTANT ("now").
 * RULE (P0 hotfix): use ONLY for instant-«сейчас» inputs (default `new Date()`:
 * findNextLesson fromDate, handleCurrentLesson, scene entry points).
 * NEVER apply to calendar dates — for those use getCalendarDayOfWeek.
 * Why: at 00:00–03:00 MSK the Moscow day of the instant already differs
 * from the calendar day of the date (e.g. Mon 21:29 UTC → Moscow Tue 00:29).
 * @param {Date} [date=new Date()]
 * @returns {number}
 */
function getMoscowDayOfWeek(date = new Date()) {
  return getMoscowNow(date).dayOfWeek;
}

/**
 * Get CALENDAR day of week 0=Mon ... 6=Sun of the date's own Y-M-D.
 * For calendar dates (day views, homework dates, keyboards, headers).
 * TZ-stable: derives the weekday from Y-M-D parts only (via UTC noon),
 * so noon dates and YYYY-MM-DD strings give the same result on any host TZ.
 * Invariant: schedule weekday == header weekday == homework-row weekday —
 * all three must come from the same Y-M-D via this helper.
 * @param {Date|string} date - Date (noon calendar dates) or 'YYYY-MM-DD'
 * @returns {number}
 */
function getCalendarDayOfWeek(date) {
  let y;
  let m;
  let d;
  if (typeof date === 'string') {
    const parts = String(date).split('-').map(Number);
    [y, m, d] = parts;
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
      throw new Error(`Invalid calendar date: ${date}`);
    }
  } else if (date instanceof Date) {
    y = date.getFullYear();
    m = date.getMonth() + 1;
    d = date.getDate();
  } else {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const utcDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return utcDay === 0 ? 6 : utcDay - 1;
}

/**
 * Moscow calendar "today" as a local noon Date (no day-shift on any host TZ).
 * Single source of truth for week/day bases (getNextWorkDay/getWeekDates
 * entry points must start from this, not from `new Date()`).
 * Moved here from history.js — history.js re-exports it, do not duplicate.
 * @param {Date} [instant=new Date()] - «сейчас» для вычисления московской даты
 * @returns {Date}
 */
function getMoscowToday(instant = new Date()) {
  const { isoDate } = getMoscowNow(instant);
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Parse 'YYYY-MM-DD' into a local noon Date (calendar-date safe).
 * `new Date('YYYY-MM-DD')` is UTC midnight and shifts headers/weekdays
 * depending on host TZ — always use this for callback isoDates.
 * @param {string} isoDate - 'YYYY-MM-DD'
 * @returns {Date}
 */
function parseCalendarDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new Error(`Invalid calendar date: ${isoDate}`);
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Parse HH:MM to minutes since midnight
 * @param {string} str
 * @returns {number}
 */
function parseHHMM(str) {
  if (typeof str !== 'string') throw new Error(`Invalid HH:MM: ${str}`);
  const m = str.match(/^(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid HH:MM: ${str}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`Invalid HH:MM: ${str}`);
  return h * 60 + min;
}

/**
 * Check if time is between start inclusive and end exclusive
 * @param {number} nowMinutes
 * @param {string} startHHMM
 * @param {string} endHHMM
 * @returns {boolean}
 */
function isTimeBetween(nowMinutes, startHHMM, endHHMM) {
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  if (start <= end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  // wraps over midnight
  return nowMinutes >= start || nowMinutes < end;
}

module.exports = {
  getMoscowNow,
  getMoscowDayOfWeek,
  getCalendarDayOfWeek,
  getMoscowToday,
  parseCalendarDate,
  parseHHMM,
  isTimeBetween,
};
