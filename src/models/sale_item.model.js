const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SaleItemModel extends Model {}

SaleItemModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id:          { type: DataTypes.INTEGER, allowNull: false },
  product_id:       { type: DataTypes.INTEGER, allowNull: true },
  purchase_item_id: { type: DataTypes.INTEGER, allowNull: true },
  barcode:          { type: DataTypes.STRING(100), allowNull: true },
  product_name:     { type: DataTypes.STRING(300), allowNull: false },
  qty:              { type: DataTypes.DECIMAL(10, 3), defaultValue: 0 },
  // Shu satrdan qancha qaytarilgan. Qisman qaytarishda ishlatiladi:
  // bir tovarni bir necha marta (qismlab) qaytarish mumkin.
  returned_qty: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  price:            { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  cost_price:       { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  total_sum:        { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  price_type:       { type: DataTypes.ENUM('chakana', 'ulgurji'), defaultValue: 'chakana' },
}, {
  sequelize,
  modelName: 'SaleItemModel',
  tableName: 'sale_item',
  timestamps: true,
  underscored: true,
})

module.exports = SaleItemModel
