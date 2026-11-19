const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Filial (do'kon nuqtasi).
 *
 * Barcha biznes ma'lumotlar (tovar, kirim, sotuv, mijoz, kassa ...)
 * `branch_id` orqali bitta filialga bog'lanadi va filiallar bir-biriga
 * aralashmaydi. Birinchi filial (`is_main = 1`) — "Bogdod brend",
 * tizim joriy etilgunga qadar yig'ilgan hamma ma'lumot unga tegishli.
 *
 * Foydalanuvchi:
 *   • `user.branch_id` berilgan  → faqat o'sha filialda ishlaydi
 *   • `user.branch_id = NULL`    → bosh ofis: istalgan filialni tanlab
 *                                  ko'ra oladi (X-Branch-Id sarlavhasi)
 */
class BranchModel extends Model {}

BranchModel.init({
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:    { type: DataTypes.STRING(150), allowNull: false },
  code:    { type: DataTypes.STRING(30),  allowNull: true },
  address: { type: DataTypes.TEXT,        allowNull: true },
  phone:   { type: DataTypes.STRING(30),  allowNull: true },
  // Asosiy filial — bosh ofis foydalanuvchisi uchun standart tanlov
  is_main: { type: DataTypes.BOOLEAN, defaultValue: false },
  active:  { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  sequelize,
  modelName: 'BranchModel',
  tableName: 'branch',
  timestamps: true,
  underscored: true,
})

module.exports = BranchModel
