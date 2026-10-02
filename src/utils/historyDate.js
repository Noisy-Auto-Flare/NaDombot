const { getMoscowNow } = require('./moscowTime');

const HISTORY_DATE_PROMPT = '📅 Введите дату в формате ДД.ММ[.ГГГГ] (например 05.10 или 05.10.2025):';
const HISTORY_DATE_ERROR =
  '❌ Неверная дата. Введите в формате ДД.ММ[.ГГГГ] (день 1–31, месяц 1–12, год необязателен), например 05.10.2025:';

/**
 * Парс ввода даты истории: `ДД.ММ[.ГГГГ|ГГ]` (разделители `. - / space`).
 * Год 2 цифры → 20YY, 4 цифры → как есть. Без года — текущий год по Москве;
 * если результат в БУДУЩЕМ (история смотрит назад) — минус год. Явный год всегда побеждает.
 * Валидация: день 1–31, месяц 1–12, реальная дата существует.
 * @param {string} text - сырой ввод пользователя
 * @param {Date} [now] - база для текущего года (по умолчанию сейчас)
 * @returns {Date} дата в полдень локального времени (как getMoscowToday)
 * @throws {Error} HISTORY_BAD_DATE при невалидном вводе
 */
function parseHistoryDateInput(text, now) {
  const raw = String(text == null ? '' : text).trim();
  const m = raw.match(/^(\d{1,2})[.\-/ ](\d{1,2})(?:[.\-/ ](\d{2}|\d{4}))?$/);
  if (!m) throw new Error('HISTORY_BAD_DATE');
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('HISTORY_BAD_DATE');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('HISTORY_BAD_DATE');
  let year;
  let explicitYear = false;
  if (m[3] != null) {
    explicitYear = true;
    if (m[3].length === 2) {
      year = 2000 + Number(m[3]);
    } else {
      year = Number(m[3]);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('HISTORY_BAD_DATE');
    }
  } else {
    try {
      const { isoDate } = getMoscowNow(now);
      year = Number(String(isoDate).slice(0, 4));
    } catch (_e) {
      year = (now instanceof Date ? now : new Date()).getFullYear();
    }
    if (!Number.isInteger(year)) throw new Error('HISTORY_BAD_DATE');
  }
  const build = (y) => new Date(y, month - 1, day, 12, 0, 0, 0);
  let date = build(year);
  // проверка существования даты (31.02 → 03.03 и т.п.)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('HISTORY_BAD_DATE');
  }
  if (!explicitYear) {
    // история смотрит назад: дата в будущем → прошлый год
    let today;
    try {
      const { isoDate } = getMoscowNow(now);
      const [ty, tm, td] = String(isoDate).split('-').map(Number);
      today = new Date(ty, tm - 1, td, 12, 0, 0, 0);
    } catch (_e) {
      const base = now instanceof Date ? now : new Date();
      today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0, 0, 0);
    }
    if (date > today) {
      year -= 1;
      date = build(year);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new Error('HISTORY_BAD_DATE');
      }
    }
  }
  return date;
}

module.exports = { parseHistoryDateInput, HISTORY_DATE_PROMPT, HISTORY_DATE_ERROR };
