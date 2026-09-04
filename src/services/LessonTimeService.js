const LessonTime = require('../models/LessonTime');
const {
  validateLessonNumber,
  validateTimeRange,
} = require('../utils/lessonTimeValidator');

/**
 * Find all ordered by lessonNumber ASC
 * @returns {Promise<LessonTime[]>}
 */
async function findAllOrdered() {
  return LessonTime.findAll({ order: [['lessonNumber', 'ASC']] });
}

/**
 * Find by lesson number
 * @param {number} n
 * @returns {Promise<LessonTime|null>}
 */
async function findByLessonNumber(n) {
  return LessonTime.findByPk(n);
}

/**
 * Upsert bell time for a lesson
 * @param {number} lessonNumber
 * @param {string} startTime HH:MM
 * @param {string} endTime HH:MM
 * @returns {Promise<LessonTime>}
 */
async function upsert(lessonNumber, startTime, endTime) {
  validateLessonNumber(lessonNumber);
  validateTimeRange(startTime, endTime);

  const [record] = await LessonTime.upsert(
    { lessonNumber, startTime, endTime },
    { conflictFields: ['lessonNumber'] }
  );

  // Sequelize sqlite upsert returns [instance, created] or instance depending on version
  // Ensure we return the instance; if array, first element is instance
  if (Array.isArray(record)) return record[0];

  // Fallback: fetch after upsert
  if (record && record.lessonNumber) return record;
  return findByLessonNumber(lessonNumber);
}

/**
 * Get bell schedule as Map<number,{start,end}>
 * @returns {Promise<Map<number,{start:string,end:string}>>}
 */
async function getBellScheduleMap() {
  const rows = await findAllOrdered();
  const map = new Map();
  for (const r of rows) {
    map.set(r.lessonNumber, { start: r.startTime, end: r.endTime });
  }
  return map;
}

module.exports = {
  findAllOrdered,
  findByLessonNumber,
  upsert,
  getBellScheduleMap,
};
