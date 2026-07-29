const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class KassaRegisterModel extends Model {}

KassaRegisterModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  date:         { type: DataTypes.DATE },
  sale_id:      { type: DataTypes.INTEGER, allowNull: true },
  doc_number:   { type: DataTypes.INTEGER, allowNull: true },
  warehouse:    { type: DataTypes.STRING(100), defaultValue: 'Asosiy ombor' },
  payment_type: { type: DataTypes.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
  price_type:   { type: DataTypes.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
  total_sum:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  paid_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  debt_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  discount:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  item_count:   { type: DataTypes.INTEGER, defaultValue: 0 },
  client_id:    { type: DataTypes.INTEGER, allowNull: true },
  client_name:  { type: DataTypes.STRING(200), allowNull: true },
  cashier_id:   { type: DataTypes.INTEGER, allowNull: true },
  cashier_name: { type: DataTypes.STRING(100), allowNull: true },
  status:       { type: DataTypes.ENUM('completed', 'cancelled'), defaultValue: 'completed' },
}, {
  sequelize,
  modelName: 'KassaRegisterModel',
  tableName: 'kassa_register',
  timestamps: true,
  underscored: true,
})

module.exports = KassaRegisterModel
