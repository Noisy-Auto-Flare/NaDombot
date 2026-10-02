const { getMoscowNow } = require('./moscowTime');

const HISTORY_DATE_PROMPT = '📅 Введите дату в формате ДД.ММ (например 05.10):';
const HISTORY_DATE_ERROR = '❌ Неверная дата. Введите в формате ДД.ММ (день 1–31, месяц 1–12), например 05.10:';

/**
 * Парс ввода даты истории: `ДД.ММ` (год — текущий по Москве).
 * Валидация: день 1–31, месяц 1–12, реальная дата существует.
 * @param {string} text - сырой ввод пользователя
 * @param {Date} [now] - база для текущего года (по умолчанию сейчас)
 * @returns {Date} дата в полдень локального времени (как getMoscowToday)
 * @throws {Error} HISTORY_BAD_DATE при невалидном вводе
 */
function parseHistoryDateInput(text, now) {
  const raw = String(text == null ? '' : text).trim();
  const m = raw.match(/^(\d{1,2})[.\-/ ](\d{1,2})$/);
  if (!m) throw new Error('HISTORY_BAD_DATE');
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('HISTORY_BAD_DATE');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('HISTORY_BAD_DATE');
  let year;
  try {
    const { isoDate } = getMoscowNow(now);
    year = Number(String(isoDate).slice(0, 4));
  } catch (_e) {
    year = (now instanceof Date ? now : new Date()).getFullYear();
  }
  if (!Number.isInteger(year)) throw new Error('HISTORY_BAD_DATE');
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // проверка существования даты (31.02 → 03.03 и т.п.)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('HISTORY_BAD_DATE');
  }
  return date;
}

module.exports = { parseHistoryDateInput, HISTORY_DATE_PROMPT, HISTORY_DATE_ERROR };
