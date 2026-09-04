const { Op } = require('sequelize');
const { Schedule, Homework } = require('../models');
const { subjectsMatch } = require('../utils/subjectNormalizer');

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

/**
 * Case-insensitive find by subject (Cyrillic-safe).
 * Uses subjectsMatch (normalize + firstToken fallback).
 * @param {string} input
 * @param {number|null} dayOfWeek - optional filter
 * @returns {Promise<Array>}
 */
async function findBySubjectNormalized(input, dayOfWeek = null) {
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
  return filtered;
}

async function create({ dayOfWeek, lessonNumber, subjectName, room }) {
  const existing = await isSlotTaken(dayOfWeek, lessonNumber);
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }
  const cleanSubject = sanitizeSubjectForDisplay(subjectName);
  const cleanRoom = sanitizeRoom(room);
  const created = await Schedule.create({
    dayOfWeek,
    lessonNumber,
    subjectName: cleanSubject,
    room: cleanRoom,
  });
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
  const toUpdate = { ...data };
  if (data.subjectName !== undefined) {
    toUpdate.subjectName = sanitizeSubjectForDisplay(data.subjectName);
  }
  if (data.room !== undefined) {
    toUpdate.room = sanitizeRoom(data.room);
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
