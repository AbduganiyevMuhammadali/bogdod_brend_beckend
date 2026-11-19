const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

class SaleModel extends Model {}

SaleModel.init({
  // Filial — barcha ma'lumot filialga bo'linadi (db/branchScope.js avtomatik qo'yadi)
  // defaultValue YO'Q: qiymatni db/branchScope.js hook'i joriy filialdan yozadi.
  // Default bo'lsa hook "allaqachon bor" deb o'tkazib yuborardi va hamma
  // yangi yozuv 1-filialga tushardi.
  branch_id: { type: DataTypes.INTEGER, allowNull: false },
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
  // Shu sotuv qarzidan qancha TO'LANGAN. Qarz to'lovlari mijoz kesimida
  // qabul qilinadi va eng eski sotuvdan boshlab taqsimlanadi
  // (utils/clientDebt.utils.js). Qolgan qarz = debt_sum - debt_paid.
  debt_paid:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Qisman qaytarishlar yig'indisi (chegirma hisobga olingan holda)
  returned_sum: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Qarzni to'lash muddati — har sotuvga alohida belgilanadi
  due_date:     { type: DataTypes.DATEONLY, allowNull: true },
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
