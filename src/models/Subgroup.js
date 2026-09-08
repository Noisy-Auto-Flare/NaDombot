const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель подгруппы (бывший Teacher) — деление внутри предмета на подгруппы/учителей.
 * classId = null означает подгруппу для всех классов.
 * @example
 * Subgroup.create({ id: 'belova', subject: 'английский', teacherName: 'Белова', classId: null })
 */
const Subgroup = sequelize.define(
  'Subgroup',
  {
    id: {
      type: DataTypes.STRING(40),
      primaryKey: true,
      allowNull: false,
      comment: 'Идентификатор подгруппы (belova, ivanova)'
    },
    subject: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: 'английский',
      comment: 'Предмет подгруппы'
    },
    teacherName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'ФИО учителя подгруппы'
    },
    classId: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: null,
      references: { model: 'classes', key: 'id' },
      comment: 'FK → Class.id, NULL = для всех классов'
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Активна ли подгруппа'
    }
  },
  {
    tableName: 'subgroups',
    timestamps: true,
    indexes: [
      {
        fields: ['classId']
      },
      {
        fields: ['subject']
      }
    ]
  }
);

module.exports = Subgroup;
