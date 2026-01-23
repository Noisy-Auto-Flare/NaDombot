const { Sequelize } = require('sequelize');
require('dotenv').config();

// Создание подключения к базе данных
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

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
