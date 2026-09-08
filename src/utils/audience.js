const { Op } = require('sequelize');

/**
 * @typedef {object} AudienceSchedule
 * @property {string} classId - FK → Class.id
 * @property {string|null} trackId - FK → Track.id, null = общий для всех треков
 * @property {string|null} subgroupId - FK → Subgroup.id, null = общий для всех подгрупп
 */

/**
 * @typedef {object} UserAudienceProfile
 * @property {string} classId - класс пользователя
 * @property {string|null} [trackId] - трек пользователя
 * @property {string|null} [subgroupId] - подгруппа пользователя
 */

/**
 * Нормализовать профиль аудитории: trim, null для пустых строк.
 * @param {UserAudienceProfile|null|undefined} profile
 * @returns {UserAudienceProfile|null} нормализованный профиль или null если нет classId
 */
function normalizeAudience(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const classId = typeof profile.classId === 'string' ? profile.classId.trim() : profile.classId;
  if (!classId) return null;
  const trackIdRaw = profile.trackId;
  const subgroupIdRaw = profile.subgroupId;
  const trackId = typeof trackIdRaw === 'string' ? trackIdRaw.trim() : trackIdRaw;
  const subgroupId = typeof subgroupIdRaw === 'string' ? subgroupIdRaw.trim() : subgroupIdRaw;
  return {
    classId,
    trackId: trackId && String(trackId).length ? String(trackId) : null,
    subgroupId: subgroupId && String(subgroupId).length ? String(subgroupId) : null
  };
}

/**
 * Виден ли урок расписания пользователю с данным профилем.
 * Правило: класс строго совпадает, трек/подгруппа — либо общие (null), либо совпадают.
 * @param {AudienceSchedule} schedule - строка расписания
 * @param {UserAudienceProfile} userProfile - профиль пользователя
 * @returns {boolean}
 */
function isVisible(schedule, userProfile) {
  if (!schedule || !userProfile) return false;
  const s = normalizeAudience(schedule) || schedule;
  const u = normalizeAudience(userProfile) || userProfile;
  // classId обязателен и сравнивается строго
  if (s.classId !== u.classId) return false;
  // trackId: null → видно всем; иначе только совпадающему треку
  if (s.trackId != null && s.trackId !== u.trackId) return false;
  // subgroupId аналогично
  if (s.subgroupId != null && s.subgroupId !== u.subgroupId) return false;
  return true;
}

/**
 * Построить Sequelize where-фильтр для видимых пользователю уроков.
 * Генерирует условие: classId = profile.classId AND (trackId IS NULL OR trackId = profile.trackId)
 * AND (subgroupId IS NULL OR subgroupId = profile.subgroupId)
 * @param {UserAudienceProfile|null|undefined} userProfile
 * @returns {object} where-объект для Sequelize findAll
 * @example
 * Schedule.findAll({ where: getAudienceWhere(profile) })
 */
function getAudienceWhere(userProfile) {
  const normalized = normalizeAudience(userProfile);
  if (!normalized) return {};
  const { classId, trackId, subgroupId } = normalized;
  const where = { classId };

  // trackId: null — общий; иначе должен совпасть либо быть null
  if (trackId == null) {
    // у пользователя нет трека — ему видны только общие уроки
    where.trackId = { [Op.is]: null };
  } else {
    where.trackId = { [Op.or]: [{ [Op.is]: null }, trackId] };
  }

  if (subgroupId == null) {
    where.subgroupId = { [Op.is]: null };
  } else {
    where.subgroupId = { [Op.or]: [{ [Op.is]: null }, subgroupId] };
  }

  return where;
}

module.exports = {
  isVisible,
  getAudienceWhere,
  normalizeAudience
};
