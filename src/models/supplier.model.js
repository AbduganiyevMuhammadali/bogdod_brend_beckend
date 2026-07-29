const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SupplierModel extends Model {}

SupplierModel.init({
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code:    { type: DataTypes.STRING(30),  allowNull: true },
  name:    { type: DataTypes.STRING(200), allowNull: false },
  phone:   { type: DataTypes.STRING(30),  allowNull: true },
  address: { type: DataTypes.TEXT,        allowNull: true },
  // negative = biz ularga qarzimiz, positive = ular bizga qarz
  balance: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  comment: { type: DataTypes.TEXT,        allowNull: true },
  active:  { type: DataTypes.BOOLEAN,     defaultValue: true },
}, {
  sequelize,
  modelName: 'SupplierModel',
  tableName: 'supplier',
  timestamps: true,
  underscored: true,
})

module.exports = SupplierModel
