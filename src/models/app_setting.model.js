const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class AppSettingModel extends Model {}

AppSettingModel.init({
  id:    { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key:   { type: DataTypes.STRING(100), allowNull: false, unique: true },
  value: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  modelName: 'AppSettingModel',
  tableName: 'app_setting',
  timestamps: true,
  underscored: true,
})

module.exports = AppSettingModel
