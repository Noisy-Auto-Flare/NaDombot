const Schedule = require('./Schedule');
const Homework = require('./Homework');
const Setting = require('./Setting');
const LessonTime = require('./LessonTime');
const Class = require('./Class');
const Track = require('./Track');
const Subgroup = require('./Subgroup');
const User = require('./User');
const UserEvent = require('./UserEvent');
const UserProfile = require('./UserProfile');

// Определение связей между моделями (существующие)
Homework.belongsTo(Schedule, {
  foreignKey: 'scheduleId',
  as: 'schedule'
});

Schedule.hasMany(Homework, {
  foreignKey: 'scheduleId',
  as: 'homeworks'
});

// --- V6 Audience: Class / Track / Subgroup / Schedule / UserProfile ---

// Class → Track / Subgroup / Schedule
Track.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
Class.hasMany(Track, { foreignKey: 'classId', as: 'tracks' });

Subgroup.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
Class.hasMany(Subgroup, { foreignKey: 'classId', as: 'subgroups' });

Schedule.belongsTo(Class, { foreignKey: 'classId', as: 'class', constraints: false });
Class.hasMany(Schedule, { foreignKey: 'classId', as: 'schedules', constraints: false });

Schedule.belongsTo(Track, { foreignKey: 'trackId', as: 'track', constraints: false });
Track.hasMany(Schedule, { foreignKey: 'trackId', as: 'schedules', constraints: false });

Schedule.belongsTo(Subgroup, { foreignKey: 'subgroupId', as: 'subgroup', constraints: false });
Subgroup.hasMany(Schedule, { foreignKey: 'subgroupId', as: 'schedules', constraints: false });

// User / UserEvent / UserProfile
UserEvent.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(UserEvent, { foreignKey: 'userId', as: 'events' });

UserProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(UserProfile, { foreignKey: 'userId', as: 'profile' });

UserProfile.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
UserProfile.belongsTo(Track, { foreignKey: 'trackId', as: 'track' });
UserProfile.belongsTo(Subgroup, { foreignKey: 'subgroupId', as: 'subgroup' });

// Денормализованные связи User → аудитория (опционально для быстрого доступа)
User.belongsTo(Class, { foreignKey: 'classId', as: 'classRef' });
User.belongsTo(Track, { foreignKey: 'trackId', as: 'trackRef' });
User.belongsTo(Subgroup, { foreignKey: 'subgroupId', as: 'subgroupRef' });

module.exports = {
  Schedule,
  Homework,
  Setting,
  LessonTime,
  Class,
  Track,
  Subgroup,
  User,
  UserEvent,
  UserProfile
};
