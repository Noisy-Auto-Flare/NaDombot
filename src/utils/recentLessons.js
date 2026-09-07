const { getMoscowNow, parseHHMM } = require('./moscowTime');
const LessonTimeService = require('../services/LessonTimeService');
const scheduleService = require('../services/scheduleService');
const { getQuickPickThreshold } = require('./quickPickSettings');

/**
 * Получить последние прошедшие уроки сегодня (до 4)
 * Упорядочены от раннего к позднему, нижняя — самый последний перед now.
 * @param {{limit?:number, now?:Date}} options
 * @returns {Promise<Array>} массив Schedule (до limit штук)
 */
async function getRecentLessonRows({ limit = 4, now = new Date() } = {}) {
  const nowMoscow = getMoscowNow(now);
  const nowMinutes = parseHHMM(nowMoscow.hhmm);

  const bellMap = await LessonTimeService.getBellScheduleMap();
  const allRows = await scheduleService.findAll();

  const todayRows = allRows
    .filter((r) => r.dayOfWeek === nowMoscow.dayOfWeek)
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  if (todayRows.length === 0) return [];

  let thresholdMinutes;
  try {
    const thresholdStr = await getQuickPickThreshold();
    thresholdMinutes = parseHHMM(thresholdStr);
  } catch (_e) {
    thresholdMinutes = parseHHMM('16:30');
  }

  if (nowMinutes >= thresholdMinutes) {
    return todayRows;
  }

  const passed = todayRows.filter((row) => {
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
    return todayRows.slice(0, limit);
  }

  if (passed.length > limit) {
    return passed.slice(-limit);
  }

  return passed;
}

module.exports = { getRecentLessonRows };
