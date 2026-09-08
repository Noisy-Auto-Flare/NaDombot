const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Лог событий пользователя — callback / message / command.
 * Используется для аналитики и отладки поведения.
 */
const UserEvent = sequelize.define(
  'UserEvent',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: 'users', key: 'userId' },
      comment: 'FK → User.userId'
    },
    type: {
      type: DataTypes.ENUM('callback', 'message', 'command'),
      allowNull: false,
      comment: 'Тип события'
    },
    payload: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Короткий идентификатор действия (команда, data callback)'
    },
    meta: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Дополнительные данные события (JSON)'
    }
  },
  {
    tableName: 'user_events',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'createdAt'],
        name: 'idx_user_events_user_created'
      },
      {
        fields: ['type']
      }
    ]
  }
);

module.exports = UserEvent;
