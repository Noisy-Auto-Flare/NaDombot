const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель пользователя Telegram.
 * Хранит сведения из Telegram + локальные счётчики активности.
 * FK-поля аудитории (classId/trackId/subgroupId) — денормализация последнего выбора для быстрого доступа;
 * каноничный профиль — в UserProfile.
 */
const User = sequelize.define(
  'User',
  {
    userId: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      comment: 'Telegram user id'
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Telegram @username'
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Имя пользователя'
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Фамилия пользователя'
    },
    languageCode: {
      type: DataTypes.STRING(5),
      allowNull: true,
      comment: 'Код языка Telegram (ru, en...)'
    },
    isPremium: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Telegram Premium'
    },
    addedToAttachmentMenu: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Добавлен ли бот в attachment menu'
    },
    classId: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: null,
      references: { model: 'classes', key: 'id' },
      comment: 'Выбранный класс (денормализация)'
    },
    trackId: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: null,
      comment: 'Выбранный трек'
    },
    subgroupId: {
      type: DataTypes.STRING(40),
      allowNull: true,
      defaultValue: null,
      comment: 'Выбранная подгруппа'
    },
    firstSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Когда пользователь впервые замечен'
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Последняя активность'
    },
    lastAction: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Последнее действие (command/callback/message)'
    },
    homeworkCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Количество добавленных ДЗ'
    },
    interactionCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Общее количество взаимодействий'
    }
  },
  {
    tableName: 'users',
    timestamps: true,
    indexes: [
      { fields: ['classId'] },
      { fields: ['trackId'] },
      { fields: ['subgroupId'] }
    ]
  }
);

module.exports = User;
