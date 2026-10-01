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
    console.error('Ошибка при создании директории для SQLite:', err.message);
  }
}

// Проверяем права на запись
try {
  fs.accessSync(dir, fs.constants.W_OK);
} catch (_err) {
  console.error(`Нет прав на запись в директорию ${dir}. Проверьте права доступа.`);
  process.exit(1);
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: sqlitePath,
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: { max: 1, min: 0 },
});

// Функция для проверки подключения
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Подключение к базе данных установлено успешно.');
    return true;
  } catch (error) {
    console.error('❌ Ошибка подключения к базе данных:', error.message);
    return false;
  }
}

const SCHEMA_VERSION_P0 = 'p0-baseline';
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
  console.log(`✅ P0 бэкап БД: ${backupPath}`);
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
    console.warn('Проверка схемы schedules пропустила:', e.message || e);
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

  console.log(`Обнаружена битая схема schedules (одиночные UNIQUE: ${culprits.join(', ')}), чиню по процедуре D2...`);

  // 0. Бэкап файла БД; неудача → abort без DROP
  try {
    backupDatabaseFile();
  } catch (backupErr) {
    console.error(`❌ P0 D2: бэкап БД не удался (${backupErr.message}), DROP запрещён — ремонт прерван, нужен ручной бэкап`);
    return 'aborted-no-backup';
  }

  const fkBefore = await foreignKeyCheckCount();
  console.log(`P0 D2: foreign_key_check до ремонта: ${fkBefore}`);
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
      console.error(`❌ P0 D2: найден остаток прошлого ремонта (${REPAIR_TMP_TABLE}) — DROP запрещён, нужен ручной разбор`);
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
      console.log(`P0 D2: дедуп по полной аудитории — удалено дублей: ${droppedIds.length} (id: ${droppedIds.join(',')})`);
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
    console.log(`P0 D2: foreign_key_check после ремонта: ${fkAfter}`);
    let countAfter = -1;
    try {
      const c2 = await sequelize.query('SELECT COUNT(*) AS cnt FROM schedules', { type: Sequelize.QueryTypes.SELECT });
      countAfter = Number(c2[0].cnt);
    } catch (_e2) {
      void _e2;
    }
    console.log(`✅ P0 D2: ремонт schedules завершён (строк: ${countBefore} → ${countAfter})`);
    return 'ok-repaired';
  } catch (repairErr) {
    console.error(`❌ P0 D2: ремонт schedules не удался (${repairErr.message}), таблица schedules_old_p0 сохранена для ручного разбора`);
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
 * Идемпотентный foundation-seed V6: только find-or-create/skip, никогда destroy.
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
    defaults: { subject: 'английский', teacherName: 'Белова', classId: null, active: true }
  });
  await Subgroup.findOrCreate({
    where: { id: 'petrova' },
    defaults: { subject: 'английский', teacherName: 'Петрова', classId: null, active: true }
  });
  // Бэкфилл существующих schedule без classId (legacy rows)
  try {
    await sequelize.query("UPDATE schedules SET classId='10А' WHERE classId IS NULL");
  } catch (_bf) {
    void _bf;
  }
  console.log('✅ V6 foundation seeded (Class/Track/Subgroup).');
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
      console.warn(`⚠️ P0 ledger: не загрузилась миграция ${f}:`, loadErr.message || loadErr);
      continue;
    }
    const migId = (mig && mig.id) || f.replace(/\.js$/, '');
    if (!mig || typeof mig.up !== 'function') {
      console.warn(`⚠️ P0 ledger: миграция ${f} без up() — пропуск`);
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
      console.log(`✅ P0 ledger: применена миграция ${migId}`);
    } catch (migErr) {
      console.warn(`⚠️ P0 ledger: миграция ${migId} не удалась:`, migErr.message || migErr);
    }
  }
}

async function writeSchemaVersion() {
  try {
    const { Setting } = require('../models');
    await Setting.upsert({ key: 'schema_version', value: SCHEMA_VERSION_P0 });
    console.log(`✅ schema_version=${SCHEMA_VERSION_P0}`);
  } catch (verErr) {
    console.warn('⚠️ schema_version не записана:', verErr.message || verErr);
  }
}

// Функция для синхронизации моделей с БД
async function syncDatabase() {
  // D2: чиню битую схему schedules до sync (детектор — только одиночные UNIQUE)
  try {
    await repairSchedulesD2();
  } catch (e) {
    console.warn('Проверка схемы schedules пропустила:', e.message || e);
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
        console.log('✅ Prelim миграция: добавлен schedules.classId');
      }
      if (ddesc && !ddesc.trackId) {
        await qii.addColumn('schedules', 'trackId', { type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: null });
        console.log('✅ Prelim миграция: добавлен schedules.trackId');
      }
      if (ddesc && !ddesc.subgroupId) {
        await qii.addColumn('schedules', 'subgroupId', { type: Sequelize.DataTypes.STRING(40), allowNull: true, defaultValue: null });
        console.log('✅ Prelim миграция: добавлен schedules.subgroupId');
      }
    } catch (preMig) {
      console.warn('⚠️ Prelim V6 миграция:', preMig.message || preMig);
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
        console.log('✅ Миграция: добавлен schedules.classId');
      }
      if (!desc.trackId) {
        await qi.addColumn('schedules', 'trackId', { type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: null });
        console.log('✅ Миграция: добавлен schedules.trackId');
      }
      if (!desc.subgroupId) {
        await qi.addColumn('schedules', 'subgroupId', { type: Sequelize.DataTypes.STRING(40), allowNull: true, defaultValue: null });
        console.log('✅ Миграция: добавлен schedules.subgroupId');
      }
      // Индексы V6
      const schedIdx = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='schedules'", { type: Sequelize.QueryTypes.SELECT });
      const schedIdxNames = schedIdx.map((r) => r.name);
      // Legacy уникальность по (dayOfWeek, lessonNumber) блокирует ортогональные аудитории — дропаем и заменяем на неуникальный
      if (schedIdxNames.includes('unique_lesson_per_day')) {
        try {
          await sequelize.query('DROP INDEX IF EXISTS unique_lesson_per_day');
          console.log('✅ Миграция: удалён legacy unique_lesson_per_day');
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
          console.log('✅ Миграция: создан индекс idx_schedules_day_lesson');
        } catch (_idxErr) {
          void _idxErr;
        }
      }
      if (!schedIdxNamesAfter.includes('unique_lesson_per_audience')) {
        await qi.addIndex('schedules', ['classId', 'dayOfWeek', 'lessonNumber', 'trackId', 'subgroupId'], { unique: true, name: 'unique_lesson_per_audience' });
        console.log('✅ Миграция: создан индекс unique_lesson_per_audience');
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
        console.log('✅ Миграция: удалён legacy unique_homework_per_date');
      }
      if (!hwIdxNames.includes('idx_homework_schedule_date')) {
        await qi.addIndex('homeworks', ['scheduleId', 'date'], { name: 'idx_homework_schedule_date' });
        console.log('✅ Миграция: создан индекс idx_homework_schedule_date');
      }
    } catch (migErr) {
      console.warn('⚠️ V6 миграция колонок/индексов:', migErr.message || migErr);
    }
    try {
      await sequelize.query('PRAGMA foreign_keys = ON');
    } catch (_fk2) {
      void _fk2;
    }
    console.log('✅ Модели синхронизированы с базой данных.');
    try {
      const { seedLessonTimes } = require('../utils/seedLessonTimes');
      await seedLessonTimes();
      console.log('✅ LessonTimes seeded.');
    } catch (seedErr) {
      console.warn('⚠️ LessonTimes seeding failed:', seedErr.message || seedErr);
    }
    // V6 foundation seed: только find-or-create/skip, деструктив — только ledger
    try {
      await seedFoundationIdempotent();
    } catch (foundationErr) {
      console.warn('⚠️ V6 foundation seeding failed:', foundationErr.message || foundationErr);
    }
    // Ledger одноразовых миграций данных (граница: схема — только sync())
    try {
      await runDataMigrations();
    } catch (ledgerErr) {
      console.warn('⚠️ P0 ledger failed:', ledgerErr.message || ledgerErr);
    }
    // Диагностический ярлык схемы — после успешного sync
    await writeSchemaVersion();
    // Миграция audience-unique: SQLite NULL != NULL, поэтому unique_lesson_per_day оставляем как legacy.
    // unique_lesson_per_audience уже создан через sync({alter:true}); дополнительная COALESCE-миграция не требуется для MVP.
    // Если в будущем потребуется строгая уникальность с NULL-as-value — дроп legacy индекса и пересоздание через COALESCE
    // выполняется под флагом; по умолчанию flag=0 — ничего не дропаем (сохранение совместимости).
  } catch (error) {
    console.error('❌ Ошибка синхронизации:', error);

    // Попытка безопасно восстановить отсутствующие таблицы по-отдельности.
    try {
      // Подключаем модели динамически, чтобы гарантировать их регистрацию в sequelize
      const { Setting, Schedule, Homework, LessonTime, Class, Track, Subgroup, User, UserEvent, UserProfile } = require('../models');

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
      console.log('✅ Отдельные таблицы созданы/синхронизированы (fallback).');
      try {
        const { seedLessonTimes } = require('../utils/seedLessonTimes');
        await seedLessonTimes();
        console.log('✅ LessonTimes seeded (fallback).');
      } catch (seedErr) {
        console.warn('⚠️ LessonTimes seeding failed (fallback):', seedErr.message || seedErr);
      }
      try {
        await seedFoundationIdempotent();
        console.log('✅ V6 foundation seeded (fallback).');
      } catch (foundationFallbackErr) {
        console.warn('⚠️ V6 foundation seeding failed (fallback):', foundationFallbackErr.message || foundationFallbackErr);
      }
      try {
        await runDataMigrations();
      } catch (ledgerFbErr) {
        console.warn('⚠️ P0 ledger failed (fallback):', ledgerFbErr.message || ledgerFbErr);
      }
      await writeSchemaVersion();
    } catch (fallbackErr) {
      console.error('❌ Fallback синхронизации моделей не удался:', fallbackErr);
    }
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
  // exposed for testing
  _dedupeByAudience: dedupeByAudience
};
