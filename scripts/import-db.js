#!/usr/bin/env node
/**
 * Импорт расписания и домашних заданий из JSON (из stdin).
 * Полностью заменяет данные в текущей БД. Использует ту БД, что в .env.
 *
 * Пример (Docker):
 *   docker compose exec -T bot node scripts/import-db.js --yes < export.json
 *
 * Локально:
 *   node scripts/import-db.js --yes < export.json
 *
 * Без --yes скрипт только проверяет JSON и выводит, что будет импортировано (без записи).
 */

const path = require('path');
const logger = require('../src/utils/logger');
const { createInterface } = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../src/config/database');
const { Schedule, Homework, LessonTime, Setting } = require('../src/models');
const { Class, Track, Subgroup, User, UserProfile, UserEvent } = require('../src/models');

async function readStdin() {
  const lines = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

async function resetSequence(table, idColumn) {
  try {
    await sequelize.query(
      `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(${idColumn}), 1) FROM ${table}) WHERE name='${table}'`,
      { raw: true }
    );
  } catch (_e) {
    // таблица без sqlite_sequence (STRING PK или нет AUTOINCREMENT) — игнорируем
  }
}

/**
 * P1 item 6 — whitelist полей из модели (не дрейфует от схемы):
 * берём только ключи из Model.rawAttributes, неизвестные поля — warn и пропуск.
 * @param {import('sequelize').Model} Model
 * @param {string} label
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
function pickKnownFields(Model, label, rows) {
  const allowed = new Set(Object.keys(Model.rawAttributes));
  return (rows || []).map((row) => {
    const out = {};
    for (const key of Object.keys(row)) {
      if (allowed.has(key)) {
        out[key] = row[key];
      } else {
        logger.warn(`⚠️ import-db: неизвестное поле ${label}.${key} пропущено`);
      }
    }
    return out;
  });
}

async function run() {
  const doImport = process.argv.includes('--yes');

  let raw;
  try {
    raw = await readStdin();
  } catch (e) {
    logger.error('Не удалось прочитать stdin:', e.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    logger.error('Некорректный JSON:', e.message);
    process.exit(1);
  }

  const schedules = Array.isArray(data.schedules) ? data.schedules : [];
  const homeworks = Array.isArray(data.homeworks) ? data.homeworks : [];
  const lessonTimes = Array.isArray(data.lessonTimes) ? data.lessonTimes : [];
  const settings = Array.isArray(data.settings) ? data.settings : [];
  const classes = Array.isArray(data.classes) ? data.classes : [];
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const subgroups = Array.isArray(data.subgroups) ? data.subgroups : [];
  const users = Array.isArray(data.users) ? data.users : [];
  const userProfiles = Array.isArray(data.userProfiles) ? data.userProfiles : [];
  const userEvents = Array.isArray(data.userEvents) ? data.userEvents : [];

  logger.error(
    `Будет импортировано: расписание ${schedules.length} записей, домашние задания ${homeworks.length} записей, звонки ${lessonTimes.length}, настройки ${settings.length}, классы ${classes.length}, треки ${tracks.length}, подгруппы ${subgroups.length}, пользователи ${users.length}, профили ${userProfiles.length}, события ${userEvents.length}.`
  );

  if (!doImport) {
    logger.error('Запустите с флагом --yes, чтобы выполнить импорт.');
    process.exit(0);
  }

  try {
    await sequelize.authenticate();
  } catch (e) {
    logger.error('Ошибка подключения к БД:', e.message);
    process.exit(1);
  }

  const t = await sequelize.transaction();
  try {
    // Порядок удаления: от зависимых к базовым (FK)
    await Homework.destroy({ where: {}, transaction: t });
    await Schedule.destroy({ where: {}, transaction: t });
    await UserEvent.destroy({ where: {}, transaction: t });
    await UserProfile.destroy({ where: {}, transaction: t });
    await User.destroy({ where: {}, transaction: t });
    await Subgroup.destroy({ where: {}, transaction: t });
    await Track.destroy({ where: {}, transaction: t });
    await Class.destroy({ where: {}, transaction: t });
    // lessonTimes и settings — независимые, чистим если пришли в dump
    if (lessonTimes.length > 0) {
      await LessonTime.destroy({ where: {}, transaction: t });
    }
    if (settings.length > 0) {
      await Setting.destroy({ where: {}, transaction: t });
    }

    // Порядок создания: от базовых к зависимым (обратный удалению)
    if (classes.length > 0) {
      await Class.bulkCreate(pickKnownFields(Class, 'classes', classes), { transaction: t, validate: false });
    }

    if (tracks.length > 0) {
      await Track.bulkCreate(pickKnownFields(Track, 'tracks', tracks), { transaction: t, validate: false });
    }

    if (subgroups.length > 0) {
      await Subgroup.bulkCreate(pickKnownFields(Subgroup, 'subgroups', subgroups), { transaction: t, validate: false });
    }

    if (users.length > 0) {
      await User.bulkCreate(pickKnownFields(User, 'users', users), { transaction: t, validate: false });
    }

    if (userProfiles.length > 0) {
      await UserProfile.bulkCreate(pickKnownFields(UserProfile, 'userProfiles', userProfiles), { transaction: t, validate: false });
    }

    if (lessonTimes.length > 0) {
      await LessonTime.bulkCreate(pickKnownFields(LessonTime, 'lessonTimes', lessonTimes), { transaction: t, validate: false });
    }

    if (settings.length > 0) {
      await Setting.bulkCreate(pickKnownFields(Setting, 'settings', settings), { transaction: t, validate: false });
    }

    if (schedules.length > 0) {
      await Schedule.bulkCreate(pickKnownFields(Schedule, 'schedules', schedules), { transaction: t, validate: false });
    }

    if (homeworks.length > 0) {
      await Homework.bulkCreate(pickKnownFields(Homework, 'homeworks', homeworks), { transaction: t, validate: false });
    }

    if (userEvents.length > 0) {
      await UserEvent.bulkCreate(pickKnownFields(UserEvent, 'userEvents', userEvents), { transaction: t, validate: false });
    }

    await t.commit();
  } catch (e) {
    await t.rollback();
    logger.error('Ошибка импорта:', e.message);
    process.exit(1);
  }

  try {
    await resetSequence('schedules', 'id');
    await resetSequence('homeworks', 'id');
    await resetSequence('user_events', 'id');
    // lesson_times использует lessonNumber PK (1-10) — sequence не нужен
    // classes/tracks/subgroups — STRING PK, без sequence
  } catch (e) {
    logger.warn('Не удалось сбросить sqlite_sequence:', e.message || e);
  }

  logger.error('Импорт завершён.');
  await sequelize.close();
  process.exit(0);
}

run().catch((e) => {
  logger.error(e);
  process.exit(1);
});
