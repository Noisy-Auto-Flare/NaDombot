const { Setting } = require('../models');

const HOMEWORK_VISIBILITY_KEY = 'homework_visibility';
const HOMEWORK_VISIBILITY_PERSONAL = 'personal';
const HOMEWORK_VISIBILITY_SHARED = 'shared';

/**
 * Получить текущий режим видимости домашнего задания.
 * personal — у каждого своё (по userId)
 * shared  — общее, видно всем
 */
async function getHomeworkVisibility() {
  try {
    const setting = await Setting.findByPk(HOMEWORK_VISIBILITY_KEY);
    if (!setting) {
      return HOMEWORK_VISIBILITY_PERSONAL;
    }
    return setting.value === HOMEWORK_VISIBILITY_SHARED
      ? HOMEWORK_VISIBILITY_SHARED
      : HOMEWORK_VISIBILITY_PERSONAL;
  } catch (err) {
    console.error('Ошибка при получении настройки видимости:', err);
    return HOMEWORK_VISIBILITY_PERSONAL;
  }
}

/**
 * Установить режим видимости.
 */
async function setHomeworkVisibility(mode) {
  const normalized = mode === HOMEWORK_VISIBILITY_SHARED
    ? HOMEWORK_VISIBILITY_SHARED
    : HOMEWORK_VISIBILITY_PERSONAL;

  try {
    await Setting.upsert({
      key: HOMEWORK_VISIBILITY_KEY,
      value: normalized
    });
  } catch (err) {
    console.error('Ошибка при сохранении настройки видимости:', err);
    // persist failed — still return normalized value so callers have a deterministic result
  }

  return normalized;
}

/**
 * Переключить режим видимости и вернуть новый режим.
 */
async function toggleHomeworkVisibility() {
  const current = await getHomeworkVisibility();
  const next = current === HOMEWORK_VISIBILITY_PERSONAL
    ? HOMEWORK_VISIBILITY_SHARED
    : HOMEWORK_VISIBILITY_PERSONAL;
  await setHomeworkVisibility(next);
  return next;
}

/**
 * Человекочитаемая метка для режима.
 */
function getHomeworkVisibilityLabel(mode) {
  const normalized = mode === HOMEWORK_VISIBILITY_SHARED
    ? HOMEWORK_VISIBILITY_SHARED
    : HOMEWORK_VISIBILITY_PERSONAL;

  return normalized === HOMEWORK_VISIBILITY_SHARED
    ? 'общий для всех'
    : 'у каждого свой';
}

module.exports = {
  HOMEWORK_VISIBILITY_PERSONAL,
  HOMEWORK_VISIBILITY_SHARED,
  getHomeworkVisibility,
  setHomeworkVisibility,
  toggleHomeworkVisibility,
  getHomeworkVisibilityLabel
};

