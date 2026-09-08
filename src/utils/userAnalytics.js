const { Op, fn, col } = require('sequelize');
const { User, UserEvent, UserProfile } = require('../models');

/**
 * Количество пользователей по классам (по денормализованному User.classId
 * и/или через UserProfile — считаем по User.classId для быстроты).
 * @returns {Promise<Array<{classId: string, count: number}>>}
 */
async function getUserCountsByClass() {
  const rows = await User.findAll({
    attributes: ['classId', [fn('COUNT', col('userId')), 'count']],
    where: { classId: { [Op.ne]: null } },
    group: ['classId'],
    raw: true
  });
  return rows.map((r) => ({ classId: r.classId, count: Number(r.count) }));
}

/**
 * Количество пользователей по трекам внутри класса.
 * @param {string} classId - ID класса
 * @returns {Promise<Array<{trackId: string, count: number}>>}
 */
async function getUserCountsByTrack(classId) {
  const rows = await User.findAll({
    attributes: ['trackId', [fn('COUNT', col('userId')), 'count']],
    where: { classId, trackId: { [Op.ne]: null } },
    group: ['trackId'],
    raw: true
  });
  return rows.map((r) => ({ trackId: r.trackId, count: Number(r.count) }));
}

/**
 * Количество пользователей по подгруппам.
 * @returns {Promise<Array<{subgroupId: string, count: number}>>}
 */
async function getUserCountsBySubgroup() {
  const rows = await User.findAll({
    attributes: ['subgroupId', [fn('COUNT', col('userId')), 'count']],
    where: { subgroupId: { [Op.ne]: null } },
    group: ['subgroupId'],
    raw: true
  });
  return rows.map((r) => ({ subgroupId: r.subgroupId, count: Number(r.count) }));
}

/**
 * Все пользователи с профилем, сортировка по последней активности.
 * @param {number} [limit=50] - лимит записей
 * @param {number} [offset=0] - смещение для пагинации
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function getAllUsersWithProfile(limit = 50, offset = 0) {
  return User.findAll({
    include: [{ model: UserProfile, as: 'profile' }],
    order: [['lastSeenAt', 'DESC']],
    limit,
    offset
  });
}

/**
 * Пагинированный список пользователей (алиас для getAllUsersWithProfile).
 * @param {number} [limit=10] - лимит записей
 * @param {number} [offset=0] - смещение
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function getUsersPaginated(limit = 10, offset = 0) {
  return getAllUsersWithProfile(limit, offset);
}

/**
 * Детальная информация по пользователю: User + UserProfile + последние 10 событий.
 * @param {string|number} userId - Telegram userId
 * @returns {Promise<{user: import('sequelize').Model|null, profile: import('sequelize').Model|null, events: import('sequelize').Model[]}>}
 */
async function getUserDetail(userId) {
  const id = userId;
  let user = await User.findByPk(id, {
    include: [{ model: UserProfile, as: 'profile' }]
  });
  if (!user) {
    try {
      user = await User.findByPk(String(id), {
        include: [{ model: UserProfile, as: 'profile' }]
      });
    } catch (_e) {
      // ignore
    }
  }
  if (!user) {
    return { user: null, profile: null, events: [] };
  }
  // profile может быть уже в user.profile через include
  let profile = user.profile || null;
  if (!profile) {
    try {
      profile = await UserProfile.findByPk(user.userId);
      if (!profile) profile = await UserProfile.findByPk(String(user.userId));
    } catch (_e) {
      profile = null;
    }
  }
  let events = [];
  try {
    events = await UserEvent.findAll({
      where: { userId: user.userId },
      order: [['createdAt', 'DESC']],
      limit: 10
    });
  } catch (_e) {
    // fallback string id
    try {
      events = await UserEvent.findAll({
        where: { userId: String(user.userId) },
        order: [['createdAt', 'DESC']],
        limit: 10
      });
    } catch (_e2) {
      events = [];
    }
  }
  // дублирующая попытка для String userId если events пустые но userId был строкой
  if (events.length === 0) {
    try {
      const altEvents = await UserEvent.findAll({
        where: { userId: String(id) },
        order: [['createdAt', 'DESC']],
        limit: 10
      });
      if (altEvents.length > 0) events = altEvents;
    } catch (_e) {
      // ignore
    }
  }
  return { user, profile, events };
}

/**
 * Последние события пользователей.
 * @param {number} [limit=20] - лимит записей
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function getRecentEvents(limit = 20) {
  return UserEvent.findAll({
    order: [['createdAt', 'DESC']],
    limit
  });
}

/**
 * Сводная статистика по пользователям.
 * @returns {Promise<{totalUsers:number, active24h:number, byClass:Array, byTrack:Array, bySubgroup:Array, withoutProfile:number}>}
 */
async function getStatsSummary() {
  const totalUsers = await User.count();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const active24h = await User.count({
    where: { lastSeenAt: { [Op.gte]: since24h } }
  });

  const byClass = await getUserCountsByClass();

  // byTrack — агрегируем по трекам без фильтра класса (для сводки)
  const trackRows = await User.findAll({
    attributes: ['trackId', [fn('COUNT', col('userId')), 'count']],
    where: { trackId: { [Op.ne]: null } },
    group: ['trackId'],
    raw: true
  });
  const byTrack = trackRows.map((r) => ({ trackId: r.trackId, count: Number(r.count) }));

  const bySubgroup = await getUserCountsBySubgroup();

  const withProfile = await UserProfile.count();
  const withoutProfile = totalUsers - withProfile;

  return { totalUsers, active24h, byClass, byTrack, bySubgroup, withoutProfile };
}

module.exports = {
  getUserCountsByClass,
  getUserCountsByTrack,
  getUserCountsBySubgroup,
  getAllUsersWithProfile,
  getUsersPaginated,
  getRecentEvents,
  getStatsSummary,
  getUserDetail
};
