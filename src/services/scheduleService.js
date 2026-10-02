const { Op } = require('sequelize');
const { Schedule, Homework } = require('../models');
const { subjectsMatch, normalizeSubject } = require('../utils/subjectNormalizer');
const { isVisibleWithScope } = require('../utils/audience');

/**
 * Сервисный слой для расписания — изолирует Sequelize от сцен
 */

function sanitizeSubjectForDisplay(subjectName) {
  if (subjectName == null) return '';
  const s = String(subjectName).normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const stripped = s.replace(/[.,;:!?]+$/g, '').trim();
  return stripped;
}

function sanitizeRoom(room) {
  if (room == null) return null;
  const r = String(room).trim();
  if (!r || r === '-') return null;
  return r;
}

function sanitizeClassId(classId) {
  if (classId == null) return '10А';
  const v = String(classId).trim();
  return v || '10А';
}

function sanitizeTrackId(trackId) {
  if (trackId == null) return null;
  const v = String(trackId).trim();
  return v || null;
}

function sanitizeSubgroupId(subgroupId) {
  if (subgroupId == null) return null;
  const v = String(subgroupId).trim();
  return v || null;
}

async function findById(id) {
  return Schedule.findByPk(id);
}

async function findAll() {
  return Schedule.findAll({
    order: [
      ['dayOfWeek', 'ASC'],
      ['lessonNumber', 'ASC'],
    ],
  });
}

async function findAllGroupedByDay() {
  const schedules = await findAll();
  const { groupByDay } = require('../utils/scheduleFormatter');
  return { schedules, grouped: groupByDay(schedules) };
}

/**
 * Проверить занятость слота с учётом аудитории.
 * Поддерживает старый вызов isSlotTaken(day,lesson,excludeId)
 * и новый isSlotTaken(day,lesson,{classId,trackId,subgroupId},excludeId)
 * Точное совпадение аудитории (не isVisible) — разные аудитории не конфликтуют.
 * @param {number} dayOfWeek
 * @param {number} lessonNumber
 * @param {object|number|null} audienceOrExcludeId
 * @param {number|null} excludeId
 * @returns {Promise<Schedule|null>}
 */
async function isSlotTaken(dayOfWeek, lessonNumber, audienceOrExcludeId = null, excludeId = null) {
  let audience = null;
  let exclude = null;
  if (
    audienceOrExcludeId != null &&
    typeof audienceOrExcludeId === 'object' &&
    !Array.isArray(audienceOrExcludeId) &&
    ('classId' in audienceOrExcludeId ||
      'trackId' in audienceOrExcludeId ||
      'subgroupId' in audienceOrExcludeId)
  ) {
    audience = audienceOrExcludeId;
    exclude = excludeId;
  } else {
    audience = null;
    exclude = audienceOrExcludeId;
  }

  const where = { dayOfWeek, lessonNumber };
  if (audience) {
    const classId = sanitizeClassId(audience.classId);
    where.classId = classId;
    const trackId = sanitizeTrackId(audience.trackId);
    where.trackId = trackId == null ? { [Op.is]: null } : trackId;
    const subgroupId = sanitizeSubgroupId(audience.subgroupId);
    where.subgroupId = subgroupId == null ? { [Op.is]: null } : subgroupId;
  }
  if (exclude != null) {
    where.id = { [Op.ne]: exclude };
  }
  return Schedule.findOne({ where });
}

/**
 * Case-insensitive find by subject (Cyrillic-safe).
 * Поддерживает старый вызов findBySubjectNormalized(input, dayNumber)
 * и новый findBySubjectNormalized(input, {classId,trackId,subgroupId,dayOfWeek})
 * Фильтрует по аудитории через isVisibleWithScope если audience передан и flag включен.
 * @param {string} input
 * @param {object|number|null} options
 * @param {number|null} maybeDayOfWeek - для поддержки 3-arg вызова
 * @returns {Promise<Array>}
 */
async function findBySubjectNormalized(input, options = null, maybeDayOfWeek = null) {
  let audience = null;
  let dayOfWeek = null;

  if (typeof options === 'number') {
    dayOfWeek = options;
  } else if (options && typeof options === 'object') {
    const hasAudience =
      'classId' in options || 'trackId' in options || 'subgroupId' in options;
    if (hasAudience) {
      audience = {
        classId: options.classId,
        trackId: options.trackId,
        subgroupId: options.subgroupId
      };
      if (options.dayOfWeek != null) dayOfWeek = options.dayOfWeek;
      if (maybeDayOfWeek != null) dayOfWeek = maybeDayOfWeek;
    } else if (options.dayOfWeek != null) {
      dayOfWeek = options.dayOfWeek;
    }
    // P2: scope пробрасываем (scope='all' → фильтр только по классу)
    if (options && typeof options === 'object' && options.scope != null && audience) {
      audience.scope = options.scope;
    }
  }
  if (maybeDayOfWeek != null && dayOfWeek == null && typeof maybeDayOfWeek === 'number') {
    dayOfWeek = maybeDayOfWeek;
  }

  const all = await Schedule.findAll({
    order: [
      ['dayOfWeek', 'ASC'],
      ['lessonNumber', 'ASC'],
    ],
  });
  let filtered = all.filter((s) => subjectsMatch(s.subjectName, input));
  if (dayOfWeek != null) {
    filtered = filtered.filter((s) => s.dayOfWeek === dayOfWeek);
  }
  if (audience) {
    let enabled = true;
    try {
      const { isMultiprofileEnabled } = require('../utils/settings');
      enabled = await isMultiprofileEnabled();
    } catch (_e) {
      enabled = true;
    }
    // P2: scope='all'/master OFF → совпадение по классу (все варианты аудитории)
    filtered = filtered.filter((s) => isVisibleWithScope(s, audience, enabled));
  }
  return filtered;
}

async function create({ dayOfWeek, lessonNumber, subjectName, room, classId = '10А', trackId = null, subgroupId = null }) {
  const cleanSubject = sanitizeSubjectForDisplay(subjectName);
  const cleanRoom = sanitizeRoom(room);
  const cleanClassId = sanitizeClassId(classId);
  const cleanTrackId = sanitizeTrackId(trackId);
  const cleanSubgroupId = sanitizeSubgroupId(subgroupId);

  const existing = await isSlotTaken(dayOfWeek, lessonNumber, {
    classId: cleanClassId,
    trackId: cleanTrackId,
    subgroupId: cleanSubgroupId
  });
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }

  if (cleanSubgroupId != null) {
    const { Subgroup } = require('../models');
    const sg = await Subgroup.findByPk(cleanSubgroupId);
    if (!sg) {
      const err = new Error('SUBGROUP_NOT_FOUND');
      throw err;
    }
    // P1 v2: subject задан → валидация как раньше; null → подгруппа годится для любого предмета
    if (sg.subject != null && String(sg.subject).trim() !== '') {
      const subNorm = normalizeSubject(sg.subject);
      const subjNorm = normalizeSubject(cleanSubject);
      const isEnglishMatch = subNorm === 'английский' && subjNorm.includes('английский');
      if (subNorm !== subjNorm && !isEnglishMatch) {
        const err = new Error('SUBGROUP_SUBJECT_MISMATCH');
        throw err;
      }
    }
  }

  const created = await Schedule.create({
    dayOfWeek,
    lessonNumber,
    subjectName: cleanSubject,
    room: cleanRoom,
    classId: cleanClassId,
    trackId: cleanTrackId,
    subgroupId: cleanSubgroupId
  });
  return created;
}

async function update(id, data) {
  const schedule = await findById(id);
  if (!schedule) {
    const err = new Error('NOT_FOUND');
    throw err;
  }
  const newDay = data.dayOfWeek != null ? data.dayOfWeek : schedule.dayOfWeek;
  const newLesson = data.lessonNumber != null ? data.lessonNumber : schedule.lessonNumber;

  const hasAudienceChange =
    data.classId !== undefined || data.trackId !== undefined || data.subgroupId !== undefined;
  const hasPositionChange = data.dayOfWeek != null || data.lessonNumber != null;

  if (hasAudienceChange || hasPositionChange) {
    const newClassId = data.classId !== undefined ? sanitizeClassId(data.classId) : schedule.classId;
    const rawTrack = data.trackId !== undefined ? data.trackId : schedule.trackId;
    const rawSub = data.subgroupId !== undefined ? data.subgroupId : schedule.subgroupId;
    const newTrackId = sanitizeTrackId(rawTrack);
    const newSubgroupId = sanitizeSubgroupId(rawSub);
    const taken = await isSlotTaken(newDay, newLesson, { classId: newClassId, trackId: newTrackId, subgroupId: newSubgroupId }, id);
    if (taken) {
      const err = new Error('SLOT_TAKEN');
      err.existing = taken;
      throw err;
    }
  }

  // validate subgroup subject if changing subject or subgroup
  const newSubjectForCheck =
    data.subjectName !== undefined ? sanitizeSubjectForDisplay(data.subjectName) : schedule.subjectName;
  const effectiveSubgroupId =
    data.subgroupId !== undefined ? sanitizeSubgroupId(data.subgroupId) : schedule.subgroupId;
  if (effectiveSubgroupId != null && (data.subjectName !== undefined || data.subgroupId !== undefined)) {
    const { Subgroup } = require('../models');
    const sg = await Subgroup.findByPk(effectiveSubgroupId);
    if (!sg) {
      const err = new Error('SUBGROUP_NOT_FOUND');
      throw err;
    }
    // P1 v2: subject задан → валидация как раньше; null → подгруппа годится для любого предмета
    if (sg.subject != null && String(sg.subject).trim() !== '') {
      const subNorm = normalizeSubject(sg.subject);
      const subjNorm = normalizeSubject(newSubjectForCheck);
      const isEnglishMatch = subNorm === 'английский' && subjNorm.includes('английский');
      if (subNorm !== subjNorm && !isEnglishMatch) {
        const err = new Error('SUBGROUP_SUBJECT_MISMATCH');
        throw err;
      }
    }
  }

  const toUpdate = { ...data };
  if (data.subjectName !== undefined) {
    toUpdate.subjectName = sanitizeSubjectForDisplay(data.subjectName);
  }
  if (data.room !== undefined) {
    toUpdate.room = sanitizeRoom(data.room);
  }
  if (data.classId !== undefined) {
    toUpdate.classId = sanitizeClassId(data.classId);
  }
  if (data.trackId !== undefined) {
    toUpdate.trackId = sanitizeTrackId(data.trackId);
  }
  if (data.subgroupId !== undefined) {
    toUpdate.subgroupId = sanitizeSubgroupId(data.subgroupId);
  }
  await schedule.update(toUpdate);
  return schedule;
}

/**
 * Удалить урок каскадно с домашними заданиями
 * @param {number} id
 * @returns {{deletedSubject:string, deletedDay:number, deletedLesson:number, deletedCount:number}}
 */
async function deleteWithHomework(id) {
  const schedule = await findById(id);
  if (!schedule) {
    const err = new Error('NOT_FOUND');
    throw err;
  }
  const deletedSubject = schedule.subjectName;
  const deletedDay = schedule.dayOfWeek;
  const deletedLesson = schedule.lessonNumber;

  const deletedCount = await Homework.destroy({ where: { scheduleId: id } });
  await schedule.destroy();

  return { deletedSubject, deletedDay, deletedLesson, deletedCount };
}

module.exports = {
  findById,
  findAll,
  findAllGroupedByDay,
  isSlotTaken,
  findBySubjectNormalized,
  create,
  update,
  deleteWithHomework,
  // exposed for testing / reuse
  _sanitizeSubjectForDisplay: sanitizeSubjectForDisplay,
  _sanitizeRoom: sanitizeRoom,
};
