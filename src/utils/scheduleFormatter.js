const { getDayName } = require('./dateUtils');

/**
 * Группирует массив Schedule по dayOfWeek
 * @param {Array} schedules
 * @returns {Object<number, Array>}
 */
function groupByDay(schedules) {
  const byDay = {};
  schedules.forEach((s) => {
    const day = s.dayOfWeek;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(s);
  });
  return byDay;
}

/**
 * Форматирует сгруппированное расписание в текст
 * @param {Object} grouped - результат groupByDay
 * @param {string} header - заголовок сообщения
 * @param {string} emptyText - текст если пусто (не используется здесь, для совместимости)
 * @returns {string}
 */
function formatWeeklySchedule(grouped, header = '📅 Расписание на неделю:\n\n') {
  let message = header;
  for (let day = 0; day < 7; day++) {
    if (grouped[day]) {
      message += `${getDayName(day)}:\n`;
      grouped[day].forEach((s) => {
        message += `  [ID: ${s.id}] ${s.lessonNumber}. ${s.subjectName}\n`;
      });
      message += '\n';
    }
  }
  return message;
}

/**
 * Форматирует список уроков для выбора при редактировании
 * @param {Object} grouped
 * @returns {string}
 */
function formatScheduleForEdit(grouped) {
  let message = '📅 Выберите урок для редактирования:\n\n';
  message += formatWeeklySchedule(grouped, '');
  message += '\nВведите ID урока для редактирования:';
  return message;
}

module.exports = {
  groupByDay,
  formatWeeklySchedule,
  formatScheduleForEdit,
};
