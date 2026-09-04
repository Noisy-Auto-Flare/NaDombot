const { Schedule } = require('../models');
const { getDayOfWeek, getNextDayOfWeek } = require('./dateUtils');
const { getMoscowDayOfWeek } = require('./moscowTime');
const { getHomeworkVisibility, HOMEWORK_VISIBILITY_SHARED } = require('./settings');
const { subjectsMatch } = require('./subjectNormalizer');

/**
 * Утилиты для работы с расписанием
 */

/**
 * Получить ближайший будущий урок по указанному предмету (case-insensitive, Cyrillic-safe)
 * @param {string} subjectName - Название предмета
 * @param {Date} fromDate - Дата, от которой ищем (обычно сегодня)
 * @returns {Promise<{schedule: Schedule, date: Date}>} - Расписание и дата урока
 */
async function findNextLesson(subjectName, fromDate = new Date()) {
  // Fetch all ordered then filter via subjectsMatch (normalize + firstToken fallback)
  const all = await Schedule.findAll({
    order: [
      ['dayOfWeek', 'ASC'],
      ['lessonNumber', 'ASC'],
    ],
  });

  const schedules = all.filter((s) => subjectsMatch(s.subjectName, subjectName));

  if (schedules.length === 0) {
    return null;
  }

  // Use Moscow day for correct timezone on server (host may be UTC)
  // getMoscowDayOfWeek handles Intl Europe/Moscow; getDayOfWeek uses local TZ
  // We prefer Moscow when fromDate is close to now, but for deterministic tests
  // we need stable mapping: use getMoscowDayOfWeek if fromDate within 24h of now?
  // Simpler: use getMoscowDayOfWeek for all, since it is timezone-safe.
  const currentDayOfWeek = getMoscowDayOfWeek(fromDate);
  const currentDate = new Date(fromDate);
  currentDate.setHours(0, 0, 0, 0);

  // Ищем ближайший урок на этой неделе (> today)
  for (const schedule of schedules) {
    if (schedule.dayOfWeek > currentDayOfWeek) {
      const lessonDate = getNextDayOfWeek(currentDate, schedule.dayOfWeek);
      return {
        schedule: schedule,
        date: lessonDate,
      };
    }
  }

  // Если на этой неделе нет, берем первый урок следующей недели
  const firstSchedule = schedules[0];
  const lessonDate = getNextDayOfWeek(currentDate, firstSchedule.dayOfWeek);
  return {
    schedule: firstSchedule,
    date: lessonDate,
  };
}

/**
 * Получить расписание на конкретный день недели
 */
async function getScheduleForDay(dayOfWeek) {
  return await Schedule.findAll({
    where: {
      dayOfWeek: dayOfWeek,
    },
    order: [['lessonNumber', 'ASC']],
  });
}

/**
 * Получить домашнее задание на конкретную дату.
 * Если режим personal — показываем ДЗ только текущего пользователя.
 * Если режим shared  — показываем ДЗ всех пользователей.
 */
async function getHomeworkForDate(userId, date) {
  const { Homework } = require('../models');
  const dayOfWeek = getDayOfWeek(date);

  // Получаем расписание на этот день
  const schedules = await getScheduleForDay(dayOfWeek);

  const visibility = await getHomeworkVisibility();
  const where = {
    date: date.toISOString().split('T')[0],
  };

  // В личном режиме фильтруем по userId, в общем — нет
  if (visibility !== HOMEWORK_VISIBILITY_SHARED) {
    where.userId = userId;
  }

  const homeworks = await Homework.findAll({
    where,
    include: [
      {
        model: Schedule,
        as: 'schedule',
      },
    ],
    order: [['schedule', 'lessonNumber', 'ASC']],
  });

  return {
    date,
    schedules,
    homeworks,
  };
}

/**
 * Получить домашнее задание на неделю
 */
async function getHomeworkForWeek(userId, startDate = new Date()) {
  const { getWeekDates } = require('./dateUtils');
  const weekDates = getWeekDates(startDate);
  const weekHomework = [];

  for (const date of weekDates) {
    const dayData = await getHomeworkForDate(userId, date);
    weekHomework.push(dayData);
  }

  return weekHomework;
}

/**
 * Форматировать домашнее задание для отображения
 */
function formatHomework(homeworkData) {
  const { date, schedules, homeworks } = homeworkData;
  const { formatDate, getDayName } = require('./dateUtils');

  const dayOfWeek = getDayOfWeek(date);
  let result = `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n\n`;

  if (schedules.length === 0) {
    result += 'Расписание пусто\n';
    return result;
  }

  // Создаем мапу домашних заданий по scheduleId
  const homeworkMap = new Map();
  homeworks.forEach((hw) => {
    homeworkMap.set(hw.scheduleId, hw.content);
  });

  // Выводим уроки с домашним заданием
  schedules.forEach((schedule) => {
    const homework = homeworkMap.get(schedule.id);
    if (homework) {
      result += `${schedule.lessonNumber}. ${schedule.subjectName}\n`;
      result += `   📝 ${homework}\n\n`;
    } else {
      result += `${schedule.lessonNumber}. ${schedule.subjectName}\n`;
      result += `   ✅ Нет домашнего задания\n\n`;
    }
  });

  return result;
}

module.exports = {
  findNextLesson,
  getScheduleForDay,
  getHomeworkForDate,
  getHomeworkForWeek,
  formatHomework,
};
