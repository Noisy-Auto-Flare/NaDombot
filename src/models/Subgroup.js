const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Модель подгруппы v2 (P1): независимое разбиение класса, не привязанное
 * жёстко к предмету. `division` — название разбиения («Английский язык»);
 * `subject` опционален: задан → валидация как раньше, `null` → подгруппа
 * годится для любого предмета (кейс «черчение/информатика в одном слоте»).
 * Фамилии меняются через `teacher` при стабильном `id` (расписание не трогаем);
 * исчезнувшие группы — `active=false` (не удаляем: история расписаний цела).
 * classId = null означает подгруппу для всех классов.
 * @example
 * Subgroup.create({ id: 'belova', division: 'Английский язык', name: 'Белова', teacher: 'Белова И.В.', subject: 'английский', classId: null })
 */
const Subgroup = sequelize.define(
  'Subgroup',
  {
    id: {
      type: DataTypes.STRING(40),
      primaryKey: true,
      allowNull: false,
       comment: 'Идентификатор подгруппы (belova, ferfarova)'
    },
    division: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Название разбиения, напр. Английский язык'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Короткое имя подгруппы, напр. Белова'
    },
    teacher: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
      comment: 'ФИО учителя подгруппы (правка одной строкой при стабильном id)'
    },
    subject: {
      type: DataTypes.STRING(40),
      allowNull: true,
      defaultValue: null,
      comment: 'Предмет подгруппы; NULL = годится для любого предмета',
      validate: {
        /**
         * Валидация subject — только если задан (non-null/non-empty).
         * @param {unknown} value
         */
        subjectIfPresent(value) {
          if (value == null) return;
          if (typeof value !== 'string' || !value.trim()) {
            throw new Error('Предмет подгруппы должен быть непустой строкой или NULL');
          }
        }
      }
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
      },
      {
        fields: ['division']
      }
    ]
  }
);

module.exports = Subgroup;
