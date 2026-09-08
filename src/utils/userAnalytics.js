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
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function getAllUsersWithProfile(limit = 50) {
  return User.findAll({
    include: [{ model: UserProfile, as: 'profile' }],
    order: [['lastSeenAt', 'DESC']],
    limit
  });
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
  getRecentEvents,
  getStatsSummary
};
