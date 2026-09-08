const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель расписания уроков
 * Хранит информацию о расписании на неделю
 */
const Schedule = sequelize.define('Schedule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  lessonNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Номер урока (1-10)'
  },
  subjectName: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Название предмета'
  },
  dayOfWeek: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 0, // Понедельник
      max: 6  // Воскресенье
    },
    comment: 'День недели (0=Понедельник, 6=Воскресенье)'
  },
  room: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Кабинет/аудитория'
  },
  classId: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: '10А',
    comment: 'FK → Class.id, аудитория класса (logical FK, без DB REFERENCES для SQLite ALTER совместимости)'
  },
  trackId: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: null,
    comment: 'FK → Track.id, NULL = общий для всех треков (logical FK)'
  },
  subgroupId: {
    type: DataTypes.STRING(40),
    allowNull: true,
    defaultValue: null,
    comment: 'FK → Subgroup.id, NULL = общий для всех подгрупп (logical FK)'
  }
}, {
  tableName: 'schedules',
  timestamps: true,
  indexes: [
    {
      fields: ['dayOfWeek', 'lessonNumber'],
      name: 'idx_schedules_day_lesson'
    },
    {
      fields: ['classId', 'dayOfWeek', 'lessonNumber', 'trackId', 'subgroupId'],
      unique: true,
      name: 'unique_lesson_per_audience'
    },
    {
      fields: ['classId']
    },
    {
      fields: ['trackId']
    },
    {
      fields: ['subgroupId']
    }
  ]
});

module.exports = Schedule;
