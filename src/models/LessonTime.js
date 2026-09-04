const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель расписания звонков
 * Хранит время начала/окончания каждого урока
 */
const LessonTime = sequelize.define('LessonTime', {
  lessonNumber: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    validate: {
      min: 1,
      max: 7
    }
  },
  startTime: {
    type: DataTypes.STRING(5),
    allowNull: false,
    validate: {
      is: /^([01]\d|2[0-3]):[0-5]\d$/
    }
  },
  endTime: {
    type: DataTypes.STRING(5),
    allowNull: false,
    validate: {
      is: /^([01]\d|2[0-3]):[0-5]\d$/
    }
  }
}, {
  tableName: 'lesson_times',
  timestamps: true,
  validate: {
    endAfterStart() {
      if (this.startTime && this.endTime && this.startTime >= this.endTime) {
        throw new Error('endTime must be after startTime');
      }
    }
  }
});

module.exports = LessonTime;
