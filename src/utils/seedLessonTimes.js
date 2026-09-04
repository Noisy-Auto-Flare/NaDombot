const LessonTime = require('../models/LessonTime');

const DEFAULT_LESSON_TIMES = [
  { lessonNumber: 1, startTime: '08:30', endTime: '09:15' },
  { lessonNumber: 2, startTime: '09:25', endTime: '10:10' },
  { lessonNumber: 3, startTime: '10:25', endTime: '11:10' },
  { lessonNumber: 4, startTime: '11:20', endTime: '12:05' },
  { lessonNumber: 5, startTime: '12:25', endTime: '13:10' },
  { lessonNumber: 6, startTime: '13:30', endTime: '14:15' },
  { lessonNumber: 7, startTime: '14:25', endTime: '15:10' },
  { lessonNumber: 8, startTime: '15:25', endTime: '16:10' },
  { lessonNumber: 9, startTime: '16:25', endTime: '17:10' },
  { lessonNumber: 10, startTime: '17:25', endTime: '18:10' },
];

async function seedLessonTimes() {
  for (const lt of DEFAULT_LESSON_TIMES) {
    const [row, created] = await LessonTime.findOrCreate({
      where: { lessonNumber: lt.lessonNumber },
      defaults: lt,
    });
    if (!created && (row.startTime !== lt.startTime || row.endTime !== lt.endTime)) {
      await row.update({ startTime: lt.startTime, endTime: lt.endTime });
    }
  }
}

module.exports = { seedLessonTimes, DEFAULT_LESSON_TIMES };
