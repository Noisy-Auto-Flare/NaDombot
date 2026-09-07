const { Setting } = require('../models');
const { parseHHMM } = require('./moscowTime');

const QUICK_PICK_THRESHOLD_KEY = 'quick_pick_threshold';
const DEFAULT_THRESHOLD = '16:30';

/**
 * Валидировать строку HH:MM.
 * @param {string} str
 * @returns {string} нормализованная строка
 */
function validateThreshold(str) {
  if (typeof str !== 'string') {
    throw new Error('❌ Неверный формат. Используйте HH:MM, например 16:30');
  }
  const trimmed = str.trim();
  try {
    parseHHMM(trimmed);
  } catch (_e) {
    throw new Error('❌ Неверный формат. Используйте HH:MM, например 16:30');
  }
  return trimmed;
}

/**
 * Получить текущий порог быстрых кнопок.
 * @returns {Promise<string>} HH:MM
 */
async function getQuickPickThreshold() {
  try {
    const setting = await Setting.findByPk(QUICK_PICK_THRESHOLD_KEY);
    if (!setting) return DEFAULT_THRESHOLD;
    try {
      validateThreshold(setting.value);
      return setting.value;
    } catch (_e) {
      return DEFAULT_THRESHOLD;
    }
  } catch (err) {
    console.error('Ошибка при получении порога быстрых кнопок:', err);
    return DEFAULT_THRESHOLD;
  }
}

/**
 * Установить порог быстрых кнопок.
 * @param {string} hhmm
 * @returns {Promise<string>} сохранённое значение
 */
async function setQuickPickThreshold(hhmm) {
  const normalized = validateThreshold(hhmm);
  await Setting.upsert({ key: QUICK_PICK_THRESHOLD_KEY, value: normalized });
  return normalized;
}

/**
 * Порог в минутах от полуночи.
 * @param {string} hhmm
 * @returns {number}
 */
function getThresholdMinutes(hhmm) {
  return parseHHMM(hhmm);
}

/**
 * Человекочитаемая метка порога.
 * @returns {Promise<string>}
 */
async function getThresholdLabel() {
  const v = await getQuickPickThreshold();
  return v;
}

module.exports = {
  QUICK_PICK_THRESHOLD_KEY,
  DEFAULT_THRESHOLD,
  validateThreshold,
  getQuickPickThreshold,
  setQuickPickThreshold,
  getThresholdMinutes,
  getThresholdLabel,
};
