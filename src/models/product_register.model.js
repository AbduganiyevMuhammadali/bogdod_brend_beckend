const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class ProductRegisterModel extends Model {}

ProductRegisterModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  date:         { type: DataTypes.DATE },
  sale_id:          { type: DataTypes.INTEGER, allowNull: true },
  purchase_item_id: { type: DataTypes.INTEGER, allowNull: true },
  doc_number:   { type: DataTypes.INTEGER, allowNull: true },
  warehouse:    { type: DataTypes.STRING(100), defaultValue: 'Asosiy ombor' },
  product_id:   { type: DataTypes.INTEGER, allowNull: true },
  product_name: { type: DataTypes.STRING(300), allowNull: false },
  barcode:      { type: DataTypes.STRING(100), allowNull: true },
  qty:          { type: DataTypes.DECIMAL(10, 3), defaultValue: 0 },
  price:        { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  cost_price:   { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  price_type:   { type: DataTypes.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
  total_sum:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  cashier_id:   { type: DataTypes.INTEGER, allowNull: true },
  cashier_name: { type: DataTypes.STRING(100), allowNull: true },
  status:       { type: DataTypes.ENUM('active', 'reversed'), defaultValue: 'active' },
}, {
  sequelize,
  modelName: 'ProductRegisterModel',
  tableName: 'product_register',
  timestamps: true,
  underscored: true,
})

module.exports = ProductRegisterModel
