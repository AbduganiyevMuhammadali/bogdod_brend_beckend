const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class PushSubscriptionModel extends Model {}

PushSubscriptionModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:   { type: DataTypes.INTEGER, allowNull: true },
  // Web Push (brauzer) uchun:
  endpoint:  { type: DataTypes.STRING(700), allowNull: true, unique: true },
  p256dh:    { type: DataTypes.STRING(200), allowNull: true },
  auth:      { type: DataTypes.STRING(100), allowNull: true },
  // Android/FCM (Capacitor ilova) uchun:
  fcm_token: { type: DataTypes.STRING(400), allowNull: true, unique: true },
}, {
  sequelize,
  modelName: 'PushSubscriptionModel',
  tableName: 'push_subscription',
  timestamps: true,
  underscored: true,
})

module.exports = PushSubscriptionModel
