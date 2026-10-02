const { Op } = require('sequelize');
const { Schedule } = require('../models');
const { getNextDayOfWeek } = require('./dateUtils');
const { getMoscowDayOfWeek, getCalendarDayOfWeek, getMoscowToday } = require('./moscowTime');
const { getHomeworkVisibility, HOMEWORK_VISIBILITY_SHARED } = require('./settings');
const { subjectsMatch } = require('./subjectNormalizer');
const { isVisibleWithScope, buildAudienceTag } = require('./audience');
const logger = require('./logger');

/**
 * Лимит длины одного сообщения Telegram для чанкинга merged-view (P2: 4000, не 4096).
 */
const MESSAGE_CHUNK_LIMIT = 4000;

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
    // P2 scope='all'/master OFF: фильтр только по классу (наблюдатель видит все варианты)
    schedules = schedules.filter((s) => isVisibleWithScope(s, userProfile, enabled));
  }

  if (schedules.length === 0) {
    return null;
  }

  // fromDate — instant «сейчас»: московский день МОМЕНТА (см. правило в moscowTime.js)
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
  // date — КАЛЕНДАРНАЯ дата: будний день её собственных Y-M-D (не дня instant-момента)
  const dayOfWeek = getCalendarDayOfWeek(date);

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
  // Строка даты из тех же локальных Y-M-D, что и будний день выше (инвариант заголовка)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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
async function getHomeworkForWeek(userId, startDate) {
  const { getWeekDates } = require('./dateUtils');
  // База недели — московская календарная дата, не instant «сейчас»
  const base = startDate || getMoscowToday();
  const weekDates = getWeekDates(base);
  const weekHomework = [];

  for (const date of weekDates) {
    const dayData = await getHomeworkForDate(userId, date);
    weekHomework.push(dayData);
  }

  return weekHomework;
}

/**
 * Сгруппировать строки домашки по scheduleId с дедупом одинаковых текстов (P2 §4a).
 * Дубли одного урока: уникальные тексты (trim) в порядке updatedAt, join — на показе.
 * @param {Array} homeworks - строки Homework (scheduleId, content, updatedAt)
 * @returns {Map<number, Array<string>>} scheduleId → уникальные тексты
 */
function mergeHomeworkBySchedule(homeworks) {
  const bySchedule = new Map();
  const sorted = [...(homeworks || [])].sort((a, b) => {
    const ta = a && a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b && b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return ta - tb;
  });
  for (const hw of sorted) {
    const text = hw && hw.content != null ? String(hw.content).trim() : '';
    if (!text) continue;
    if (!bySchedule.has(hw.scheduleId)) bySchedule.set(hw.scheduleId, []);
    const list = bySchedule.get(hw.scheduleId);
    if (!list.includes(text)) list.push(text);
  }
  logger.debug(
    `merge: homeworks=${(homeworks || []).length} schedules=${bySchedule.size} texts=${[...bySchedule.values()].reduce((n, l) => n + l.length, 0)}`
  );
  return bySchedule;
}

/**
 * Загрузить контекст тегов для merged-рендера: шаблон из audience.json (через БД,
 * записано лоадером; TAG_TEMPLATE из ENV не используем) + имена треков/подгрупп.
 * @returns {Promise<{template:string, showClass:boolean, maxSegments:number, trackNames:Map, subgroupNames:Map}>}
 */
async function getTagContext() {
  let tags = null;
  try {
    const { getTagsConfig } = require('./audienceLoader');
    tags = await getTagsConfig();
  } catch (_e) {
    tags = null;
  }
  const template = (tags && tags.template) || '{track} · {subgroup}';
  const showClass = !!(tags && tags.showClass);
  const maxSegments = (tags && tags.maxSegments) || 4;
  const trackNames = new Map();
  const subgroupNames = new Map();
  try {
    const { Track, Subgroup } = require('../models');
    const tracks = await Track.findAll({ raw: true });
    for (const t of tracks || []) trackNames.set(t.id, t.name);
    const subs = await Subgroup.findAll({ raw: true });
    for (const s of subs || []) subgroupNames.set(s.id, { name: s.name || null, teacher: s.teacher || null });
  } catch (_e) {
    // fallback: теги построятся по голым id
  }
  return { template, showClass, maxSegments, trackNames, subgroupNames };
}

/**
 * Merged-рендер домашки на дату (P2 §4, display-time merge).
 * - Дубли одного scheduleId: join уникальных текстов через "\n\n", без тегов.
 * - Варианты аудиторий (разные scheduleId): соседние строки, каждая с обязательным
 *   тегом по tags.template (дефолт "[Тех · Белова]").
 * Чистая синхронная функция; tagCtx опционален (null → теги по голым id).
 * @param {{date: Date, schedules: Array, homeworks: Array}} homeworkData
 * @param {{template:string, showClass:boolean, maxSegments:number, trackNames:Map, subgroupNames:Map}|null} [tagCtx]
 * @returns {string}
 */
function formatHomeworkMerged(homeworkData, tagCtx = null) {
  const { date, schedules, homeworks } = homeworkData;
  const { formatDate, getDayName } = require('./dateUtils');

  // Заголовок — календарный день тех же Y-M-D даты (инвариант с расписанием и строками ДЗ)
  const dayOfWeek = getCalendarDayOfWeek(date);
  let result = `📅 ${getDayName(dayOfWeek)}, ${formatDate(date)}\n\n`;

  if (!schedules || schedules.length === 0) {
    result += 'Расписание пусто\n';
    return result;
  }

  const merged = mergeHomeworkBySchedule(homeworks);
  const ordered = [...schedules].sort((a, b) => {
    if (a.lessonNumber !== b.lessonNumber) return a.lessonNumber - b.lessonNumber;
    return (a.id || 0) - (b.id || 0);
  });

  for (const schedule of ordered) {
    // Кабинеты в списках ДЗ не показываем (только в «текущем уроке»);
    // варианты различаются тегами аудитории.
    const tag = buildAudienceTag(schedule, tagCtx || {}, tagCtx || {});
    const tagSuffix = tag ? ` ${tag}` : '';
    result += `${schedule.lessonNumber}. ${schedule.subjectName}${tagSuffix}\n`;
    const texts = merged.get(schedule.id);
    if (texts && texts.length > 0) {
      result += texts.map((t) => `   📝 ${t}`).join('\n\n') + '\n\n';
    } else {
      result += '   ✅ Нет домашнего задания\n\n';
    }
  }

  return result;
}

/**
 * Форматировать домашнее задание для отображения (merged-view; P2 §4).
 * При выключенном флаге это и есть поведение OFF (тот же код, что scope all).
 */
function formatHomework(homeworkData, tagCtx = null) {
  return formatHomeworkMerged(homeworkData, tagCtx);
}

/**
 * Разбить длинный текст на чанки ≤ limit по границам строк (P2: лимит 4000).
 * @param {string} text
 * @param {number} [limit=4000]
 * @returns {Array<string>}
 */
function splitMessageChunks(text, limit = MESSAGE_CHUNK_LIMIT) {
  const src = String(text == null ? '' : text);
  if (src.length <= limit) return [src];
  const lines = src.split('\n');
  const parts = [];
  let current = '';
  const pushLine = (line) => {
    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > limit) {
      if (current) parts.push(current);
      current = line;
    } else {
      current = candidate;
    }
  };
  for (const line of lines) {
    // строка длиннее лимита — режем на куски, каждый идёт через обычный аккумулятор
    if (line.length > limit) {
      for (let i = 0; i < line.length; i += limit) {
        pushLine(line.slice(i, i + limit));
      }
      continue;
    }
    pushLine(line);
  }
  if (current) parts.push(current);
  return parts.length ? parts : [''];
}

module.exports = {
  findNextLesson,
  getScheduleForDay,
  getHomeworkForDate,
  getHomeworkForWeek,
  formatHomework,
  formatHomeworkMerged,
  mergeHomeworkBySchedule,
  getTagContext,
  splitMessageChunks,
  MESSAGE_CHUNK_LIMIT,
};
