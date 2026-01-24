const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const useSqlite = process.env.USE_SQLITE === 'true' || process.env.DB_DIALECT === 'sqlite';

let sequelize;

if (useSqlite) {
  const dir = path.dirname(process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'db.sqlite'));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'db.sqlite'),
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
    console.error('❌ Ошибка синхронизации:', error.message);
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase
};
