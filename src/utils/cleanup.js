const logger = require('./logger');
const { Homework, UserEvent } = require('../models');
const { Op } = require('sequelize');

/**
 * Утилиты для очистки старых данных
 */

/**
 * Удалить домашние задания на прошедшие дни (до сегодняшнего дня).
 * P3: на старте больше НЕ вызывается (прошлое не удаляем); оставлена для ручного запуска.
 */
async function cleanupOldHomeworks() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayString = today.toISOString().split('T')[0];

    // Удаляем все ДЗ, где дата меньше сегодняшней
    const deletedCount = await Homework.destroy({
      where: {
        date: {
          [Op.lt]: todayString
        }
      }
    });

    if (deletedCount > 0) {
      logger.info(`✅ Удалено ${deletedCount} старых домашних заданий (до ${todayString})`);
    }

    return deletedCount;
  } catch (error) {
    logger.error('❌ Ошибка при очистке старых домашних заданий:', error);
    return 0;
  }
}

/**
 * Срок хранения ленты событий пользователя (P3 §12): 60 дней.
 * Чистятся ТОЛЬКО user_events; строки users (паспорт) живут дальше.
 */
const USER_EVENTS_RETENTION_DAYS = 60;

/**
 * Период in-process джобы ретеншна user_events: раз в сутки, без внешних зависимостей
 * (бот always-on — внешнего cron не нужно).
 */
const USER_EVENTS_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

let userEventsRetentionTimer = null;

/**
 * Удалить события user_events старше USER_EVENTS_RETENTION_DAYS дней.
 * @param {number} [days=USER_EVENTS_RETENTION_DAYS]
 * @returns {Promise<number>} число удалённых строк
 */
async function cleanupOldUserEvents(days = USER_EVENTS_RETENTION_DAYS) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deletedCount = await UserEvent.destroy({
      where: {
        createdAt: {
          [Op.lt]: cutoff
        }
      }
    });

    if (deletedCount > 0) {
      logger.info(`✅ Ретеншн user_events: удалено ${deletedCount} событий старше ${days} дней`);
    }

    return deletedCount;
  } catch (error) {
    logger.error('❌ Ошибка при ретеншне user_events:', error);
    return 0;
  }
}

/**
 * Запустить in-process джобу ретеншна user_events: чистка раз в 24ч.
 * Проверку при старте делает вызывающий (startBot) — здесь только интервал.
 * Повторный вызов — no-op (таймер один).
 * @returns {object|null} таймер интервала или null если уже запущен
 */
function startUserEventsRetentionJob() {
  if (userEventsRetentionTimer) return null;
  userEventsRetentionTimer = setInterval(() => {
    cleanupOldUserEvents().catch((e) => logger.error('❌ Ретеншн user_events (interval):', e.message || e));
  }, USER_EVENTS_RETENTION_INTERVAL_MS);
  // Не держать процесс только ради джобы (тесты/скрипты завершаются сами)
  if (userEventsRetentionTimer && typeof userEventsRetentionTimer.unref === 'function') {
    userEventsRetentionTimer.unref();
  }
  return userEventsRetentionTimer;
}

/**
 * Остановить джобу ретеншна (для тестов).
 */
function stopUserEventsRetentionJob() {
  if (userEventsRetentionTimer) {
    clearInterval(userEventsRetentionTimer);
    userEventsRetentionTimer = null;
  }
}

/**
 * Запустить очистку старых данных
 * Можно вызывать периодически (например, при запуске бота или по расписанию)
 */
async function runCleanup() {
  await cleanupOldHomeworks();
}

module.exports = {
  cleanupOldHomeworks,
  runCleanup,
  cleanupOldUserEvents,
  startUserEventsRetentionJob,
  stopUserEventsRetentionJob,
  USER_EVENTS_RETENTION_DAYS,
  USER_EVENTS_RETENTION_INTERVAL_MS
};
