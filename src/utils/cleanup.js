const { Homework } = require('../models');
const { Op } = require('sequelize');

/**
 * Утилиты для очистки старых данных
 */

/**
 * Удалить домашние задания на прошедшие дни (до сегодняшнего дня)
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
      console.log(`✅ Удалено ${deletedCount} старых домашних заданий (до ${todayString})`);
    }

    return deletedCount;
  } catch (error) {
    console.error('❌ Ошибка при очистке старых домашних заданий:', error);
    return 0;
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
  runCleanup
};
