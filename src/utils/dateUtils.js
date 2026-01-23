/**
 * Утилиты для работы с датами
 */

/**
 * Получить название дня недели на русском
 */
function getDayName(dayOfWeek) {
  const days = [
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
    'Воскресенье'
  ];
  return days[dayOfWeek] || 'Неизвестно';
}

/**
 * Получить номер дня недели (0-6) для даты
 */
function getDayOfWeek(date) {
  const day = date.getDay();
  // Преобразуем воскресенье (0) в 6 для соответствия нашей системе
  return day === 0 ? 6 : day - 1;
}

/**
 * Получить дату следующего дня
 */
function getNextDay(date) {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay;
}

/**
 * Получить следующий рабочий день (понедельник-пятница)
 * Если сегодня пятница, вернет понедельник следующей недели
 */
function getNextWorkDay(date) {
  const currentDayOfWeek = getDayOfWeek(date);
  let nextDate = new Date(date);
  
  // Если сегодня пятница (4) или выходной (5-6), переходим на понедельник
  if (currentDayOfWeek >= 4) {
    // Пятница (4) -> +3 дня = понедельник
    // Суббота (5) -> +2 дня = понедельник
    // Воскресенье (6) -> +1 день = понедельник
    const daysToAdd = 7 - currentDayOfWeek;
    nextDate.setDate(nextDate.getDate() + daysToAdd);
  } else {
    // Понедельник-четверг -> следующий день
    nextDate.setDate(nextDate.getDate() + 1);
  }
  
  return nextDate;
}

/**
 * Получить дату следующего указанного дня недели
 */
function getNextDayOfWeek(date, targetDayOfWeek) {
  const currentDayOfWeek = getDayOfWeek(date);
  let daysToAdd = targetDayOfWeek - currentDayOfWeek;
  
  if (daysToAdd <= 0) {
    daysToAdd += 7; // Переходим на следующую неделю
  }
  
  const targetDate = new Date(date);
  targetDate.setDate(targetDate.getDate() + daysToAdd);
  return targetDate;
}

/**
 * Форматировать дату для отображения
 */
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Получить даты на неделю вперед от указанной даты
 */
function getWeekDates(startDate) {
  const dates = [];
  const currentDate = new Date(startDate);
  
  for (let i = 0; i < 7; i++) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
}

/**
 * Проверить, является ли дата сегодняшней
 */
function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * Проверить, является ли дата завтрашней
 */
function isTomorrow(date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString();
}

module.exports = {
  getDayName,
  getDayOfWeek,
  getNextDay,
  getNextWorkDay,
  getNextDayOfWeek,
  formatDate,
  getWeekDates,
  isToday,
  isTomorrow
};
