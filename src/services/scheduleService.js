const { Op } = require('sequelize');
const { Schedule, Homework } = require('../models');

/**
 * Сервисный слой для расписания — изолирует Sequelize от сцен
 */

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
 * Проверить занятость слота
 * @param {number} dayOfWeek
 * @param {number} lessonNumber
 * @param {number|null} excludeId - исключить этот ID (для edit)
 * @returns {Promise<Schedule|null>}
 */
async function isSlotTaken(dayOfWeek, lessonNumber, excludeId = null) {
  const where = { dayOfWeek, lessonNumber };
  if (excludeId != null) {
    where.id = { [Op.ne]: excludeId };
  }
  return Schedule.findOne({ where });
}

async function create({ dayOfWeek, lessonNumber, subjectName }) {
  const existing = await isSlotTaken(dayOfWeek, lessonNumber);
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }
  const created = await Schedule.create({ dayOfWeek, lessonNumber, subjectName });
  return created;
}

async function update(id, data) {
  const schedule = await findById(id);
  if (!schedule) {
    const err = new Error('NOT_FOUND');
    throw err;
  }
  // Проверка слота если меняем позицию
  if (data.dayOfWeek != null && data.lessonNumber != null) {
    const taken = await isSlotTaken(data.dayOfWeek, data.lessonNumber, id);
    if (taken) {
      const err = new Error('SLOT_TAKEN');
      err.existing = taken;
      throw err;
    }
  }
  await schedule.update(data);
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
  create,
  update,
  deleteWithHomework,
};
