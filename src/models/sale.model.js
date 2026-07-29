const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SaleModel extends Model {}

SaleModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  doc_number:   { type: DataTypes.INTEGER },
  date:         { type: DataTypes.DATE },
  warehouse:    { type: DataTypes.STRING(100), defaultValue: 'Asosiy ombor' },
  client_id:    { type: DataTypes.INTEGER,     allowNull: true },
  payment_type: { type: DataTypes.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
  price_type:   { type: DataTypes.ENUM('chakana', 'ulgurji'),                 defaultValue: 'chakana' },
  total_sum:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  discount:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  paid_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  debt_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  cashier_id:   { type: DataTypes.INTEGER, allowNull: true },
  status:       { type: DataTypes.ENUM('draft', 'completed', 'cancelled'), defaultValue: 'completed' },
  comment:      { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  modelName: 'SaleModel',
  tableName: 'sale',
  timestamps: true,
  underscored: true,
})

module.exports = SaleModel
