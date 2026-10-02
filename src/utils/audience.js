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
 * Поле `scope` ('own'|'all') пробрасывается как есть (P2) — используется
 * getAudienceWhere/isVisibleWithScope, на SQL-фильтр трека/подгруппы не влияет
 * при scope='all' (только класс).
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
  const out = {
    classId,
    trackId: trackId && String(trackId).length ? String(trackId) : null,
    subgroupId: subgroupId && String(subgroupId).length ? String(subgroupId) : null
  };
  if (profile.scope === 'all' || profile.scope === 'own') out.scope = profile.scope;
  return out;
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
  // P2 scope='all' (наблюдатель): только класс, без фильтра трека/подгруппы
  if (normalized.scope === 'all') return { classId };
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
  isVisibleWithScope,
  isSubgroupOnlyChoice,
  getEffectiveScope,
  buildAudienceTag,
  shortTrackLabel,
  shortSubgroupLabel,
  getAudienceWhere,
  normalizeAudience
};

/**
 * Эффективный scope с учётом мастер-флага (P2 §3.1):
 * master OFF ≡ принудительный 'all' для всех.
 * @param {object|null} userProfile
 * @param {boolean} multiprofileEnabled
 * @returns {'own'|'all'}
 */
function getEffectiveScope(userProfile, multiprofileEnabled) {
  if (!multiprofileEnabled) return 'all';
  if (userProfile && userProfile.scope === 'all') return 'all';
  return 'own';
}

/**
 * Видимость урока с учётом scope (P2 §3.1).
 * scope='all' (или master OFF): совпадение только по classId, трек/подгруппа не фильтруют.
 * Иначе — строгий isVisible.
 * @param {object} schedule - строка расписания
 * @param {object} userProfile - профиль пользователя (может содержать scope)
 * @param {boolean} multiprofileEnabled
 * @returns {boolean}
 */
function isVisibleWithScope(schedule, userProfile, multiprofileEnabled) {
  if (!schedule || !userProfile) return false;
  if (!multiprofileEnabled) return true;
  if (userProfile.scope === 'all') {
    const sClass = schedule.classId != null && String(schedule.classId).trim() ? String(schedule.classId).trim() : null;
    const uClass = userProfile.classId != null && String(userProfile.classId).trim() ? String(userProfile.classId).trim() : null;
    if (!uClass || !sClass) return true;
    return sClass === uClass;
  }
  return isVisible(schedule, userProfile);
}

/**
 * Отличаются ли варианты расписания ТОЛЬКО подгруппой (F11, без хардкода предмета):
 * класс/день/урок/трек/предмет совпадают, а subgroupId — разные (≥2).
 * Кабинет не сравниваем: он следует за подгруппой, а не ось выбора.
 * @param {Array} variants - строки расписания (Sequelize или plain)
 * @returns {boolean}
 */
function isSubgroupOnlyChoice(variants) {
  if (!Array.isArray(variants) || variants.length < 2) return false;
  const norm = (v) => (v == null ? '' : String(v));
  const first = variants[0];
  const base = `${norm(first.classId)}|${first.dayOfWeek}|${first.lessonNumber}|${norm(first.trackId)}|${norm(first.subjectName)}`;
  const subs = new Set();
  for (const v of variants) {
    const key = `${norm(v.classId)}|${v.dayOfWeek}|${v.lessonNumber}|${norm(v.trackId)}|${norm(v.subjectName)}`;
    if (key !== base) return false;
    subs.add(norm(v.subgroupId));
  }
  return subs.size > 1;
}

/**
 * Короткие подписи треков для тегов (примеры из спек: tech→«Тех», soc→«Соц.-эконом.»).
 * Неизвестные id — первое слово полного имени, иначе сам id.
 * @param {string|null} trackId
 * @param {string|null} trackName
 * @returns {string} '' если ни id, ни имени нет
 */
function shortTrackLabel(trackId, trackName) {
  const SHORT = { tech: 'Тех', soc: 'Соц.-эконом.' };
  if (trackId && SHORT[trackId]) return SHORT[trackId];
  if (trackName && String(trackName).trim()) return String(trackName).trim().split(/\s+/)[0];
  if (trackId && String(trackId).trim()) return String(trackId).trim();
  return '';
}

/**
 * Короткая подпись подгруппы для тегов: имя (уже короткое: «Белова»),
 * иначе фамилия из teacher («Белова И.В.» → «Белова»), иначе id.
 * @param {string|null} subgroupId
 * @param {string|null} subgroupName
 * @param {string|null} teacher
 * @returns {string} '' если всё пусто
 */
function shortSubgroupLabel(subgroupId, subgroupName, teacher) {
  if (subgroupName && String(subgroupName).trim()) return String(subgroupName).trim();
  if (teacher && String(teacher).trim()) return String(teacher).trim().split(/\s+/)[0];
  if (subgroupId && String(subgroupId).trim()) return String(subgroupId).trim();
  return '';
}

/**
 * Тег аудитории урока по шаблону tags.template из audience.json (P2 §4).
 * Пустые фасеты выпадают; класс — только при showClass; сегментов не больше maxSegments.
 * Общий урок (все фасеты пусты) → '' (тег не нужен).
 * @param {object} schedule - {classId, trackId, subgroupId}
 * @param {{trackNames?: Map<string,string>, subgroupNames?: Map<string,{name:string|null,teacher:string|null}>}} [lookups]
 * @param {{template?: string, showClass?: boolean, maxSegments?: number}} [tagsConfig]
 * @returns {string} '' или '[Тех · Белова]'
 */
function buildAudienceTag(schedule, lookups = {}, tagsConfig = {}) {
  const template = (tagsConfig && tagsConfig.template) || '{track} · {subgroup}';
  const showClass = !!(tagsConfig && tagsConfig.showClass);
  const maxSegments = (tagsConfig && Number.isInteger(tagsConfig.maxSegments) && tagsConfig.maxSegments > 0)
    ? tagsConfig.maxSegments
    : 4;
  const trackNames = (lookups && lookups.trackNames) || new Map();
  const subgroupNames = (lookups && lookups.subgroupNames) || new Map();

  const trackSeg = schedule.trackId
    ? shortTrackLabel(schedule.trackId, trackNames.get(schedule.trackId) || null)
    : '';
  let subSeg = '';
  if (schedule.subgroupId) {
    const info = subgroupNames.get(schedule.subgroupId) || {};
    subSeg = shortSubgroupLabel(schedule.subgroupId, info.name || null, info.teacher || null);
  }
  const classSeg = showClass && schedule.classId ? String(schedule.classId) : '';

  const filled = String(template)
    .replace('{track}', trackSeg)
    .replace('{subgroup}', subSeg)
    .replace('{class}', classSeg);
  const segments = filled.split('·').map((s) => s.trim()).filter((s) => s.length > 0).slice(0, maxSegments);
  if (segments.length === 0) return '';
  return `[${segments.join(' · ')}]`;
}
