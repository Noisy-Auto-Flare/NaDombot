const bot = require('./config/bot');
const { testConnection, syncDatabase } = require('./config/database');
const { Scenes } = require('telegraf');
const { runCleanup } = require('./utils/cleanup');

// Импорт сцен
const addHomeworkScene = require('./scenes/addHomeworkScene');
const addHomeworkOnDateScene = require('./scenes/addHomeworkOnDateScene');
const manageScheduleScene = require('./scenes/manageScheduleScene');
const selectProfileScene = require('./scenes/selectProfileScene');

// Импорт middleware
const { lazyOnboarding } = require('./middleware/lazyOnboarding');

// Импорт обработчиков
const {
  handleStart,
  handleHelp,
  handleAddHomework,
  handleAddHomeworkOnDate,
  handleHomeworkTomorrow,
  handleHomeworkWeek,
  handleManageSchedule,
  handleAdminManage,
  handleBackToMenu,
  handleToggleHomeworkVisibility,
  handleCurrentLesson,
  handleProfile,
  handleSelectProfile,
  handleProfileEditClass,
  handleProfileEditTrack,
  handleProfileEditSubgroup,
  handleProfileReset
} = require('./handlers/commands');

// Регистрация сцен
const stage = new Scenes.Stage([addHomeworkScene, addHomeworkOnDateScene, manageScheduleScene, selectProfileScene]);
bot.use(stage.middleware());

// Lazy onboarding после stage (иначе ctx.scene undefined)
bot.use(lazyOnboarding);

// Регистрация команд
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('profile', handleProfile);

// Регистрация обработчиков кнопок
bot.action('add_homework', handleAddHomework);
bot.action('add_homework_on_date', handleAddHomeworkOnDate);
bot.action('homework_tomorrow', handleHomeworkTomorrow);
bot.action('homework_week', handleHomeworkWeek);
bot.action('current_lesson', handleCurrentLesson);
bot.action('manage_schedule', handleManageSchedule);
bot.action('admin_manage', handleAdminManage);
bot.action('back_to_menu', handleBackToMenu);
bot.action('toggle_hw_visibility', handleToggleHomeworkVisibility);
// Новые админ-подменю — делегируем в сцену если внутри, иначе входим в сцену
bot.action('lessons_manage', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.scene && ctx.scene.current && ctx.scene.current.id === 'manageSchedule') {
    const { handleLessonsMenu } = require('./scenes/helpers/manageScheduleHelpers');
    return handleLessonsMenu(ctx);
  }
  await ctx.scene.enter('manageSchedule');
  // after enter, wizard step1 shows admin menu; schedule next tick show lessons
  // we reply lessons menu as well to satisfy direct click from global menu (if any)
  const { lessonsManageKeyboard } = require('./utils/keyboards');
  await ctx.reply('📚 Управление уроками\n\nВыберите действие:', lessonsManageKeyboard).catch(() => {});
});
bot.action('modes', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { handleShowModes } = require('./scenes/helpers/manageScheduleHelpers');
  // if inside scene, just show modes
  if (ctx.scene && ctx.scene.current && ctx.scene.current.id === 'manageSchedule') {
    return handleShowModes(ctx);
  }
  // outside scene — try to enter then show
  await handleShowModes(ctx).catch(() => {});
});
bot.action('admin_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { adminMainKeyboard } = require('./utils/keyboards');
  await ctx.reply('⚙️ Управление\n\nВыберите действие:', adminMainKeyboard).catch(() => {});
});
bot.action('lessons_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { lessonsManageKeyboard } = require('./utils/keyboards');
  await ctx.reply('📚 Управление уроками\n\nВыберите действие:', lessonsManageKeyboard).catch(() => {});
});
// Alias for schedule_back compatibility
bot.action('schedule_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { lessonsManageKeyboard } = require('./utils/keyboards');
  await ctx.reply('📚 Управление уроками\n\nВыберите действие:', lessonsManageKeyboard).catch(() => {});
});
// Legacy schedule_* aliases — handled inside scene, but keep global fallback to enter scene
bot.action('schedule_add', handleAdminManage);
bot.action('schedule_edit', handleAdminManage);
bot.action('schedule_view', handleAdminManage);
bot.action('schedule_delete', handleAdminManage);
bot.action('edit_bells', handleAdminManage);
bot.action('schedule_classes', handleAdminManage);
bot.action('schedule_tracks', handleAdminManage);
bot.action('schedule_subgroups', handleAdminManage);
bot.action('schedule_stats', handleAdminManage);
bot.action('schedule_toggle_multiprofile', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { handleShowModes } = require('./scenes/helpers/manageScheduleHelpers');
  return handleShowModes(ctx);
});
bot.action('select_profile', handleSelectProfile);
bot.action('profile', handleProfile);
bot.action('profile_edit_class', handleProfileEditClass);
bot.action('profile_edit_track', handleProfileEditTrack);
bot.action('profile_edit_subgroup', handleProfileEditSubgroup);
bot.action('profile_reset', handleProfileReset);

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
