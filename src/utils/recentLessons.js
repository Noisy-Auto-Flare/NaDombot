const { getMoscowNow, parseHHMM } = require('./moscowTime');
const LessonTimeService = require('../services/LessonTimeService');
const scheduleService = require('../services/scheduleService');
const { getQuickPickThreshold } = require('./quickPickSettings');
const { buildAudienceTag } = require('./audience');

/**
 * Получить последние прошедшие уроки сегодня (до 4)
 * Упорядочены от раннего к позднему, нижняя — самый последний перед now.
 * При переданном профиле и включённом флаге multiprofile — фильтрует через
 * isVisibleWithScope (чужой аудитории нет в быстрых кнопках, наблюдатель
 * scope='all' видит все треки); без профиля/флага — как раньше.
 * Логика passed/threshold/limit — без изменений.
 * @param {{limit?:number, now?:Date, profile?:object|null}} options
 * @returns {Promise<Array>} массив Schedule (до limit штук)
 */
async function getRecentLessonRows({ limit = 4, now = new Date(), profile = null } = {}) {
  const nowMoscow = getMoscowNow(now);
  const nowMinutes = parseHHMM(nowMoscow.hhmm);

  const bellMap = await LessonTimeService.getBellScheduleMap();
  const allRows = await scheduleService.findAll();

  const todayRows = allRows
    .filter((r) => r.dayOfWeek === nowMoscow.dayOfWeek)
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  if (todayRows.length === 0) return [];

  // F10: фильтр по аудитории (только при профиле + включённом флаге)
  let visibleRows = todayRows;
  if (profile && profile.classId) {
    let enabled = false;
    try {
      const { isMultiprofileEnabled } = require('./settings');
      enabled = await isMultiprofileEnabled();
    } catch (_e) {
      enabled = false;
    }
    if (enabled) {
      try {
        const { isVisibleWithScope } = require('./audience');
        visibleRows = todayRows.filter((r) => isVisibleWithScope(r, profile, enabled));
      } catch (_e) {
        visibleRows = todayRows;
      }
    }
  }

  if (visibleRows.length === 0) return [];
  const todayRowsFiltered = visibleRows;

  let thresholdMinutes;
  try {
    const thresholdStr = await getQuickPickThreshold();
    thresholdMinutes = parseHHMM(thresholdStr);
  } catch (_e) {
    thresholdMinutes = parseHHMM('16:30');
  }

  if (nowMinutes >= thresholdMinutes) {
    return todayRowsFiltered;
  }

  const passed = todayRowsFiltered.filter((row) => {
    const bell = bellMap.get(row.lessonNumber);
    if (!bell) return false;
    try {
      const startMinutes = parseHHMM(bell.start);
      return nowMinutes >= startMinutes;
    } catch (_e) {
      return false;
    }
  });

  if (passed.length === 0) {
    // До первого урока — показать первые до 4 уроков сегодня чтобы кнопки не были пустыми
    return todayRowsFiltered.slice(0, limit);
  }

  if (passed.length > limit) {
    return passed.slice(-limit);
  }

  return passed;
}

module.exports = { getRecentLessonRows, buildQuickPickLabel };

/**
 * Текст быстрой кнопки урока с тегом аудитории (F10):
 * `📚 Английский [Белова] (3 урок)`; общие уроки — без тега. Чистая функция.
 * @param {object} row - строка расписания
 * @param {object|null} tagCtx - контекст тегов (getTagContext), null → без тега
 * @returns {string}
 */
function buildQuickPickLabel(row, tagCtx) {
  let tag = '';
  try {
    tag = buildAudienceTag(row, tagCtx || {}, tagCtx || {}) || '';
  } catch (_e) {
    tag = '';
  }
  return `📚 ${row.subjectName}${tag ? ` ${tag}` : ''} (${row.lessonNumber} урок)`;
}
