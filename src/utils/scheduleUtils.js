const { Op } = require('sequelize');
const { Schedule } = require('../models');
const { getDayOfWeek, getNextDayOfWeek } = require('./dateUtils');
const { getMoscowDayOfWeek } = require('./moscowTime');
const { getHomeworkVisibility, HOMEWORK_VISIBILITY_SHARED } = require('./settings');
const { subjectsMatch } = require('./subjectNormalizer');
const { isVisible } = require('./audience');

/**
 * Утилиты для работы с расписанием
 */

/**
 * Получить ближайший будущий урок по указанному предмету (case-insensitive, Cyrillic-safe)
 * @param {string} subjectName - Название предмета
 * @param {Date} fromDate - Дата, от которой ищем (обычно сегодня)
 * @param {object|null} userProfile - опционально профиль аудитории
 * @returns {Promise<{schedule: Schedule, date: Date}|null>} - Расписание и дата урока
 */
async function findNextLesson(subjectName, fromDate = new Date(), userProfile = null) {
  // Fetch all ordered then filter via subjectsMatch (normalize + firstToken fallback)
  const all = await Schedule.findAll({
    order: [
      ['dayOfWeek', 'ASC'],
      ['lessonNumber', 'ASC'],
    ],
  });

  let schedules = all.filter((s) => subjectsMatch(s.subjectName, subjectName));

  if (userProfile) {
    let enabled = false;
    try {
      const { isMultiprofileEnabled } = require('./settings');
      enabled = await isMultiprofileEnabled();
    } catch (_e) {
      enabled = false;
    }
    if (enabled) {
      schedules = schedules.filter((s) => isVisible(s, userProfile));
    }
  }

  if (schedules.length === 0) {
    return null;
  }

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
 * @param {number} dayOfWeek
 * @param {object|null} userProfile - профиль аудитории (classId/trackId/subgroupId)
 * @returns {Promise<Array>}
 */
async function getScheduleForDay(dayOfWeek, userProfile = null) {
  let enabled = false;
  try {
    const { isMultiprofileEnabled } = require('./settings');
    enabled = await isMultiprofileEnabled();
  } catch (_e) {
    enabled = false;
  }
  if (!enabled || !userProfile || !userProfile.classId) {
    return Schedule.findAll({
      where: {
        dayOfWeek: dayOfWeek,
      },
      order: [['lessonNumber', 'ASC']],
    });
  }
  const { normalizeAudience, getAudienceWhere } = require('./audience');
  const normalized = normalizeAudience(userProfile);
  if (!normalized) {
    return Schedule.findAll({
      where: { dayOfWeek },
      order: [['lessonNumber', 'ASC']],
    });
  }
  const audienceWhere = getAudienceWhere(normalized);
  const where = { dayOfWeek, ...audienceWhere };
  return Schedule.findAll({
    where,
    order: [['lessonNumber', 'ASC']],
  });
}

/**
 * Получить домашнее задание на конкретную дату.
 * Если режим personal — показываем ДЗ только текущего пользователя.
 * Если режим shared  — показываем ДЗ всех пользователей.
 * С фильтром аудитории через UserProfile → getScheduleForDay.
 */
async function getHomeworkForDate(userId, date) {
  const { Homework, UserProfile } = require('../models');
  const dayOfWeek = getDayOfWeek(date);

  // Резолвим профиль пользователя
  let userProfile = null;
  if (userId != null) {
    try {
      userProfile = await UserProfile.findByPk(userId);
      if (!userProfile) {
        // try string version
        userProfile = await UserProfile.findByPk(String(userId));
      }
    } catch (_e) {
      userProfile = null;
    }
  }

  // Получаем расписание на этот день с учётом аудитории
  const schedules = await getScheduleForDay(dayOfWeek, userProfile);

  const visibility = await getHomeworkVisibility();
  const dateStr = date.toISOString().split('T')[0];

  const scheduleIds = schedules.map((s) => s.id);

  if (scheduleIds.length === 0) {
    return {
      date,
      schedules,
      homeworks: [],
    };
  }

  const where = {
    date: dateStr,
    scheduleId: { [Op.in]: scheduleIds },
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
