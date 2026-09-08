#!/usr/bin/env node
/**
 * Экспорт расписания и домашних заданий в JSON (в stdout).
 * Использует ту БД, которая задана в .env (Postgres или SQLite).
 *
 * Пример (Docker):
 *   docker compose exec bot node scripts/export-db.js > export.json
 *
 * Локально:
 *   node scripts/export-db.js > export.json
 */

const path = require('path');

// .env и конфиг БД — относительно корня проекта (родитель scripts/)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../src/config/database');
const { Schedule, Homework, LessonTime, Setting } = require('../src/models');
const { Class, Track, Subgroup, User, UserProfile, UserEvent } = require('../src/models');

async function run() {
  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error('Ошибка подключения к БД:', e.message);
    process.exit(1);
  }

  const schedules = await Schedule.findAll({ order: [['id']], raw: true });
  const homeworks = await Homework.findAll({ order: [['id']], raw: true });
  const lessonTimes = await LessonTime.findAll({ order: [['lessonNumber']], raw: true });
  const settings = await Setting.findAll({ order: [['key']], raw: true });
  const classes = await Class.findAll({ order: [['id']], raw: true });
  const tracks = await Track.findAll({ order: [['id']], raw: true });
  const subgroups = await Subgroup.findAll({ order: [['id']], raw: true });
  const users = await User.findAll({ order: [['userId']], raw: true });
  const userProfiles = await UserProfile.findAll({ order: [['userId']], raw: true });
  const userEvents = await UserEvent.findAll({ order: [['id']], raw: true });

  const out = {
    exportedAt: new Date().toISOString(),
    schedules,
    homeworks,
    lessonTimes,
    settings,
    classes,
    tracks,
    subgroups,
    users,
    userProfiles,
    userEvents
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  await sequelize.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
