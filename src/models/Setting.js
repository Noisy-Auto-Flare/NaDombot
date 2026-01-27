const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Простая key/value-настройка для бота.
 * Используется, в частности, для режима видимости домашнего задания.
 */
const Setting = sequelize.define('Setting', {
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false,
    comment: 'Ключ настройки'
  },
  value: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Значение настройки'
  }
}, {
  tableName: 'settings',
  timestamps: true
});

module.exports = Setting;

