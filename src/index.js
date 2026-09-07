const bot = require('./config/bot');
const { testConnection, syncDatabase } = require('./config/database');
const { Scenes } = require('telegraf');
const { runCleanup } = require('./utils/cleanup');

// Импорт сцен
const addHomeworkScene = require('./scenes/addHomeworkScene');
const addHomeworkOnDateScene = require('./scenes/addHomeworkOnDateScene');
const manageScheduleScene = require('./scenes/manageScheduleScene');

// Импорт обработчиков
const {
  handleStart,
  handleHelp,
  handleAddHomework,
  handleAddHomeworkOnDate,
  handleHomeworkTomorrow,
  handleHomeworkWeek,
  handleManageSchedule,
  handleBackToMenu,
  handleToggleHomeworkVisibility,
  handleCurrentLesson
} = require('./handlers/commands');

// Регистрация сцен
const stage = new Scenes.Stage([addHomeworkScene, addHomeworkOnDateScene, manageScheduleScene]);
bot.use(stage.middleware());

// Регистрация команд
bot.command('start', handleStart);
bot.command('help', handleHelp);

// Регистрация обработчиков кнопок
bot.action('add_homework', handleAddHomework);
bot.action('add_homework_on_date', handleAddHomeworkOnDate);
bot.action('homework_tomorrow', handleHomeworkTomorrow);
bot.action('homework_week', handleHomeworkWeek);
bot.action('current_lesson', handleCurrentLesson);
bot.action('manage_schedule', handleManageSchedule);
bot.action('back_to_menu', handleBackToMenu);
bot.action('toggle_hw_visibility', handleToggleHomeworkVisibility);

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('Ошибка в боте:', err);
  ctx.reply('❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
});

// Запуск бота
async function startBot() {
  try {
    // Проверяем подключение к БД
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('Не удалось подключиться к базе данных. Проверьте настройки.');
      process.exit(1);
    }

    // Синхронизируем модели с БД
    await syncDatabase();

    // Очищаем старые домашние задания (на прошедшие дни)
    await runCleanup();

    // Запускаем бота
    await bot.launch();
    console.log('✅ Бот успешно запущен!');

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Ошибка при запуске бота:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

startBot();
