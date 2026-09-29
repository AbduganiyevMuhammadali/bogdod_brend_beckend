const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

/**
 * Bot ma'lumotlari — SQLite.
 *
 * Bot hech qanday do'kon bazasiga ULANMAYDI. U faqat shu yerda
 * "qaysi Telegram chat qaysi do'konga bog'langan" ma'lumotini saqlaydi
 * va do'kon serveriga HTTP so'rov yuboradi.
 */
const DIR = path.join(__dirname, '..', 'data')
fs.mkdirSync(DIR, { recursive: true })

const db = new Database(path.join(DIR, 'bot.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS shop (
    chat_id     TEXT PRIMARY KEY,
    shop_name   TEXT NOT NULL,
    api_url     TEXT NOT NULL,
    token       TEXT NOT NULL,
    daily       INTEGER NOT NULL DEFAULT 1,
    daily_hour  INTEGER NOT NULL DEFAULT 21,
    morning     INTEGER NOT NULL DEFAULT 1,
    morning_hour INTEGER NOT NULL DEFAULT 9,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used   TEXT
  );
`)

// Eski bazaga ustun qo'shamiz (bir marta)
try { db.exec('ALTER TABLE shop ADD COLUMN daily_hour INTEGER NOT NULL DEFAULT 21') }
catch { /* allaqachon bor */ }
try { db.exec('ALTER TABLE shop ADD COLUMN morning INTEGER NOT NULL DEFAULT 1') }
catch { /* allaqachon bor */ }
try { db.exec('ALTER TABLE shop ADD COLUMN morning_hour INTEGER NOT NULL DEFAULT 9') }
catch { /* allaqachon bor */ }
// Kun yakuni daqiqasi — 22:30 kabi yarim soatlar uchun
try { db.exec('ALTER TABLE shop ADD COLUMN daily_minute INTEGER NOT NULL DEFAULT 0') }
catch { /* allaqachon bor */ }

// Yangi ulangan chat uchun kun yakuni vaqti — do'kon 22:00 da yopiladi,
// hisobot yarim soatdan keyin, kun to'liq yopilgach keladi
const DEFAULT_DAILY_HOUR   = 22
const DEFAULT_DAILY_MINUTE = 30

module.exports = {
  /** Chat qaysi do'konga bog'langan */
  get(chatId) {
    return db.prepare('SELECT * FROM shop WHERE chat_id = ?').get(String(chatId))
  },

  /** Bog'lash (mavjud bo'lsa yangilanadi) */
  link({ chatId, shopName, apiUrl, token }) {
    db.prepare(`
      INSERT INTO shop (chat_id, shop_name, api_url, token, daily_hour, daily_minute)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        shop_name = excluded.shop_name,
        api_url   = excluded.api_url,
        token     = excluded.token
    `).run(String(chatId), shopName, apiUrl, token, DEFAULT_DAILY_HOUR, DEFAULT_DAILY_MINUTE)
  },

  unlink(chatId) {
    db.prepare('DELETE FROM shop WHERE chat_id = ?').run(String(chatId))
  },

  setDaily(chatId, on) {
    db.prepare('UPDATE shop SET daily = ? WHERE chat_id = ?').run(on ? 1 : 0, String(chatId))
  },

  /** Kunlik xabar vaqti: soat (0-23) va daqiqa (0 yoki 30) */
  setHour(chatId, hour, minute = 0) {
    db.prepare('UPDATE shop SET daily_hour = ?, daily_minute = ? WHERE chat_id = ?')
      .run(Number(hour), Number(minute), String(chatId))
  },

  /** Aynan shu vaqtda kunlik xabar kutayotgan chatlar */
  chatsAtTime(hour, minute) {
    return db.prepare('SELECT * FROM shop WHERE daily = 1 AND daily_hour = ? AND daily_minute = ?')
      .all(Number(hour), Number(minute))
  },

  /** Shu soatda ertalabki qarz eslatmasini kutayotgan chatlar */
  morningAtHour(hour) {
    return db.prepare('SELECT * FROM shop WHERE morning = 1 AND morning_hour = ?').all(Number(hour))
  },

  setMorning(chatId, on) {
    db.prepare('UPDATE shop SET morning = ? WHERE chat_id = ?').run(on ? 1 : 0, String(chatId))
  },

  setMorningHour(chatId, hour) {
    db.prepare('UPDATE shop SET morning_hour = ? WHERE chat_id = ?').run(Number(hour), String(chatId))
  },

  touch(chatId) {
    db.prepare("UPDATE shop SET last_used = datetime('now') WHERE chat_id = ?").run(String(chatId))
  },

  /** Kunlik xabar yuboriladigan chatlar */
  dailyChats() {
    return db.prepare('SELECT * FROM shop WHERE daily = 1').all()
  },

  all() {
    return db.prepare('SELECT * FROM shop').all()
  },
}
