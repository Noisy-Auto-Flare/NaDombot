const logger = require('../utils/logger');
const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const sqlitePath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'db.sqlite');
const dir = path.dirname(sqlitePath);

// Создаём директорию, если её нет
try {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
} catch (err) {
  if (err.code !== 'EEXIST') {
    logger.error('Ошибка при создании директории для SQLite:', err.message);
  }
}

// Проверяем права на запись
try {
  fs.accessSync(dir, fs.constants.W_OK);
} catch (_err) {
  logger.error(`Нет прав на запись в директорию ${dir}. Проверьте права доступа.`);
  process.exit(1);
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: sqlitePath,
  logging: process.env.NODE_ENV === 'development' ? (...args) => logger.debug(...args) : false,
  pool: { max: 1, min: 0 },
});

// Функция для проверки подключения
async function testConnection() {
  try {
    await sequelize.authenticate();
    logger.info('✅ Подключение к базе данных установлено успешно.');
    return true;
  } catch (error) {
    logger.error('❌ Ошибка подключения к базе данных:', error.message);
    return false;
  }
}

const SCHEMA_VERSION = 'p3-history';
// Явный список колонок schedules для D2 (id сохраняем обязательно — иначе битые homeworks.scheduleId)
const CANONICAL_SCHEDULE_COLS = [
  'id',
  'dayOfWeek',
  'lessonNumber',
  'subjectName',
  'room',
  'classId',
  'trackId',
  'subgroupId',
  'createdAt',
  'updatedAt'
];
const REPAIR_TMP_TABLE = 'schedules_old_p0';

function p0Timestamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Файловый бэкап БД перед DDL-хирургией.
 * @returns {string|null} путь бэкапа или null (файла нет — чистая БД, бэкап не нужен)
 * @throws {Error} если файл есть, но скопировать не удалось — вызывающий обязан abort без DROP
 */
function backupDatabaseFile() {
  if (!fs.existsSync(sqlitePath)) return null;
  const backupPath = `${sqlitePath}.p0-backup-${p0Timestamp()}`;
  fs.copyFileSync(sqlitePath, backupPath);
  logger.info(`✅ P0 бэкап БД: ${backupPath}`);
  return backupPath;
}

async function foreignKeyCheckCount() {
  try {
    const rows = await sequelize.query('PRAGMA foreign_key_check', { type: Sequelize.QueryTypes.SELECT });
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_e) {
    return -1;
  }
}

/**
 * Детектор битой схемы schedules: только одиночные UNIQUE на dayOfWeek/lessonNumber.
 * Композитные (unique_lesson_per_day, unique_lesson_per_audience) — не триггерят.
 * @returns {Promise<{broken: boolean, culprits: Array<string>}>}
 */
async function detectBrokenSchedules() {
  const culprits = [];
  try {
    const exists = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'", {
      type: Sequelize.QueryTypes.SELECT
    });
    if (!exists.length) return { broken: false, culprits };
    const indexes = await sequelize.query("PRAGMA index_list('schedules')", { type: Sequelize.QueryTypes.SELECT });
    if (!Array.isArray(indexes)) return { broken: false, culprits };
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const qi = sequelize.getQueryInterface();
      let cols = [];
      try {
        cols = await sequelize.query(`PRAGMA index_info(${qi.quoteIdentifier(idx.name)})`, {
          type: Sequelize.QueryTypes.SELECT
        });
      } catch (_e) {
        void _e;
        continue;
      }
      if (Array.isArray(cols) && cols.length === 1 && (cols[0].name === 'dayOfWeek' || cols[0].name === 'lessonNumber')) {
        culprits.push(idx.name);
      }
    }
  } catch (e) {
    logger.warn('Проверка схемы schedules пропустила:', e.message || e);
    return { broken: false, culprits };
  }
  return { broken: culprits.length > 0, culprits };
}

function audienceKey(r) {
  const classId = r.classId != null && String(r.classId) !== '' ? String(r.classId) : '10А';
  const track = r.trackId != null && String(r.trackId) !== '' ? String(r.trackId) : '';
  const sub = r.subgroupId != null && String(r.subgroupId) !== '' ? String(r.subgroupId) : '';
  return `${classId}|${r.dayOfWeek}|${r.lessonNumber}|${track}|${sub}`;
}

function maxUpdatedAt(a, b) {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

/**
 * Дедуп строк schedules только по полной аудитории.
 * Конфликт → keep max(updatedAt).
 * @param {Array<object>} rows - строки из старой таблицы
 * @returns {{kept: Array<object>, droppedIds: Array<number>}}
 */
function dedupeByAudience(rows) {
  const byAudience = new Map();
  const droppedIds = [];
  for (const r of rows) {
    const key = audienceKey(r);
    if (!byAudience.has(key)) {
      byAudience.set(key, r);
    } else {
      const prev = byAudience.get(key);
      const winner = maxUpdatedAt(r.updatedAt, prev.updatedAt) === prev.updatedAt ? prev : r;
      const loser = winner === prev ? r : prev;
      droppedIds.push(loser.id);
      byAudience.set(key, winner);
    }
  }
  return { kept: [...byAudience.values()], droppedIds };
}

/**
 * D2 — DDL-хирургия schedules по процедуре (SQLite: снять ограничение = пересоздать таблицу).
 * бэкап файла → foreign_key_check baseline → FK OFF → create новой по модели →
 * INSERT с явным списком колонок (id обязательно) → drop old → rename → индексы → FK ON →
 * foreign_key_check → сверка counts. Дедуп только по полной аудитории, keep max(updatedAt).
 * Бэкап не удался → abort без DROP, громкий лог.
 */
async function repairSchedulesD2() {
  const { broken, culprits } = await detectBrokenSchedules();
  if (!broken) return 'ok-clean';

  logger.info(`Обнаружена битая схема schedules (одиночные UNIQUE: ${culprits.join(', ')}), чиню по процедуре D2...`);

  // 0. Бэкап файла БД; неудача → abort без DROP
  try {
    backupDatabaseFile();
  } catch (backupErr) {
    logger.error(`❌ P0 D2: бэкап БД не удался (${backupErr.message}), DROP запрещён — ремонт прерван, нужен ручной бэкап`);
    return 'aborted-no-backup';
  }

  const fkBefore = await foreignKeyCheckCount();
  logger.info(`P0 D2: foreign_key_check до ремонта: ${fkBefore}`);
  let countBefore = -1;
  try {
    const c = await sequelize.query('SELECT COUNT(*) AS cnt FROM schedules', { type: Sequelize.QueryTypes.SELECT });
    countBefore = Number(c[0].cnt);
  } catch (_e) {
    void _e;
  }

  const qi = sequelize.getQueryInterface();
  try {
    await sequelize.query('PRAGMA foreign_keys = OFF');
  } catch (_fk) {
    void _fk;
  }
  try {
    // Gард: остаток прошлого неудачного ремонта — руками, не дропаем молча
    const tmp = await sequelize.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='${REPAIR_TMP_TABLE}'`, {
      type: Sequelize.QueryTypes.SELECT
    });
    if (tmp.length) {
      logger.error(`❌ P0 D2: найден остаток прошлого ремонта (${REPAIR_TMP_TABLE}) — DROP запрещён, нужен ручной разбор`);
      try {
        await sequelize.query('PRAGMA foreign_keys = ON');
      } catch (_fk) {
        void _fk;
      }
      return 'aborted-tmp-exists';
    }

    const tableInfo = await sequelize.query("PRAGMA table_info('schedules')", { type: Sequelize.QueryTypes.SELECT });
    const existingCols = tableInfo.map((c) => c.name);
    const copyCols = CANONICAL_SCHEDULE_COLS.filter((c) => existingCols.includes(c));

    const allRows = await sequelize.query('SELECT * FROM schedules', { type: Sequelize.QueryTypes.SELECT });

    // Дедуп только по полной аудитории, конфликт → keep max(updatedAt) + лог id
    const { kept: keptRows, droppedIds } = dedupeByAudience(allRows);
    if (droppedIds.length) {
      logger.info(`P0 D2: дедуп по полной аудитории — удалено дублей: ${droppedIds.length} (id: ${droppedIds.join(',')})`);
    }

    // SQLite ≥3.25 при RENAME переписывает REFERENCES в чужих таблицах (homeworks уехала бы
    // на schedules_old_p0) — запрещаем ДО переименования: homeworks должна ссылаться
    // на имя 'schedules' (новую таблицу).
    try {
      await sequelize.query('PRAGMA legacy_alter_table = ON');
    } catch (_lat) {
      void _lat;
    }
    await sequelize.query('ALTER TABLE schedules RENAME TO ' + qi.quoteIdentifier(REPAIR_TMP_TABLE));
    // Индексы переезжают вместе с переименованной таблицей — освобождаем имена для новой
    const carried = await sequelize.query(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${REPAIR_TMP_TABLE}'`, {
      type: Sequelize.QueryTypes.SELECT
    });
    for (const c of carried) {
      if (c.name && !c.name.startsWith('sqlite_')) {
        try {
          await sequelize.query(`DROP INDEX IF EXISTS ${qi.quoteIdentifier(c.name)}`);
        } catch (_dropCarried) {
          void _dropCarried;
        }
      }
    }
    const { Schedule } = require('../models');
    await Schedule.sync();
    if (keptRows.length) {
      const nowIso = new Date().toISOString();
      const toInsert = keptRows.map((r) => {
        const row = {};
        for (const c of copyCols) row[c] = r[c];
        if (!('classId' in row)) row.classId = '10А';
        if (!('trackId' in row)) row.trackId = null;
        if (!('subgroupId' in row)) row.subgroupId = null;
        if (!('createdAt' in row) || !row.createdAt) row.createdAt = nowIso;
        if (!('updatedAt' in row) || !row.updatedAt) row.updatedAt = nowIso;
        return row;
      });
      await qi.bulkInsert('schedules', toInsert);
    }
    await sequelize.query(`DROP TABLE ${qi.quoteIdentifier(REPAIR_TMP_TABLE)}`);
    try {
      await sequelize.query('PRAGMA legacy_alter_table = OFF');
    } catch (_latOff) {
      void _latOff;
    }
    try {
      await sequelize.query('PRAGMA foreign_keys = ON');
    } catch (_fk2) {
      void _fk2;
    }
    const fkAfter = await foreignKeyCheckCount();
    logger.info(`P0 D2: foreign_key_check после ремонта: ${fkAfter}`);
    let countAfter = -1;
    try {
      const c2 = await sequelize.query('SELECT COUNT(*) AS cnt FROM schedules', { type: Sequelize.QueryTypes.SELECT });
      countAfter = Number(c2[0].cnt);
    } catch (_e2) {
      void _e2;
    }
    logger.info(`✅ P0 D2: ремонт schedules завершён (строк: ${countBefore} → ${countAfter})`);
    return 'ok-repaired';
  } catch (repairErr) {
    logger.error(`❌ P0 D2: ремонт schedules не удался (${repairErr.message}), таблица schedules_old_p0 сохранена для ручного разбора`);
    try {
      await sequelize.query('PRAGMA legacy_alter_table = OFF');
    } catch (_latOff2) {
      void _latOff2;
    }
    try {
      await sequelize.query('PRAGMA foreign_keys = ON');
    } catch (_fk3) {
      void _fk3;
    }
    return 'failed';
  }
}

/**
 * P2 — колонка UserProfile.scope (идемпотентно, без DROP).
 * Вызывать ДО sequelize.sync(): иначе sync попытается создать таблицу/индекс
 * с колонкой, которой нет в legacy-БД. Backfill существующих → 'own'.
 */
async function ensureUserProfileScopeColumn() {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('user_profiles').catch(() => null);
    if (!desc) return;
    if (!desc.scope) {
      await qi.addColumn('user_profiles', 'scope', {
        type: Sequelize.DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'own'
      });
      logger.info('✅ Prelim миграция: добавлен user_profiles.scope');
    }
    try {
      await sequelize.query("UPDATE user_profiles SET scope='own' WHERE scope IS NULL OR scope=''");
    } catch (_bf) {
      void _bf;
    }
  } catch (preErr) {
    logger.warn('⚠️ Prelim P2 миграция user_profiles.scope:', preErr.message || preErr);
  }
}

/**
 * P3 — колонки user_events.durationMs + user_events.status (идемпотентно, без DROP).
 * Вызывать ДО sequelize.sync(): иначе sync попытается создать таблицу/индекс
 * с колонками, которых нет в legacy-БД. Backfill существующих → status='ok'.
 */
async function ensureUserEventTelemetryColumns() {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('user_events').catch(() => null);
    if (!desc) return;
    if (!desc.durationMs) {
      await qi.addColumn('user_events', 'durationMs', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null
      });
      logger.info('✅ Prelim миграция: добавлен user_events.durationMs');
    }
    if (!desc.status) {
      await qi.addColumn('user_events', 'status', {
        type: Sequelize.DataTypes.ENUM('ok', 'error'),
        allowNull: false,
        defaultValue: 'ok'
      });
      logger.info('✅ Prelim миграция: добавлен user_events.status');
    }
    try {
      await sequelize.query("UPDATE user_events SET status='ok' WHERE status IS NULL OR status=''");
    } catch (_bf) {
      void _bf;
    }
  } catch (preErr) {
    logger.warn('⚠️ Prelim P3 миграция user_events.durationMs/status:', preErr.message || preErr);
  }
}

/**
 * P1 item 1 — колонки subgroups v2 (идемпотентно, без DROP).
 * Вызывать ДО sequelize.sync(): иначе sync упадёт на индексе subgroups_division,
 * когда колонки division ещё нет (legacy-БД со схемой teacherName).
 */
async function ensureSubgroupsV2Columns() {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('subgroups').catch(() => null);
    if (!desc) return;
    const { DataTypes } = require('sequelize');
    if (desc.teacherName && !desc.teacher) {
      await qi.addColumn('subgroups', 'teacher', { type: DataTypes.STRING(100), allowNull: true, defaultValue: null });
      logger.info('✅ Prelim миграция: добавлен subgroups.teacher');
    }
    if (!desc.division) {
      await qi.addColumn('subgroups', 'division', { type: DataTypes.STRING(100), allowNull: true, defaultValue: null });
      logger.info('✅ Prelim миграция: добавлен subgroups.division');
    }
    if (!desc.name) {
      await qi.addColumn('subgroups', 'name', { type: DataTypes.STRING(100), allowNull: true, defaultValue: null });
      logger.info('✅ Prelim миграция: добавлен subgroups.name');
    }
  } catch (preErr) {
    logger.warn('⚠️ Prelim V2 миграция subgroups:', preErr.message || preErr);
  }
}

/**
 * P1 item 1 — миграция subgroups на схему v2 (идемпотентная добивка, без DROP).
  * Старые строки belova/firfarova: `division='Английский язык'`, `teacherName→teacher`,
 * `name` из учителя; `id` стабильны, `schedules.subgroupId` не трогаем.
 * Legacy-колонка `teacherName` остаётся в файле БД (не мешает, sync без alter её не дропает).
 */
async function migrateSubgroupsV2() {
  try {
    await ensureSubgroupsV2Columns();
    const qi = sequelize.getQueryInterface();
    // Бэкфилл существующих строк (id стабильны)
    try {
      await sequelize.query("UPDATE subgroups SET division='Английский язык' WHERE division IS NULL OR division=''");
    } catch (_bf1) { void _bf1; }
    const hasTeacherName = !!(await qi.describeTable('subgroups').catch(() => ({}))).teacherName;
    if (hasTeacherName) {
      try {
        await sequelize.query('UPDATE subgroups SET teacher=teacherName WHERE teacher IS NULL AND teacherName IS NOT NULL');
      } catch (_bf2) { void _bf2; }
      try {
        await sequelize.query("UPDATE subgroups SET name=COALESCE(teacher, teacherName, id) WHERE name IS NULL OR name=''");
      } catch (_bf3) { void _bf3; }
    } else {
      try {
        await sequelize.query("UPDATE subgroups SET name=COALESCE(teacher, id) WHERE name IS NULL OR name=''");
      } catch (_bf4) { void _bf4; }
    }
    // subject → nullable (старая схема требовала NOT NULL); не удалось — только warn
    try {
      const after = await qi.describeTable('subgroups').catch(() => null);
      if (after && after.subject && after.subject.allowNull === false) {
        const { DataTypes: DT } = require('sequelize');
        await qi.changeColumn('subgroups', 'subject', { type: DT.STRING(40), allowNull: true, defaultValue: null });
        logger.info('✅ Миграция: subgroups.subject → nullable');
      }
    } catch (subjErr) {
      logger.warn('⚠️ subgroups.subject остался NOT NULL (subject=null встанет только на свежих БД):', subjErr.message || subjErr);
    }
  } catch (migErr) {
    logger.warn('⚠️ V2 миграция subgroups:', migErr.message || migErr);
  }
}

/**
 * Идемпотентный foundation-seed V6: только find-or-create/skip, никогда destroy.
 * Подгруппы — в схеме v2 (P1): division/name/teacher/subject.
 */
async function seedFoundationIdempotent() {
  const { Class, Track, Subgroup } = require('../models');
  await Class.findOrCreate({
    where: { id: '10А' },
    defaults: { grade: 10, letter: 'А', enabled: true }
  });
  await Track.findOrCreate({
    where: { id: 'tech', classId: '10А' },
    defaults: { classId: '10А', name: 'Технологический профиль', isCommon: false }
  });
  await Track.findOrCreate({
    where: { id: 'soc', classId: '10А' },
    defaults: { classId: '10А', name: 'Социально-экономический профиль', isCommon: false }
  });
  await Subgroup.findOrCreate({
    where: { id: 'belova' },
    defaults: { division: 'Английский язык', name: 'Белова', teacher: 'Белова Ирина Николаевна', subject: 'английский', classId: null, active: true }
  });
  await Subgroup.findOrCreate({
    where: { id: 'firfarova' },
    defaults: { division: 'Английский язык', name: 'Фирфарова', teacher: 'Фирфарова Валерия Михайловна', subject: 'английский', classId: null, active: true }
  });
  // Бэкфилл существующих schedule без classId (legacy rows)
  try {
    await sequelize.query("UPDATE schedules SET classId='10А' WHERE classId IS NULL");
  } catch (_bf) {
    void _bf;
  }
  logger.info('✅ V6 foundation seeded (Class/Track/Subgroup).');
}

function ensureDataMigrationsLedger() {
  return sequelize.query(
    'CREATE TABLE IF NOT EXISTS data_migrations (id TEXT PRIMARY KEY, appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );
}

/**
 * Раннер одноразовых миграций данных: scripts/data-migrations/*.js по имени,
 * каждая в транзакции, пропуск применённых. Граница: ledger — только одноразовые ДАННЫЕ.
 */
async function runDataMigrations() {
  await ensureDataMigrationsLedger();
  let applied = [];
  try {
    const rows = await sequelize.query('SELECT id FROM data_migrations', { type: Sequelize.QueryTypes.SELECT });
    applied = rows.map((r) => r.id);
  } catch (_e) {
    void _e;
  }
  const appliedSet = new Set(applied);
  const migDir = path.join(__dirname, '..', '..', 'scripts', 'data-migrations');
  let files = [];
  try {
    files = fs.readdirSync(migDir).filter((f) => f.endsWith('.js')).sort();
  } catch (_e) {
    void _e;
    return;
  }
  for (const f of files) {
    const full = path.join(migDir, f);
    let mig = null;
    try {
      mig = require(full);
    } catch (loadErr) {
      logger.warn(`⚠️ P0 ledger: не загрузилась миграция ${f}:`, loadErr.message || loadErr);
      continue;
    }
    const migId = (mig && mig.id) || f.replace(/\.js$/, '');
    if (!mig || typeof mig.up !== 'function') {
      logger.warn(`⚠️ P0 ledger: миграция ${f} без up() — пропуск`);
      continue;
    }
    if (appliedSet.has(migId)) continue;
    try {
      await sequelize.transaction(async (t) => {
        await mig.up({ sequelize, transaction: t });
        await sequelize.query('INSERT INTO data_migrations (id) VALUES (:id)', {
          replacements: { id: migId },
          transaction: t
        });
      });
      logger.info(`✅ P0 ledger: применена миграция ${migId}`);
    } catch (migErr) {
      logger.warn(`⚠️ P0 ledger: миграция ${migId} не удалась:`, migErr.message || migErr);
    }
  }
}

async function writeSchemaVersion() {
  try {
    const { Setting } = require('../models');
    await Setting.upsert({ key: 'schema_version', value: SCHEMA_VERSION });
    logger.info(`✅ schema_version=${SCHEMA_VERSION}`);
  } catch (verErr) {
    logger.warn('⚠️ schema_version не записана:', verErr.message || verErr);
  }
}

// Функция для синхронизации моделей с БД
async function syncDatabase() {
  // D2: чиню битую схему schedules до sync (детектор — только одиночные UNIQUE)
  try {
    await repairSchedulesD2();
  } catch (e) {
    logger.warn('Проверка схемы schedules пропустила:', e.message || e);
  }
  try {
    // гарантируем что все модели зарегистрированы до sync
    try {
      require('../models');
    } catch (_e3) {
      void _e3;
    }
    try {
      await sequelize.query('PRAGMA foreign_keys = OFF');
    } catch (_fk) {
      void _fk;
    }
    // V6 колонки ДО sync — иначе sync попробует создать unique_lesson_per_audience на несуществующей колонке
    try {
      const qii = sequelize.getQueryInterface();
      const ddesc = await qii.describeTable('schedules').catch(() => null);
      if (ddesc && !ddesc.classId) {
        await qii.addColumn('schedules', 'classId', { type: Sequelize.DataTypes.STRING(10), allowNull: false, defaultValue: '10А' });
        logger.info('✅ Prelim миграция: добавлен schedules.classId');
      }
      if (ddesc && !ddesc.trackId) {
        await qii.addColumn('schedules', 'trackId', { type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: null });
        logger.info('✅ Prelim миграция: добавлен schedules.trackId');
      }
      if (ddesc && !ddesc.subgroupId) {
        await qii.addColumn('schedules', 'subgroupId', { type: Sequelize.DataTypes.STRING(40), allowNull: true, defaultValue: null });
        logger.info('✅ Prelim миграция: добавлен schedules.subgroupId');
      }
    } catch (preMig) {
      logger.warn('⚠️ Prelim V6 миграция:', preMig.message || preMig);
    }
    // P1 item 1: колонки subgroups v2 ДО sync (иначе sync упадёт на subgroups_division)
    try {
      await ensureSubgroupsV2Columns();
    } catch (_sgPre) {
      void _sgPre;
    }
    // P2: колонка user_profiles.scope ДО sync + backfill 'own'
    try {
      await ensureUserProfileScopeColumn();
    } catch (_scopePre) {
      void _scopePre;
    }
    // P3: колонки user_events.durationMs/status ДО sync + backfill 'ok'
    try {
      await ensureUserEventTelemetryColumns();
    } catch (_evPre) {
      void _evPre;
    }
    // Безопасный sync без alter — создаёт отсутствующие таблицы, не ломает существующие (SQLite alter в Sequelize 6 криво пересоздаёт UNIQUE).
    // Новые колонки/индексы V6 добавляем вручную ниже (совместимо с sync({alter:true}) по результату, но без бага).
    await sequelize.sync();
    // Ручная миграция V6 колонок для schedules (если таблица уже была до V6)
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('schedules');
      if (!desc.classId) {
        await qi.addColumn('schedules', 'classId', { type: Sequelize.DataTypes.STRING(10), allowNull: false, defaultValue: '10А' });
        logger.info('✅ Миграция: добавлен schedules.classId');
      }
      if (!desc.trackId) {
        await qi.addColumn('schedules', 'trackId', { type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: null });
        logger.info('✅ Миграция: добавлен schedules.trackId');
      }
      if (!desc.subgroupId) {
        await qi.addColumn('schedules', 'subgroupId', { type: Sequelize.DataTypes.STRING(40), allowNull: true, defaultValue: null });
        logger.info('✅ Миграция: добавлен schedules.subgroupId');
      }
      // Индексы V6
      const schedIdx = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='schedules'", { type: Sequelize.QueryTypes.SELECT });
      const schedIdxNames = schedIdx.map((r) => r.name);
      // Legacy уникальность по (dayOfWeek, lessonNumber) блокирует ортогональные аудитории — дропаем и заменяем на неуникальный
      if (schedIdxNames.includes('unique_lesson_per_day')) {
        try {
          await sequelize.query('DROP INDEX IF EXISTS unique_lesson_per_day');
          logger.info('✅ Миграция: удалён legacy unique_lesson_per_day');
        } catch (_dropLegacy) {
          void _dropLegacy;
        }
      }
      // Пересчитываем после дропа
      const schedIdxAfter = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='schedules'", { type: Sequelize.QueryTypes.SELECT });
      const schedIdxNamesAfter = schedIdxAfter.map((r) => r.name);
      if (!schedIdxNamesAfter.includes('idx_schedules_day_lesson')) {
        try {
          await qi.addIndex('schedules', ['dayOfWeek', 'lessonNumber'], { name: 'idx_schedules_day_lesson' });
          logger.info('✅ Миграция: создан индекс idx_schedules_day_lesson');
        } catch (_idxErr) {
          void _idxErr;
        }
      }
      if (!schedIdxNamesAfter.includes('unique_lesson_per_audience')) {
        await qi.addIndex('schedules', ['classId', 'dayOfWeek', 'lessonNumber', 'trackId', 'subgroupId'], { unique: true, name: 'unique_lesson_per_audience' });
        logger.info('✅ Миграция: создан индекс unique_lesson_per_audience');
      }
      if (!schedIdxNames.includes('schedules_class_id')) {
        await qi.addIndex('schedules', ['classId'], { name: 'schedules_class_id' });
      }
      if (!schedIdxNames.includes('schedules_track_id')) {
        await qi.addIndex('schedules', ['trackId'], { name: 'schedules_track_id' });
      }
      if (!schedIdxNames.includes('schedules_subgroup_id')) {
        await qi.addIndex('schedules', ['subgroupId'], { name: 'schedules_subgroup_id' });
      }
      // D1: legacy UNIQUE домашки запрещён — добивка дропа + обычный индекс
      try {
        await sequelize.query('DROP INDEX IF EXISTS unique_homework_per_date');
      } catch (_dropHw) {
        void _dropHw;
      }
      const hwIdx = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='homeworks'", { type: Sequelize.QueryTypes.SELECT });
      const hwIdxNames = hwIdx.map((r) => r.name);
      if (hwIdxNames.includes('unique_homework_per_date')) {
        logger.info('✅ Миграция: удалён legacy unique_homework_per_date');
      }
      if (!hwIdxNames.includes('idx_homework_schedule_date')) {
        await qi.addIndex('homeworks', ['scheduleId', 'date'], { name: 'idx_homework_schedule_date' });
        logger.info('✅ Миграция: создан индекс idx_homework_schedule_date');
      }
    } catch (migErr) {
      logger.warn('⚠️ V6 миграция колонок/индексов:', migErr.message || migErr);
    }
    // P1 item 1: subgroups → v2 (division/name/teacher, subject nullable) до сидов
    try {
      await migrateSubgroupsV2();
    } catch (_sg) {
      void _sg;
    }
    try {
      await sequelize.query('PRAGMA foreign_keys = ON');
    } catch (_fk2) {
      void _fk2;
    }
    logger.info('✅ Модели синхронизированы с базой данных.');
    try {
      const { seedLessonTimes } = require('../utils/seedLessonTimes');
      await seedLessonTimes();
      logger.info('✅ LessonTimes seeded.');
    } catch (seedErr) {
      logger.warn('⚠️ LessonTimes seeding failed:', seedErr.message || seedErr);
    }
    // V6 foundation seed: только find-or-create/skip, деструктив — только ledger
    try {
      await seedFoundationIdempotent();
    } catch (foundationErr) {
      logger.warn('⚠️ V6 foundation seeding failed:', foundationErr.message || foundationErr);
    }
    // P1 item 3: каталог аудиторий из файла поверх БД (не роняет boot)
    try {
      const { syncAudienceCatalog } = require('../utils/audienceLoader');
      await syncAudienceCatalog();
    } catch (audienceErr) {
      logger.warn('⚠️ audienceLoader failed:', audienceErr.message || audienceErr);
    }
    // Ledger одноразовых миграций данных (граница: схема — только sync())
    try {
      await runDataMigrations();
    } catch (ledgerErr) {
      logger.warn('⚠️ P0 ledger failed:', ledgerErr.message || ledgerErr);
    }
    // Диагностический ярлык схемы — после успешного sync
    await writeSchemaVersion();
    // P4: итог sync одной строкой (таблицы/индексы/counts) — диагностика чистого boot
    try {
      const tables = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        { type: Sequelize.QueryTypes.SELECT }
      );
      const indexes = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
        { type: Sequelize.QueryTypes.SELECT }
      );
      const counts = [];
      for (const t of ['schedules', 'homeworks', 'lesson_times', 'classes', 'tracks', 'subgroups']) {
        try {
          const c = await sequelize.query(`SELECT COUNT(*) AS cnt FROM "${t}"`, { type: Sequelize.QueryTypes.SELECT });
          counts.push(`${t}=${c[0].cnt}`);
        } catch (_e) {
          void _e;
        }
      }
      logger.info(`✅ syncDatabase итог: таблицы=${tables.length} индексы=${indexes.length} ${counts.join(' ')}`);
    } catch (_summaryErr) {
      void _summaryErr;
    }
    // Миграция audience-unique: SQLite NULL != NULL, поэтому unique_lesson_per_day оставляем как legacy.
    // unique_lesson_per_audience уже создан через sync({alter:true}); дополнительная COALESCE-миграция не требуется для MVP.
    // Если в будущем потребуется строгая уникальность с NULL-as-value — дроп legacy индекса и пересоздание через COALESCE
    // выполняется под флагом; по умолчанию flag=0 — ничего не дропаем (сохранение совместимости).
  } catch (error) {
    logger.error('❌ Ошибка синхронизации:', error);

    // Попытка безопасно восстановить отсутствующие таблицы по-отдельности.
    try {
      // Подключаем модели динамически, чтобы гарантировать их регистрацию в sequelize
      const { Setting, Schedule, Homework, LessonTime, Class, Track, Subgroup, User, UserEvent, UserProfile } = require('../models');

      // P1 item 1: колонки subgroups v2 до per-model sync (та же причина — subgroups_division)
      try {
        await ensureSubgroupsV2Columns();
      } catch (_sgPreFb) {
        void _sgPreFb;
      }
      // P2: колонка user_profiles.scope до per-model sync + backfill
      try {
        await ensureUserProfileScopeColumn();
      } catch (_scopePreFb) {
        void _scopePreFb;
      }
      // P3: колонки user_events.durationMs/status до per-model sync + backfill
      try {
        await ensureUserEventTelemetryColumns();
      } catch (_evPreFb) {
        void _evPreFb;
      }
      // Синхронизируем только конкретные модели — это поможет создать отсутствующие таблицы
      await Setting.sync();
      await Schedule.sync();
      await Homework.sync();
      await LessonTime.sync();
      await Class.sync();
      await Track.sync();
      await Subgroup.sync();
      await User.sync();
      await UserEvent.sync();
      await UserProfile.sync();
      logger.info('✅ Отдельные таблицы созданы/синхронизированы (fallback).');
      try {
        const { seedLessonTimes } = require('../utils/seedLessonTimes');
        await seedLessonTimes();
        logger.info('✅ LessonTimes seeded (fallback).');
      } catch (seedErr) {
        logger.warn('⚠️ LessonTimes seeding failed (fallback):', seedErr.message || seedErr);
      }
      try {
        await seedFoundationIdempotent();
        logger.info('✅ V6 foundation seeded (fallback).');
      } catch (foundationFallbackErr) {
        logger.warn('⚠️ V6 foundation seeding failed (fallback):', foundationFallbackErr.message || foundationFallbackErr);
      }
      try {
        const { syncAudienceCatalog } = require('../utils/audienceLoader');
        await syncAudienceCatalog();
      } catch (audienceFbErr) {
        logger.warn('⚠️ audienceLoader failed (fallback):', audienceFbErr.message || audienceFbErr);
      }
      try {
        await runDataMigrations();
      } catch (ledgerFbErr) {
        logger.warn('⚠️ P0 ledger failed (fallback):', ledgerFbErr.message || ledgerFbErr);
      }
      await writeSchemaVersion();
    } catch (fallbackErr) {
      logger.error('❌ Fallback синхронизации моделей не удался:', fallbackErr);
    }
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
  SCHEMA_VERSION,
  // exposed for testing
  _dedupeByAudience: dedupeByAudience,
  _migrateSubgroupsV2: migrateSubgroupsV2,
  _ensureSubgroupsV2Columns: ensureSubgroupsV2Columns,
  _ensureUserProfileScopeColumn: ensureUserProfileScopeColumn,
  _ensureUserEventTelemetryColumns: ensureUserEventTelemetryColumns
};
