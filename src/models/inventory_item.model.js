const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

// Inventarizatsiya satri — bitta mahsulot bo'yicha sanoq natijasi.
//
// Hujjat ochilganda ombordagi barcha mahsulot uchun bittadan satr
// yaratiladi (expected_qty = hisobdagi qoldiq, counted_qty = 0).
// Skanerlash counted_qty ni oshiradi.
//
// Holat counted_qty va expected_qty nisbatidan kelib chiqadi:
//   counted = 0            → topilmadi
//   counted = expected     → topildi
//   counted > expected     → ortiqcha
//   0 < counted < expected → kam topildi (topilmadi guruhida ko'rsatiladi)
class InventoryItemModel extends Model {}

InventoryItemModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  inventory_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id:   { type: DataTypes.INTEGER, allowNull: true },

  // Mahsulot o'chirilsa ham hujjat o'qilishi uchun nusxa saqlanadi
  product_name: { type: DataTypes.STRING(200), allowNull: false },
  barcode:      { type: DataTypes.STRING(100), allowNull: true },

  expected_qty: { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  counted_qty:  { type: DataTypes.DECIMAL(15, 3), defaultValue: 0 },
  cost_price:   { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },

  // Hujjatga qo'lda qo'shilgan (bazada yo'q, skanerdan kelgan) tovar
  is_extra:  { type: DataTypes.BOOLEAN, defaultValue: false },
  scanned_at:{ type: DataTypes.DATE,    allowNull: true },
}, {
  sequelize,
  modelName: 'InventoryItemModel',
  tableName: 'inventory_item',
  timestamps: true,
  underscored: true,   // jadval ustunlari created_at / updated_at
});

module.exports = InventoryItemModel;
