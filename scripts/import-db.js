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
const { Schedule, Homework } = require('../src/models');

async function readStdin() {
  const lines = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

async function resetSequence(table, idColumn) {
  await sequelize.query(
    `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(${idColumn}), 1) FROM ${table}) WHERE name='${table}'`,
    { raw: true }
  );
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

  console.error(
    `Будет импортировано: расписание ${schedules.length} записей, домашние задания ${homeworks.length} записей.`
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
    await Homework.destroy({ where: {}, transaction: t });
    await Schedule.destroy({ where: {}, transaction: t });

    if (schedules.length > 0) {
      const fields = ['id', 'lessonNumber', 'subjectName', 'dayOfWeek', 'createdAt', 'updatedAt'];
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

    await t.commit();
  } catch (e) {
    await t.rollback();
    console.error('Ошибка импорта:', e.message);
    process.exit(1);
  }

  try {
    await resetSequence('schedules', 'id');
    await resetSequence('homeworks', 'id');
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
