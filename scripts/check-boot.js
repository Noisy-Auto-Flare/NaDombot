#!/usr/bin/env node
/**
 * scripts/check-boot.js — исполняемая проверка чистого boot (P0).
 * Приёмка P0: boot на пустой БД и на БД с дублями —
 *   grep -c '❌' == 0, grep -c 'no such table' == 0;
 *   таблицы из ожидаемого списка на месте;
 *   sync на обеих даёт одинаковую схему (канонический дамп);
 *   сиды двойным прогоном — ноль новых строк.
 *
 * Канонический дамп:
 *   SELECT sql FROM sqlite_master WHERE type IN ('table','index')
 *     AND name NOT LIKE 'sqlite_%' ORDER BY name
 *   + COUNT(*) по каждой таблице.
 *
 * Использование:
 *   node scripts/check-boot.js [--db PATH] [--dump FILE]
 *   SQLITE_PATH env тоже поддерживается (--db приоритетнее).
 * Выход: 0 — все проверки зелёные, 1 — есть красные.
 */
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = { db: null, dump: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) {
      out.db = argv[++i];
    } else if (argv[i] === '--dump' && argv[i + 1]) {
      out.dump = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      out.help = true;
    }
  }
  return out;
}

const EXPECTED_TABLES = [
  'schedules',
  'homeworks',
  'settings',
  'lesson_times',
  'classes',
  'tracks',
  'subgroups',
  'users',
  'user_events',
  'user_profiles',
  'data_migrations'
];

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/check-boot.js [--db PATH] [--dump FILE]');
    process.exit(0);
  }
  if (args.db) {
    process.env.SQLITE_PATH = args.db;
  }
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'db.sqlite');

  const failures = [];
  const passes = [];
  function ok(name) {
    passes.push(name);
    console.log(`✅ ${name}`);
  }
  function fail(name, detail) {
    failures.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }

  // Перехватываем console.* на время syncDatabase для grep-маркеров
  const captured = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  function capture(...a) {
    captured.push(a.map(String).join(' '));
  }

  // Ленивый require ПОСЛЕ установки SQLITE_PATH
  let syncDatabase;
  let sequelize;
  try {
    const dbmod = require('../src/config/database');
    syncDatabase = dbmod.syncDatabase;
    sequelize = dbmod.sequelize;
  } catch (e) {
    fail('require src/config/database', e.message);
    process.exit(1);
  }

  async function runSyncCapture(tag) {
    captured.length = 0;
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    try {
      await syncDatabase();
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
    const blob = captured.join('\n');
    const crossCount = (blob.match(/❌/g) || []).length;
    const noTableCount = (blob.match(/no such table/g) || []).length;
    // Печатаем перехваченный лог обратно для прозрачности
    if (blob.trim()) {
      origLog(`--- sync log (${tag}, db=${dbPath}) ---`);
      origLog(blob);
      origLog(`--- end sync log (${tag}) ---`);
    }
    return { blob, crossCount, noTableCount };
  }

  async function getCounts() {
    const { QueryTypes } = require('sequelize');
    const tables = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      { type: QueryTypes.SELECT }
    );
    const counts = {};
    for (const r of tables) {
      const name = r.name;
      try {
        const c = await sequelize.query(`SELECT COUNT(*) AS cnt FROM "${name}"`, { type: QueryTypes.SELECT });
        counts[name] = Number(c[0].cnt);
      } catch (_e) {
        counts[name] = `ERR:${_e.message}`;
      }
    }
    return counts;
  }

  async function canonicalDump() {
    const { QueryTypes } = require('sequelize');
    const ddl = await sequelize.query(
      "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      { type: QueryTypes.SELECT }
    );
    const counts = await getCounts();
    const lines = [];
    for (const r of ddl) {
      lines.push((r.sql || '').trim() + ';');
    }
    lines.push('--- counts ---');
    for (const name of Object.keys(counts).sort()) {
      lines.push(`${name}: ${counts[name]}`);
    }
    return lines.join('\n') + '\n';
  }

  // --- 1. Первый sync ---
  const run1 = await runSyncCapture('run1');
  if (run1.crossCount === 0) ok(`grep -c '❌' == 0 (run1)`);
  else fail(`grep -c '❌' == 0 (run1)`, `found ${run1.crossCount}`);
  if (run1.noTableCount === 0) ok(`grep -c 'no such table' == 0 (run1)`);
  else fail(`grep -c 'no such table' == 0 (run1)`, `found ${run1.noTableCount}`);

  // --- 2. Таблицы из ожидаемого списка ---
  const { QueryTypes } = require('sequelize');
  let existingTables = [];
  try {
    const rows = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table'",
      { type: QueryTypes.SELECT }
    );
    existingTables = rows.map((r) => r.name);
  } catch (e) {
    fail('список таблиц', e.message);
  }
  const missing = EXPECTED_TABLES.filter((t) => !existingTables.includes(t));
  if (missing.length === 0) ok(`таблицы на месте (${EXPECTED_TABLES.length})`);
  else fail('таблицы на месте', `нет: ${missing.join(', ')}`);

  // --- 3. Индексы домашки (D1) ---
  try {
    const idxRows = await sequelize.query(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='homeworks'",
      { type: QueryTypes.SELECT }
    );
    const names = idxRows.map((r) => r.name);
    if (names.includes('unique_homework_per_date')) {
      fail('legacy unique_homework_per_date отсутствует', 'индекс всё ещё есть');
    } else {
      ok('legacy unique_homework_per_date отсутствует');
    }
    const plain = idxRows.find((r) => r.name === 'idx_homework_schedule_date');
    if (!plain) {
      fail('idx_homework_schedule_date существует', 'не найден');
    } else if (/UNIQUE/i.test(plain.sql || '')) {
      fail('idx_homework_schedule_date обычный (не UNIQUE)', plain.sql);
    } else {
      ok('idx_homework_schedule_date обычный (не UNIQUE)');
    }
  } catch (e) {
    fail('проверка индексов homeworks', e.message);
  }

  // --- 4. schema_version ---
  try {
    const sv = await sequelize.query(
      "SELECT value FROM settings WHERE key='schema_version'",
      { type: QueryTypes.SELECT }
    );
    const { SCHEMA_VERSION: EXPECTED_SCHEMA_VERSION } = require('../src/config/database');
    if (sv[0] && sv[0].value === EXPECTED_SCHEMA_VERSION) ok(`schema_version='${EXPECTED_SCHEMA_VERSION}'`);
    else fail(`schema_version='${EXPECTED_SCHEMA_VERSION}'`, sv[0] ? `value=${sv[0].value}` : 'строки нет');
  } catch (e) {
    fail('schema_version (из кода)', e.message);
  }

  // --- 5. Маркер запуска бота (D8): строка должна быть в коде boot-пути ---
  try {
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    if (indexSrc.includes('Бот успешно запущен')) ok('маркер «Бот успешно запущен» в src/index.js');
    else fail('маркер «Бот успешно запущен» в src/index.js', 'строка не найдена');
  } catch (e) {
    fail('маркер «Бот успешно запущен» в src/index.js', e.message);
  }

  // --- 5b. foreign_key_check обязан быть чистым (D2: FK OFF/ON + сверка) ---
  try {
    const fkRows = await sequelize.query('PRAGMA foreign_key_check', { type: QueryTypes.SELECT });
    if (fkRows.length === 0) ok('PRAGMA foreign_key_check == 0');
    else fail('PRAGMA foreign_key_check == 0', JSON.stringify(fkRows).slice(0, 300));
  } catch (e) {
    fail('PRAGMA foreign_key_check == 0', e.message);
  }

  // --- 6. Double-run: второй sync + сверка counts (сиды — ноль новых строк) ---
  const countsBefore = await getCounts();
  const run2 = await runSyncCapture('run2');
  const countsAfter = await getCounts();
  if (run2.crossCount === 0) ok(`grep -c '❌' == 0 (run2)`);
  else fail(`grep -c '❌' == 0 (run2)`, `found ${run2.crossCount}`);
  if (run2.noTableCount === 0) ok(`grep -c 'no such table' == 0 (run2)`);
  else fail(`grep -c 'no such table' == 0 (run2)`, `found ${run2.noTableCount}`);
  const countDiffs = [];
  for (const k of new Set([...Object.keys(countsBefore), ...Object.keys(countsAfter)])) {
    if (countsBefore[k] !== countsAfter[k]) countDiffs.push(`${k}: ${countsBefore[k]} → ${countsAfter[k]}`);
  }
  if (countDiffs.length === 0) ok('double-run сидов: ноль новых строк');
  else fail('double-run сидов: ноль новых строк', countDiffs.join('; '));

  // --- 7. Канонический дамп ---
  const dump = await canonicalDump();
  if (args.dump) {
    fs.writeFileSync(args.dump, dump, 'utf8');
    ok(`канонический дамп записан: ${args.dump}`);
  } else {
    origLog('--- canonical dump ---');
    origLog(dump.trimEnd());
    origLog('--- end canonical dump ---');
    ok('канонический дамп выведен в stdout (diff: сравнить два файла вручную)');
  }

  try {
    await sequelize.close();
  } catch (_e) {
    void _e;
  }

  origLog(`\nИтог: PASS ${passes.length}, FAIL ${failures.length} (db=${dbPath})`);
  if (failures.length) {
    origLog(`FAIL: ${failures.join('; ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`❌ check-boot упал: ${e.stack || e.message}`);
  process.exit(1);
});
