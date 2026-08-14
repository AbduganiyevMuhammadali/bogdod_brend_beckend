const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Mijoz bilan muloqot tarixi (CRM eslatmalari).
 *
 * Qarz undirishda kim nima degani esdan chiqmasligi uchun: har bir
 * qo'ng'iroq, uchrashuv yoki va'da shu yerga yoziladi.
 *
 * `remind_at` belgilansa — o'sha kuni eslatma sifatida chiqadi.
 */
class ClientNoteModel extends Model {}

ClientNoteModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  client_id: { type: DataTypes.INTEGER, allowNull: false },
  text:      { type: DataTypes.TEXT,    allowNull: false },
  // izoh | qongiroq | uchrashuv | vada
  kind:      { type: DataTypes.STRING(20), defaultValue: 'izoh' },
  // Shu sanada eslatib turilsin (ixtiyoriy)
  remind_at: { type: DataTypes.DATEONLY, allowNull: true },
  done:      { type: DataTypes.BOOLEAN,  defaultValue: false },
  user_id:   { type: DataTypes.INTEGER,  allowNull: true },
  user_name: { type: DataTypes.STRING(100), allowNull: true },
}, {
  sequelize,
  modelName: 'ClientNoteModel',
  tableName: 'client_note',
  timestamps: true,
  underscored: true,
})

module.exports = ClientNoteModel
