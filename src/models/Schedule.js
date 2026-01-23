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
    comment: 'Номер урока (1-7)'
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
  }
}, {
  tableName: 'schedules',
  timestamps: true,
  indexes: [
    {
      fields: ['dayOfWeek', 'lessonNumber'],
      unique: true,
      name: 'unique_lesson_per_day'
    }
  ]
});

module.exports = Schedule;
