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
 * Get Moscow day of week 0=Mon ... 6=Sun
 * @param {Date} [date=new Date()]
 * @returns {number}
 */
function getMoscowDayOfWeek(date = new Date()) {
  return getMoscowNow(date).dayOfWeek;
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
  parseHHMM,
  isTimeBetween,
};
