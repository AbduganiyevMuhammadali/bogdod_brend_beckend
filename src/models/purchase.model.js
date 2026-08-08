const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class PurchaseModel extends Model {}

PurchaseModel.init({
  id:           { type: DataTypes.INTEGER,      primaryKey: true, autoIncrement: true },
  doc_number:   { type: DataTypes.INTEGER,      allowNull: false },
  date:         { type: DataTypes.DATE,         allowNull: false },
  warehouse:    { type: DataTypes.STRING(100),  defaultValue: 'Asosiy ombor' },
  supplier:     { type: DataTypes.STRING(200),  allowNull: true },
  payment_type: { type: DataTypes.ENUM('Naqd', 'Karta', "O'tkazma", 'Qarz'), defaultValue: 'Naqd' },
  expense:      { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  discount:     { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  exchange_rate:{ type: DataTypes.DECIMAL(12, 2), defaultValue: 11000 },
  comment:      { type: DataTypes.TEXT,         allowNull: true },
  status:       { type: DataTypes.ENUM('draft', 'confirmed', 'cancelled'), defaultValue: 'draft' },
  total_sum:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  total_usd:    { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  paid_sum:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  supplier_id:  { type: DataTypes.INTEGER,      allowNull: true },
  created_by:   { type: DataTypes.INTEGER,      allowNull: true },
  // Yorliqlar oxirgi marta qachon va kim tomonidan chop etilgan
  labels_printed_at: { type: DataTypes.DATE,    allowNull: true },
  labels_printed_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'PurchaseModel',
  tableName: 'purchase',
  timestamps: true,
  paranoid: true,
});

module.exports = PurchaseModel;
