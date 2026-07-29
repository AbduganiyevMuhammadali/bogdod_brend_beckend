const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class PushSubscriptionModel extends Model {}

PushSubscriptionModel.init({
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:  { type: DataTypes.INTEGER, allowNull: true },
  endpoint: { type: DataTypes.STRING(700), allowNull: false, unique: true },
  p256dh:   { type: DataTypes.STRING(200), allowNull: false },
  auth:     { type: DataTypes.STRING(100), allowNull: false },
}, {
  sequelize,
  modelName: 'PushSubscriptionModel',
  tableName: 'push_subscription',
  timestamps: true,
  underscored: true,
})

module.exports = PushSubscriptionModel
