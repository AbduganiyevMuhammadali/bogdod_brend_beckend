// Sana filtrlari uchun yagona joy.
//
// MUAMMO: `new Date('2026-08-06')` — JS uni UTC yarim tuni deb talqin
// qiladi, ya'ni Toshkent vaqti bilan 06.08 soat 05:00. `date_to` esa
// `new Date('2026-08-06T23:59:59')` — bu mahalliy vaqt. Natijada oraliq
// nomutanosib bo'lib qolardi: kun 05:00 da boshlanib 23:59 da tugardi.
// Tunda va erta tongda qilingan savdolar filtrga tushmay qolardi.
//
// Endi ikkalasi ham mahalliy kun chegarasi bo'yicha olinadi:
// 00:00:00.000 dan 23:59:59.999 gacha.

/** "2026-08-06" → o'sha kunning mahalliy 00:00:00.000 lahzasi */
function startOfDay(v) {
  const d = parseDay(v)
  if (!d) return null
  d.setHours(0, 0, 0, 0)
  return d
}

/** "2026-08-06" → o'sha kunning mahalliy 23:59:59.999 lahzasi */
function endOfDay(v) {
  const d = parseDay(v)
  if (!d) return null
  d.setHours(23, 59, 59, 999)
  return d
}

// "2026-08-06" yoki "2026-08-06T10:15" — kun qismini mahalliy zonada olamiz.
// Faqat sanani `new Date()` ga bersak UTC deb o'qiladi, shuning uchun
// yil/oy/kunni qo'lda ajratamiz.
function parseDay(v) {
  if (!v) return null
  if (v instanceof Date) return isNaN(v) ? null : new Date(v)
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(v)
  return isNaN(d) ? null : d
}

/**
 * Sequelize `where` uchun oraliq yasaydi.
 * range(Op, '2026-08-06', '2026-08-06') → 06.08 00:00:00 — 06.08 23:59:59
 * Ikkalasi ham bo'sh bo'lsa `null` qaytaradi (filtr qo'yilmaydi).
 */
function dateRange(Op, from, to) {
  const w = {}
  const f = startOfDay(from)
  const t = endOfDay(to)
  if (f) w[Op.gte] = f
  if (t) w[Op.lte] = t
  return (f || t) ? w : null
}

/** Bitta kun uchun: dayRange(Op, '2026-08-06') */
function dayRange(Op, v) {
  const f = startOfDay(v)
  const t = endOfDay(v)
  if (!f || !t) return null
  return { [Op.between]: [f, t] }
}

module.exports = { startOfDay, endOfDay, dateRange, dayRange }
