const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SupplierModel extends Model {}

SupplierModel.init({
  // Filial — barcha ma'lumot filialga bo'linadi (db/branchScope.js avtomatik qo'yadi)
  // defaultValue YO'Q: qiymatni db/branchScope.js hook'i joriy filialdan yozadi.
  // Default bo'lsa hook "allaqachon bor" deb o'tkazib yuborardi va hamma
  // yangi yozuv 1-filialga tushardi.
  branch_id: { type: DataTypes.INTEGER, allowNull: false },
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
