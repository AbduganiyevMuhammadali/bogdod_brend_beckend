const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class CashTransactionModel extends Model {}

CashTransactionModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  date:           { type: DataTypes.DATE },
  type:           { type: DataTypes.ENUM('income', 'expense', 'sale', 'refund', 'debt_payment', 'opening') },
  amount:         { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  payment_type:   { type: DataTypes.ENUM('Naqd', 'Karta', "O'tkazma"), defaultValue: 'Naqd' },
  reference_id:   { type: DataTypes.INTEGER, allowNull: true },
  reference_type: { type: DataTypes.STRING(50), allowNull: true },
  client_id:      { type: DataTypes.INTEGER, allowNull: true },
  description:    { type: DataTypes.TEXT, allowNull: true },
  cashier_id:     { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'CashTransactionModel',
  tableName: 'cash_transaction',
  timestamps: true,
  underscored: true,
})

module.exports = CashTransactionModel
