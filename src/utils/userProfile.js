const { Op } = require('sequelize');
const { Class, Track, Subgroup, UserProfile, User } = require('../models');
const { isMultiprofileEnabled: _isMultiprofileEnabled } = require('./settings');

/**
 * Получить профиль пользователя.
 * @param {number|string} userId - Telegram user id
 * @returns {Promise<import('../models/UserProfile')|null>}
 */
async function getUserProfile(userId) {
  if (userId == null) return null;
  try {
    let profile = await UserProfile.findByPk(userId);
    if (!profile) {
      // fallback for string/BIGINT mismatch
      try {
        profile = await UserProfile.findByPk(String(userId));
      } catch (_e) {
        profile = null;
      }
    }
    return profile || null;
  } catch (e) {
    console.error('getUserProfile', e.message || e);
    return null;
  }
}

/**
 * Сохранить профиль пользователя + денормализация в User.
 * @param {number|string} userId
 * @param {{classId:string, trackId:string|null, subgroupId:string|null}} data
 * @returns {Promise<import('../models/UserProfile')>}
 */
async function setUserProfile(userId, { classId, trackId, subgroupId }) {
  const normClassId = typeof classId === 'string' ? classId.trim() : classId;
  const normTrackId = trackId != null && String(trackId).trim() ? String(trackId).trim() : null;
  const normSubgroupId = subgroupId != null && String(subgroupId).trim() ? String(subgroupId).trim() : null;
  // treat literal string "null" as null (from callback_data)
  const finalTrackId = normTrackId === 'null' ? null : normTrackId;
  const finalSubgroupId = normSubgroupId === 'null' ? null : normSubgroupId;

  let existing = null;
  try {
    existing = await UserProfile.findByPk(userId);
    if (!existing) existing = await UserProfile.findByPk(String(userId));
  } catch (_e) {
    existing = null;
  }

  const version = existing ? (existing.version || 1) + 1 : 1;

  // upsert UserProfile
  try {
    await UserProfile.upsert({
      userId,
      classId: normClassId,
      trackId: finalTrackId,
      subgroupId: finalSubgroupId,
      version
    });
  } catch (e) {
    console.error('setUserProfile upsert', e.message || e);
    // fallback: create or update manually
    if (existing) {
      await existing.update({ classId: normClassId, trackId: finalTrackId, subgroupId: finalSubgroupId, version });
    } else {
      await UserProfile.create({ userId, classId: normClassId, trackId: finalTrackId, subgroupId: finalSubgroupId, version });
    }
  }

  // денормализация в User (не блокирует если User нет — findOrCreate)
  try {
    const [user] = await User.findOrCreate({
      where: { userId },
      defaults: { userId, firstName: 'unknown', classId: normClassId, trackId: finalTrackId, subgroupId: finalSubgroupId }
    });
    if (user) {
      await user.update({ classId: normClassId, trackId: finalTrackId, subgroupId: finalSubgroupId });
    }
  } catch (e) {
    // User may not exist yet — try direct update, ignore error
    try {
      await User.update({ classId: normClassId, trackId: finalTrackId, subgroupId: finalSubgroupId }, { where: { userId } });
    } catch (_e2) {
      console.error('setUserProfile User denorm', e.message || e);
    }
  }

  return getUserProfile(userId);
}

/**
 * Список доступных классов.
 * @returns {Promise<Array<import('../models/Class')>>}
 */
async function getAvailableClasses() {
  try {
    return await Class.findAll({ where: { enabled: true }, order: [['grade', 'ASC'], ['letter', 'ASC']] });
  } catch (e) {
    console.error('getAvailableClasses', e.message || e);
    return [];
  }
}

/**
 * Список треков для класса.
 * @param {string} classId
 * @returns {Promise<Array<import('../models/Track')>>}
 */
async function getAvailableTracks(classId) {
  if (!classId) return [];
  try {
    // grade<10 → skip (нет профилей)
    let grade = null;
    try {
      const cls = await Class.findByPk(classId);
      if (cls && cls.grade != null) grade = Number(cls.grade);
      else {
        const parsed = parseInt(String(classId), 10);
        if (!Number.isNaN(parsed)) grade = parsed;
      }
    } catch (_e) {
      grade = null;
    }
    if (grade != null && grade < 10) return [];
    const tracks = await Track.findAll({ where: { classId }, order: [['name', 'ASC']] });
    return tracks || [];
  } catch (e) {
    console.error('getAvailableTracks', e.message || e);
    return [];
  }
}

/**
 * Список подгрупп по предмету (P1 v2).
 * Подгруппа с `subject=null` годится для любого предмета — попадает в любой список.
 * @param {string} [subject='английский']
 * @param {string|null} [classId=null]
 * @returns {Promise<Array<import('../models/Subgroup')>>}
 */
async function getAvailableSubgroups(subject = 'английский', classId = null) {
  const { subjectsMatch } = require('./subjectNormalizer');
  const subj = typeof subject === 'string' ? subject.trim() : 'английский';
  try {
    const where = { active: true };
    if (classId) where[Op.or] = [{ classId: null }, { classId }];
    const all = await Subgroup.findAll({ where, order: [['teacher', 'ASC']] });
    // subject=null → любой предмет; иначе subjectsMatch (регистр/ё/первое слово)
    return (all || []).filter((s) => {
      if (s.subject == null || String(s.subject).trim() === '') return true;
      return subjectsMatch(s.subject, subj);
    });
  } catch (e) {
    console.error('getAvailableSubgroups', e.message || e);
    return [];
  }
}

/**
 * Wrapper для isMultiprofileEnabled из settings.
 * @returns {Promise<boolean>}
 */
async function isMultiprofileEnabled() {
  return _isMultiprofileEnabled();
}

module.exports = {
  getUserProfile,
  setUserProfile,
  getAvailableClasses,
  getAvailableTracks,
  getAvailableSubgroups,
  isMultiprofileEnabled
};
