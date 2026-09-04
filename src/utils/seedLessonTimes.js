const LessonTime = require('../models/LessonTime');

const DEFAULT_LESSON_TIMES = [
  { lessonNumber: 1, startTime: '08:30', endTime: '09:15' },
  { lessonNumber: 2, startTime: '09:25', endTime: '10:10' },
  { lessonNumber: 3, startTime: '10:30', endTime: '11:15' },
  { lessonNumber: 4, startTime: '11:35', endTime: '12:20' },
  { lessonNumber: 5, startTime: '12:40', endTime: '13:25' },
  { lessonNumber: 6, startTime: '13:35', endTime: '14:20' },
  { lessonNumber: 7, startTime: '14:30', endTime: '15:15' },
];

async function seedLessonTimes() {
  for (const lt of DEFAULT_LESSON_TIMES) {
    await LessonTime.findOrCreate({
      where: { lessonNumber: lt.lessonNumber },
      defaults: lt,
    });
  }
}

module.exports = { seedLessonTimes, DEFAULT_LESSON_TIMES };
