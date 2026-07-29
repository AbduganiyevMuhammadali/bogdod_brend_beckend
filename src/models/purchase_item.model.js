const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class PurchaseItemModel extends Model {}

PurchaseItemModel.init({
  id:                   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  purchase_id:          { type: DataTypes.INTEGER, allowNull: false },
  product_id:           { type: DataTypes.INTEGER, allowNull: true  },
  barcode:              { type: DataTypes.STRING(100), allowNull: true },
  product_name:         { type: DataTypes.STRING(200), allowNull: false },
  stock_qty:            { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  sold_qty:             { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },

  pkg_qty:              { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  unit_qty:             { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  units_per_pkg:        { type: DataTypes.DECIMAL(10, 3), defaultValue: 1 },

  pkg_price:            { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  unit_price:           { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  cost_price:           { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },

  total_sum:            { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  total_cost_sum:       { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },

  retail_markup_pct:    { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
  wholesale_markup_pct: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },

  retail_price_sum:     { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  retail_price_usd:     { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  wholesale_price_sum:  { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  wholesale_price_usd:  { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
}, {
  sequelize,
  modelName: 'PurchaseItemModel',
  tableName: 'purchase_item',
  timestamps: true,
  paranoid: false,
});

module.exports = PurchaseItemModel;
