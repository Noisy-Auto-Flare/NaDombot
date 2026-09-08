const { Telegraf, session } = require('telegraf');
require('dotenv').config();

// Проверка наличия токена
if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN не установлен в переменных окружения');
}

// Создание экземпляра бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware для сессий (необходимо для работы сцен)
bot.use(session());

// Телеметрия: upsert User + UserEvent на каждом апдейте (не блокирует обработку)
bot.use(require('../middleware/userTelemetry').userTelemetry);

module.exports = bot;
