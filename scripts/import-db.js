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

async function run() {
  const doImport = process.argv.includes('--yes');

  let raw;
  try {
    raw = await readStdin();
  } catch (e) {
    console.error('Не удалось прочитать stdin:', e.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Некорректный JSON:', e.message);
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

  console.error(
    `Будет импортировано: расписание ${schedules.length} записей, домашние задания ${homeworks.length} записей, звонки ${lessonTimes.length}, настройки ${settings.length}, классы ${classes.length}, треки ${tracks.length}, подгруппы ${subgroups.length}, пользователи ${users.length}, профили ${userProfiles.length}, события ${userEvents.length}.`
  );

  if (!doImport) {
    console.error('Запустите с флагом --yes, чтобы выполнить импорт.');
    process.exit(0);
  }

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error('Ошибка подключения к БД:', e.message);
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
      const fields = ['id', 'grade', 'letter', 'enabled', 'createdAt', 'updatedAt'];
      const rows = classes.map((c) => {
        const r = {};
        for (const k of fields) if (c[k] !== undefined) r[k] = c[k];
        return r;
      });
      await Class.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (tracks.length > 0) {
      const fields = ['id', 'classId', 'name', 'isCommon', 'createdAt', 'updatedAt'];
      const rows = tracks.map((tr) => {
        const r = {};
        for (const k of fields) if (tr[k] !== undefined) r[k] = tr[k];
        return r;
      });
      await Track.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (subgroups.length > 0) {
      const fields = ['id', 'subject', 'teacherName', 'classId', 'active', 'createdAt', 'updatedAt'];
      const rows = subgroups.map((s) => {
        const r = {};
        for (const k of fields) if (s[k] !== undefined) r[k] = s[k];
        return r;
      });
      await Subgroup.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (users.length > 0) {
      const fields = [
        'userId',
        'username',
        'firstName',
        'lastName',
        'languageCode',
        'isPremium',
        'addedToAttachmentMenu',
        'classId',
        'trackId',
        'subgroupId',
        'firstSeenAt',
        'lastSeenAt',
        'lastAction',
        'homeworkCount',
        'interactionCount',
        'createdAt',
        'updatedAt'
      ];
      const rows = users.map((u) => {
        const r = {};
        for (const k of fields) if (u[k] !== undefined) r[k] = u[k];
        return r;
      });
      await User.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (userProfiles.length > 0) {
      const fields = ['userId', 'classId', 'trackId', 'subgroupId', 'version', 'createdAt', 'updatedAt'];
      const rows = userProfiles.map((p) => {
        const r = {};
        for (const k of fields) if (p[k] !== undefined) r[k] = p[k];
        return r;
      });
      await UserProfile.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (lessonTimes.length > 0) {
      const fields = ['lessonNumber', 'startTime', 'endTime', 'createdAt', 'updatedAt'];
      const rows = lessonTimes.map((lt) => {
        const r = {};
        for (const k of fields) if (lt[k] !== undefined) r[k] = lt[k];
        return r;
      });
      await LessonTime.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (settings.length > 0) {
      const fields = ['key', 'value', 'createdAt', 'updatedAt'];
      const rows = settings.map((s) => {
        const r = {};
        for (const k of fields) if (s[k] !== undefined) r[k] = s[k];
        return r;
      });
      await Setting.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (schedules.length > 0) {
      const fields = [
        'id',
        'lessonNumber',
        'subjectName',
        'dayOfWeek',
        'room',
        'classId',
        'trackId',
        'subgroupId',
        'createdAt',
        'updatedAt'
      ];
      const rows = schedules.map((s) => {
        const r = {};
        for (const k of fields) if (s[k] !== undefined) r[k] = s[k];
        return r;
      });
      await Schedule.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (homeworks.length > 0) {
      const fields = ['id', 'userId', 'scheduleId', 'date', 'content', 'createdAt', 'updatedAt'];
      const rows = homeworks.map((h) => {
        const r = {};
        for (const k of fields) if (h[k] !== undefined) r[k] = h[k];
        return r;
      });
      await Homework.bulkCreate(rows, { transaction: t, validate: false });
    }

    if (userEvents.length > 0) {
      const fields = ['id', 'userId', 'type', 'payload', 'meta', 'createdAt', 'updatedAt'];
      const rows = userEvents.map((ev) => {
        const r = {};
        for (const k of fields) if (ev[k] !== undefined) r[k] = ev[k];
        return r;
      });
      await UserEvent.bulkCreate(rows, { transaction: t, validate: false });
    }

    await t.commit();
  } catch (e) {
    await t.rollback();
    console.error('Ошибка импорта:', e.message);
    process.exit(1);
  }

  try {
    await resetSequence('schedules', 'id');
    await resetSequence('homeworks', 'id');
    await resetSequence('user_events', 'id');
    // lesson_times использует lessonNumber PK (1-10) — sequence не нужен
    // classes/tracks/subgroups — STRING PK, без sequence
  } catch (e) {
    console.warn('Не удалось сбросить sqlite_sequence:', e.message || e);
  }

  console.error('Импорт завершён.');
  await sequelize.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
