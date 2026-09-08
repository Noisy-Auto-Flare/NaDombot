const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель профиля/направления внутри класса.
 * Привязана к конкретному классу (grade scope).
 * Пара (classId, id) уникальна; id — короткий код трека.
 * @example
 * Track.create({ id: 'tech', classId: '10А', name: 'Тех. профиль', isCommon: false })
 */
const Track = sequelize.define(
  'Track',
  {
    id: {
      type: DataTypes.STRING(20),
      primaryKey: true,
      allowNull: false,
      comment: 'Код трека внутри класса (tech, soc и т.п.)'
    },
    classId: {
      type: DataTypes.STRING(10),
      allowNull: false,
      references: { model: 'classes', key: 'id' },
      comment: 'FK → Class.id'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Человекочитаемое название профиля'
    },
    isCommon: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Общий трек для всех (isCommon=true → без фильтрации)'
    }
  },
  {
    tableName: 'tracks',
    timestamps: true,
    indexes: [
      {
        fields: ['classId', 'id'],
        unique: true,
        name: 'unique_track_per_class'
      },
      {
        fields: ['classId']
      }
    ]
  }
);

module.exports = Track;
