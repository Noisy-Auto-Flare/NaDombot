const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const useSqlite = process.env.USE_SQLITE === 'true' || process.env.DB_DIALECT === 'sqlite';

let sequelize;

if (useSqlite) {
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
  } catch (err) {
    console.error(`Нет прав на запись в директорию ${dir}. Проверьте права доступа.`);
    process.exit(1);
  }
  
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: sqlitePath,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: { max: 1, min: 0 }
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: 'postgres',
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      pool: { max: 2, min: 0, acquire: 30000, idle: 10000 }
    }
  );
}

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
  try {
    await sequelize.sync({ alter: true });
    console.log('✅ Модели синхронизированы с базой данных.');
  } catch (error) {
    console.error('❌ Ошибка синхронизации:', error);

    // Попытка безопасно восстановить отсутствующие таблицы по-отдельности.
    try {
      // Подключаем модели динамически, чтобы гарантировать их регистрацию в sequelize
      const { Setting, Schedule, Homework } = require('../models');

      // Синхронизируем только конкретные модели — это поможет создать отсутствующие таблицы
      await Setting.sync();
      await Schedule.sync();
      await Homework.sync();
      console.log('✅ Отдельные таблицы созданы/синхронизированы (fallback).');
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
