const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Каноничный профиль аудитории пользователя.
 * Один пользователь → один профиль (PK userId), версия инкрементируется при изменениях.
 */
const UserProfile = sequelize.define(
  'UserProfile',
  {
    userId: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: 'users', key: 'userId' },
      comment: 'FK → User.userId, PK профиля'
    },
    classId: {
      type: DataTypes.STRING(10),
      allowNull: false,
      references: { model: 'classes', key: 'id' },
      comment: 'FK → Class.id'
    },
    trackId: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: null,
      references: { model: 'tracks', key: 'id' },
      comment: 'FK → Track.id, NULL = без специализации'
    },
    subgroupId: {
      type: DataTypes.STRING(40),
      allowNull: true,
      defaultValue: null,
      references: { model: 'subgroups', key: 'id' },
      comment: 'FK → Subgroup.id, NULL = без подгруппы'
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Версия профиля (инкремент при обновлении)'
    }
  },
  {
    tableName: 'user_profiles',
    timestamps: true,
    indexes: [
      { fields: ['classId'] },
      { fields: ['trackId'] },
      { fields: ['subgroupId'] }
    ]
  }
);

module.exports = UserProfile;
