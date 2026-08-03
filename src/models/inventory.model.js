const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

// Inventarizatsiya hujjati (sanoq varaqasi).
//
// Jarayon: hujjat ochiladi → ombordagi tovarlar shtrix-kod bo'yicha
// skanerlanadi → har skan "topildi" ro'yxatiga tushadi → yakunlanganda
// hisobdagi qoldiq bilan solishtiriladi va farq mahsulot qoldig'iga
// yoziladi.
class InventoryModel extends Model {}

InventoryModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  doc_number: { type: DataTypes.INTEGER, allowNull: false },
  date:       { type: DataTypes.DATE,    allowNull: false, defaultValue: DataTypes.NOW },
  warehouse:  { type: DataTypes.STRING(100), defaultValue: 'Asosiy ombor' },
  comment:    { type: DataTypes.TEXT,    allowNull: true },

  // draft — sanoq davom etmoqda, hali qoldiqqa ta'sir qilmaydi
  // finished — yakunlangan, farqlar mahsulot qoldig'iga yozilgan
  // cancelled — bekor qilingan
  status: {
    type: DataTypes.ENUM('draft', 'finished', 'cancelled'),
    defaultValue: 'draft',
  },

  // Yakunlashda hisoblanadigan yakuniy ko'rsatkichlar
  total_expected: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 }, // hisobdagi
  total_counted:  { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 }, // sanalgan
  total_diff_sum: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 }, // farq summasi (tannarxda)

  created_by:  { type: DataTypes.INTEGER, allowNull: true },
  finished_at: { type: DataTypes.DATE,    allowNull: true },
}, {
  sequelize,
  modelName: 'InventoryModel',
  tableName: 'inventory',
  timestamps: true,
  underscored: true,   // jadval ustunlari created_at / updated_at
});

module.exports = InventoryModel;
