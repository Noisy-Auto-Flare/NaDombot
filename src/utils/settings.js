const logger = require('./logger');
const { Setting } = require('../models');

const HOMEWORK_VISIBILITY_KEY = 'homework_visibility';
const HOMEWORK_VISIBILITY_PERSONAL = 'personal';
const HOMEWORK_VISIBILITY_SHARED = 'shared';

const MULTIPROFILE_KEY = 'multiprofile_enabled';

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
    logger.error('Ошибка при получении настройки видимости:', err);
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
    logger.error('Ошибка при сохранении настройки видимости:', err);
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

/**
 * Получить флаг multiprofile_enabled (bool).
 * Приоритет (P1, §5 спек): MULTIPROFILE_FORCE (если задан) > Setting в БД >
 * MULTIPROFILE_ENABLED (env, дефолт выключен для обратной совместимости).
 * @returns {Promise<boolean>}
 */
async function getMultiprofileEnabled() {
  try {
    const force = parseEnvBool(process.env.MULTIPROFILE_FORCE);
    if (force !== null) return force;
    const setting = await Setting.findByPk(MULTIPROFILE_KEY);
    if (setting) {
      const v = String(setting.value).toLowerCase();
      return v === '1' || v === 'true' || v === 'enabled';
    }
    const envDefault = parseEnvBool(process.env.MULTIPROFILE_ENABLED);
    return envDefault === true;
  } catch (err) {
    logger.error('Ошибка при получении настройки multiprofile:', err);
    return false;
  }
}

/**
 * Распарсить env-bool: '1'/'true'/'enabled'/'on' → true,
 * '0'/'false'/'disabled'/'off' → false, пусто/не задано/мусор → null.
 * @param {unknown} raw
 * @returns {boolean|null}
 */
function parseEnvBool(raw) {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === '1' || v === 'true' || v === 'enabled' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'disabled' || v === 'off') return false;
  return null;
}

/**
 * Установить флаг multiprofile_enabled.
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
async function setMultiprofileEnabled(enabled) {
  const val = enabled ? '1' : '0';
  try {
    await Setting.upsert({
      key: MULTIPROFILE_KEY,
      value: val
    });
  } catch (err) {
    logger.error('Ошибка при сохранении настройки multiprofile:', err);
  }
  return !!enabled;
}

/**
 * Alias для getMultiprofileEnabled — bool check.
 * @returns {Promise<boolean>}
 */
async function isMultiprofileEnabled() {
  return getMultiprofileEnabled();
}

module.exports = {
  HOMEWORK_VISIBILITY_PERSONAL,
  HOMEWORK_VISIBILITY_SHARED,
  MULTIPROFILE_KEY,
  getHomeworkVisibility,
  setHomeworkVisibility,
  toggleHomeworkVisibility,
  getHomeworkVisibilityLabel,
  getMultiprofileEnabled,
  setMultiprofileEnabled,
  isMultiprofileEnabled
};

