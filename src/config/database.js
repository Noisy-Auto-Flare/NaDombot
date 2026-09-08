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

// Функция для синхронизации моделей с БД
async function syncDatabase() {
  // Для sqlite: чиним битую схему schedules (старая версия создавала UNIQUE на lessonNumber и dayOfWeek отдельно)
  try {
    const tbl = await sequelize.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='schedules'", { type: Sequelize.QueryTypes.SELECT });
    const sql = tbl[0]?.sql || '';
    const hasBrokenCols = sql.includes('`lessonNumber`') && sql.includes('`dayOfWeek`') && /lessonNumber[^,]*UNIQUE/.test(sql) && /dayOfWeek[^,]*UNIQUE/.test(sql);
    const indexes = await sequelize.query("PRAGMA index_list('schedules')", { type: Sequelize.QueryTypes.SELECT }).catch(()=>[]);
    // hasAutoIndex: только u-origin (unique constraint вне PK) — pk-origin игнорируем, иначе всегда триггерит
    const hasAutoIndex = Array.isArray(indexes) && indexes.some(i => i.name && i.name.startsWith('sqlite_autoindex_schedules') && i.origin === 'u');
    if (hasBrokenCols || hasAutoIndex) {
      console.log('Обнаружена битая схема schedules (индивидуальные UNIQUE), пересоздаю таблицу...');
      // бэкап для отката (если данные есть)
      let backup = [];
      try { backup = await sequelize.query("SELECT * FROM schedules", { type: Sequelize.QueryTypes.SELECT }); } catch (_e) { void _e; }
      await sequelize.query("DROP TABLE IF EXISTS schedules");
      const { Schedule } = require('../models');
      await Schedule.sync();
      // попытка восстановить бэкап если он валиден под новую схему (композитный unique)
      if (backup.length) {
        const seen = new Set();
        let restored = 0;
        for (const r of backup) {
          const key = `${r.dayOfWeek}-${r.lessonNumber}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try { await Schedule.create({ dayOfWeek: r.dayOfWeek, lessonNumber: r.lessonNumber, subjectName: r.subjectName, room: r.room }); restored++; } catch (_e2) { void _e2; }
        }
        if (restored) console.log(`✅ Восстановлено ${restored} строк schedules из бэкапа`);
      }
    } else {
      // обычный фикс для одиночного индекса dayOfWeek (legacy)
      for (const idx of indexes) {
        if (idx.unique) {
          const idxName = idx.name;
          const qi = sequelize.getQueryInterface();
          const quotedIdx = qi.quoteIdentifier(idxName);
          const cols = await sequelize.query(`PRAGMA index_info(${quotedIdx})`, { type: Sequelize.QueryTypes.SELECT });
          if (Array.isArray(cols) && cols.length === 1 && (cols[0].name === 'dayOfWeek' || cols[0].name === 'lessonNumber')) {
            if (idx.origin === 'c') { // созданый вручную индекс — можно дропнуть
              console.log(`Удаляю проблемный индекс ${idxName} (уникальный на ${cols[0].name})`);
              try { await sequelize.query(`DROP INDEX IF EXISTS ${quotedIdx};`); } catch (dropErr) { console.warn('Не удалось удалить индекс', idxName, dropErr); }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('Проверка схемы schedules пропустила:', e.message || e);
  }
  try {
    // гарантируем что все модели зарегистрированы до sync
    try { require('../models'); } catch (_e3) { void _e3; }
    try { await sequelize.query('PRAGMA foreign_keys = OFF'); } catch (_fk) { void _fk; }
    // V6 колонки ДО sync — иначе sync попробует создать unique_lesson_per_audience на несуществующей колонке
    try {
      const qii = sequelize.getQueryInterface();
      const ddesc = await qii.describeTable('schedules').catch(()=>null);
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
    } catch(preMig){ console.warn('⚠️ Prelim V6 миграция:', preMig.message||preMig); }
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
      const schedIdxNames = schedIdx.map(r => r.name);
      // Legacy уникальность по (dayOfWeek, lessonNumber) блокирует ортогональные аудитории — дропаем и заменяем на неуникальный
      if (schedIdxNames.includes('unique_lesson_per_day')) {
        try {
          await sequelize.query("DROP INDEX IF EXISTS unique_lesson_per_day");
          console.log('✅ Миграция: удалён legacy unique_lesson_per_day');
        } catch (_dropLegacy) { void _dropLegacy; }
      }
      // Пересчитываем после дропа
      const schedIdxAfter = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='schedules'", { type: Sequelize.QueryTypes.SELECT });
      const schedIdxNamesAfter = schedIdxAfter.map(r => r.name);
      if (!schedIdxNamesAfter.includes('idx_schedules_day_lesson')) {
        try {
          await qi.addIndex('schedules', ['dayOfWeek', 'lessonNumber'], { name: 'idx_schedules_day_lesson' });
          console.log('✅ Миграция: создан индекс idx_schedules_day_lesson');
        } catch (_idxErr) { void _idxErr; }
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
      // Homework unique index
      const hwIdx = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='homeworks'", { type: Sequelize.QueryTypes.SELECT });
      const hwIdxNames = hwIdx.map(r => r.name);
      if (!hwIdxNames.includes('unique_homework_per_date')) {
        await qi.addIndex('homeworks', ['scheduleId', 'date'], { unique: true, name: 'unique_homework_per_date' });
        console.log('✅ Миграция: создан индекс unique_homework_per_date');
      }
    } catch (migErr) {
      console.warn('⚠️ V6 миграция колонок/индексов:', migErr.message || migErr);
    }
    try { await sequelize.query('PRAGMA foreign_keys = ON'); } catch (_fk2) { void _fk2; }
    console.log('✅ Модели синхронизированы с базой данных.');
    try {
      const { seedLessonTimes } = require('../utils/seedLessonTimes');
      await seedLessonTimes();
      console.log('✅ LessonTimes seeded.');
    } catch (seedErr) {
      console.warn('⚠️ LessonTimes seeding failed:', seedErr.message || seedErr);
    }
    // V6 foundation seed: Class 10А, Track tech/soc, Subgroup belova/ivanova + бэкфилл schedules.classId
    try {
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
        where: { id: 'ivanova' },
        defaults: { subject: 'английский', teacherName: 'Иванова', classId: null, active: true }
      });
      // Бэкфилл существующих schedule без classId (legacy rows)
      try {
        await sequelize.query("UPDATE schedules SET classId='10А' WHERE classId IS NULL");
      } catch (_bf) { void _bf; }
      console.log('✅ V6 foundation seeded (Class/Track/Subgroup).');
    } catch (foundationErr) {
      console.warn('⚠️ V6 foundation seeding failed:', foundationErr.message || foundationErr);
    }
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
        await Class.findOrCreate({ where: { id: '10А' }, defaults: { grade: 10, letter: 'А', enabled: true } });
        await Track.findOrCreate({ where: { id: 'tech', classId: '10А' }, defaults: { classId: '10А', name: 'Технологический профиль', isCommon: false } });
        await Track.findOrCreate({ where: { id: 'soc', classId: '10А' }, defaults: { classId: '10А', name: 'Социально-экономический профиль', isCommon: false } });
        await Subgroup.findOrCreate({ where: { id: 'belova' }, defaults: { subject: 'английский', teacherName: 'Белова', classId: null, active: true } });
        await Subgroup.findOrCreate({ where: { id: 'ivanova' }, defaults: { subject: 'английский', teacherName: 'Иванова', classId: null, active: true } });
        try { await sequelize.query("UPDATE schedules SET classId='10А' WHERE classId IS NULL"); } catch (_bf2) { void _bf2; }
        console.log('✅ V6 foundation seeded (fallback).');
      } catch (foundationFallbackErr) {
        console.warn('⚠️ V6 foundation seeding failed (fallback):', foundationFallbackErr.message || foundationFallbackErr);
      }
    } catch (fallbackErr) {
      console.error('❌ Fallback синхронизации моделей не удался:', fallbackErr);
    }
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase
};
