const { Schedule } = require('../models');
const { getDayOfWeek, getNextDayOfWeek, formatDate, getDayName } = require('./dateUtils');

/**
 * Утилиты для работы с расписанием
 */

/**
 * Получить ближайший будущий урок по указанному предмету
 * @param {string} subjectName - Название предмета
 * @param {Date} fromDate - Дата, от которой ищем (обычно сегодня)
 * @returns {Promise<{schedule: Schedule, date: Date}>} - Расписание и дата урока
 */
async function findNextLesson(subjectName, fromDate = new Date()) {
  // Получаем все уроки по этому предмету
  const schedules = await Schedule.findAll({
    where: {
      subjectName: subjectName
    },
    order: [['dayOfWeek', 'ASC'], ['lessonNumber', 'ASC']]
  });

  if (schedules.length === 0) {
    return null;
  }

  const currentDayOfWeek = getDayOfWeek(fromDate);
  const currentDate = new Date(fromDate);
  currentDate.setHours(0, 0, 0, 0);

  // Ищем ближайший урок на этой неделе
  for (const schedule of schedules) {
    if (schedule.dayOfWeek > currentDayOfWeek) {
      const lessonDate = getNextDayOfWeek(currentDate, schedule.dayOfWeek);
      return {
        schedule: schedule,
        date: lessonDate
      };
    }
  }

  // Если на этой неделе нет, берем первый урок следующей недели
  const firstSchedule = schedules[0];
  const lessonDate = getNextDayOfWeek(currentDate, firstSchedule.dayOfWeek);
  return {
    schedule: firstSchedule,
    date: lessonDate
  };
}

/**
 * Получить расписание на конкретный день недели
 */
async function getScheduleForDay(dayOfWeek) {
  return await Schedule.findAll({
    where: {
      dayOfWeek: dayOfWeek
    },
    order: [['lessonNumber', 'ASC']]
  });
}

/**
 * Получить расписание на всю неделю
 */
async function getWeeklySchedule() {
  const weeklySchedule = {};
  
  for (let day = 0; day < 7; day++) {
    weeklySchedule[day] = await getScheduleForDay(day);
  }
  
  return weeklySchedule;
}

/**
 * Получить домашнее задание на конкретную дату
 */
async function getHomeworkForDate(userId, date) {
  const { Homework } = require('../models');
  const dayOfWeek = getDayOfWeek(date);
  
  // Получаем расписание на этот день
  const schedules = await getScheduleForDay(dayOfWeek);
  
  // Получаем домашние задания
  const homeworks = await Homework.findAll({
    where: {
      userId: userId,
      date: date.toISOString().split('T')[0]
    },
    include: [{
      model: Schedule,
      as: 'schedule'
    }],
    order: [['schedule', 'lessonNumber', 'ASC']]
  });

  return {
    date: date,
    schedules: schedules,
    homeworks: homeworks
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
 * Форматировать расписание для отображения
 */
function formatSchedule(schedules) {
  if (schedules.length === 0) {
    return 'Расписание пусто';
  }

  return schedules
    .map(s => `${s.lessonNumber}. ${s.subjectName}`)
    .join('\n');
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
  homeworks.forEach(hw => {
    homeworkMap.set(hw.scheduleId, hw.content);
  });

  // Выводим уроки с домашним заданием
  schedules.forEach(schedule => {
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
  getWeeklySchedule,
  getHomeworkForDate,
  getHomeworkForWeek,
  formatSchedule,
  formatHomework
};
