const Schedule = require('./Schedule');
const Homework = require('./Homework');
const Setting = require('./Setting');
const LessonTime = require('./LessonTime');

// Определение связей между моделями
Homework.belongsTo(Schedule, {
  foreignKey: 'scheduleId',
  as: 'schedule'
});

Schedule.hasMany(Homework, {
  foreignKey: 'scheduleId',
  as: 'homeworks'
});

module.exports = {
  Schedule,
  Homework,
  Setting,
  LessonTime
};

