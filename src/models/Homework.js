const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель домашнего задания
 * Хранит информацию о домашних заданиях пользователей
 */
const Homework = sequelize.define('Homework', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: 'Telegram ID пользователя'
  },
  scheduleId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'schedules',
      key: 'id'
    },
    comment: 'ID урока из расписания'
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Дата урока, к которому относится домашнее задание'
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Текст домашнего задания'
  }
}, {
  tableName: 'homeworks',
  timestamps: true,
  indexes: [
    {
      fields: ['userId', 'date', 'scheduleId']
    },
    {
      fields: ['date']
    }
  ]
});

module.exports = Homework;
