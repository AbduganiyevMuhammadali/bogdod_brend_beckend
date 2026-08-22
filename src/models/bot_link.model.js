const { DataTypes, Model } = require('sequelize')
const sequelize = require('../db/db-sequelize')

/**
 * Telegram bot bilan bog'lanish.
 *
 * Har bir do'kon o'z serverida ishlaydi, bot esa bitta va umumiy.
 * Bog'lanish shu jadval orqali: do'kon kod yasaydi, bot uni tekshirib
 * uzoq muddatli token oladi va shundan keyin `chat_id` shu do'konga
 * bog'lanadi.
 *
 * `token` — faqat O'QISH huquqiga ega (bot hech narsa o'zgartira olmaydi).
 */
class BotLinkModel extends Model {}

BotLinkModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // Telegram chat id (bog'langandan keyin to'ladi)
  chat_id:   { type: DataTypes.STRING(40), allowNull: true },
  chat_name: { type: DataTypes.STRING(200), allowNull: true },
  // Telegram username (@sиз) — kartochkada kim ulanganini ko'rsatish uchun
  chat_username: { type: DataTypes.STRING(100), allowNull: true },
  // Kod olgan xodim (dastur foydalanuvchisi)
  created_by_name: { type: DataTypes.STRING(100), allowNull: true },
  // 6 xonali bir martalik kod
  pair_code: { type: DataTypes.STRING(10), allowNull: true },
  code_expires_at: { type: DataTypes.DATE, allowNull: true },
  // Bog'langandan keyin beriladigan doimiy token
  token:     { type: DataTypes.STRING(120), allowNull: true },
  active:    { type: DataTypes.BOOLEAN, defaultValue: true },
  // Kunlik avtomatik xabar kerakmi
  daily:     { type: DataTypes.BOOLEAN, defaultValue: true },
  // Kunlik xabar soati (0-23). Har chat o'zi tanlaydi — ilgari vaqt
  // faqat serverdagi .env da edi va do'kon egasi uni o'zgartira olmasdi.
  daily_hour: { type: DataTypes.INTEGER, defaultValue: 21 },
  last_seen: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'BotLinkModel',
  tableName: 'bot_link',
  timestamps: true,
  underscored: true,
})

module.exports = BotLinkModel
