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
  // Для sqlite: попробуем удалить старые проблемные уникальные индексы
  // (например, уникальный индекс только на `dayOfWeek`), чтобы избежать
  // ошибок при выполнении ALTER TABLE через механизм создания backup-таблицы.
  try {
    const indexes = await sequelize.query("PRAGMA index_list('schedules')", { type: Sequelize.QueryTypes.SELECT });
    for (const idx of indexes) {
      // В sqlite поле unique возвращается как 1/0
      if (idx.unique) {
        const idxName = idx.name;
        const qi = sequelize.getQueryInterface();
        const quotedIdx = qi.quoteIdentifier(idxName);
        const cols = await sequelize.query(`PRAGMA index_info(${quotedIdx})`, { type: Sequelize.QueryTypes.SELECT });
        if (Array.isArray(cols) && cols.length === 1 && cols[0].name === 'dayOfWeek') {
          console.log(`Удаляю проблемный индекс ${idxName} (уникальный на dayOfWeek)`);
          try {
            await sequelize.query(`DROP INDEX IF EXISTS ${quotedIdx};`);
          } catch (dropErr) {
            console.warn('Не удалось удалить индекс', idxName, dropErr);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Не удалось получить список индексов schedules:', e.message || e);
  }
  try {
    await sequelize.sync({ alter: true });
    console.log('✅ Модели синхронизированы с базой данных.');
    try {
      const { seedLessonTimes } = require('../utils/seedLessonTimes');
      await seedLessonTimes();
      console.log('✅ LessonTimes seeded.');
    } catch (seedErr) {
      console.warn('⚠️ LessonTimes seeding failed:', seedErr.message || seedErr);
    }
  } catch (error) {
    console.error('❌ Ошибка синхронизации:', error);

    // Попытка безопасно восстановить отсутствующие таблицы по-отдельности.
    try {
      // Подключаем модели динамически, чтобы гарантировать их регистрацию в sequelize
      const { Setting, Schedule, Homework, LessonTime } = require('../models');

      // Синхронизируем только конкретные модели — это поможет создать отсутствующие таблицы
      await Setting.sync();
      await Schedule.sync();
      await Homework.sync();
      await LessonTime.sync();
      console.log('✅ Отдельные таблицы созданы/синхронизированы (fallback).');
      try {
        const { seedLessonTimes } = require('../utils/seedLessonTimes');
        await seedLessonTimes();
        console.log('✅ LessonTimes seeded (fallback).');
      } catch (seedErr) {
        console.warn('⚠️ LessonTimes seeding failed (fallback):', seedErr.message || seedErr);
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
