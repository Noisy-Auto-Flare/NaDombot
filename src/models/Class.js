const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель класса (параллели).
 * Хранит идентификатор класса, номер параллели, букву и флаг активности.
 * @example
 * Class.create({ id: '10А', grade: 10, letter: 'А', enabled: true })
 */
const Class = sequelize.define(
  'Class',
  {
    id: {
      type: DataTypes.STRING(10),
      primaryKey: true,
      allowNull: false,
      comment: 'Идентификатор класса, напр. 10А'
    },
    grade: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: { min: 1, max: 11 },
      comment: 'Номер параллели (1-11)'
    },
    letter: {
      type: DataTypes.STRING(2),
      allowNull: true,
      comment: 'Буква класса'
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Активен ли класс для выбора'
    }
  },
  {
    tableName: 'classes',
    timestamps: true
  }
);

module.exports = Class;
