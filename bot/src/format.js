/** Telegram xabarlarini shakllantirish */

const fmt = v => new Intl.NumberFormat('uz-UZ').format(Math.round(Number(v) || 0))

function sana(k) {
  if (!k) return ''
  // Sana `2026-08-17` yoki `2026-08-17T14:30:00.000Z` shaklida kelishi
  // mumkin — vaqt qismini kesib tashlaymiz, aks holda kun raqami
  // "17T14" bo'lib qolib, natija "NaN-" chiqardi.
  const [y, m, d] = String(k).slice(0, 10).split('-')
  const oylar = ['yanvar','fevral','mart','aprel','may','iyun',
                 'iyul','avgust','sentabr','oktabr','noyabr','dekabr']
  const kun = Number(d)
  if (!kun) return ''
  return `${kun}-${oylar[Number(m) - 1] || ''}`
}

function hisobot(s, shopName) {
  const b = s.bugun, q = s.qarzdorlar
  const foydaBelgi = b.foyda >= 0 ? '📈' : '📉'

  let t = `📊 <b>${shopName}</b> — ${sana(s.sana)}\n\n`
  t += `💰 Tushum:      <b>${fmt(b.tushum)}</b> so'm\n`
  t += `🧾 Sotuvlar:    <b>${b.sotuvlar}</b> ta · ${b.tovarlar} dona tovar\n`
  t += `${foydaBelgi} Sof foyda:   <b>${fmt(b.foyda)}</b> so'm`
  if (b.marja) t += ` <i>(${b.marja}%)</i>`
  t += `\n`
  if (b.qarz > 0) t += `⏰ Bugungi qarz: <b>${fmt(b.qarz)}</b> so'm\n`

  // Qarzdorlar — faqat e'tibor talab qiladiganlari
  if (q.kechikkan || q.bugun) {
    t += `\n<b>Qarzdorlar</b>\n`
    if (q.kechikkan) t += `🔴 Kechikkan: ${q.kechikkan} ta — ${fmt(q.kech_sum)} so'm\n`
    if (q.bugun)     t += `🟡 Bugun to'lashi kerak: ${q.bugun} ta — ${fmt(q.bugun_sum)} so'm\n`
  }
  if (q.jami) t += `<i>Jami qarz: ${fmt(q.jami_sum)} so'm (${q.jami} hujjat)</i>\n`

  if (s.kam_zaxira) t += `\n⚠️ Kam qolgan tovar: <b>${s.kam_zaxira}</b> ta\n`

  return t
}

function qarzdorlar(rows) {
  if (!rows.length) return '✅ Qarzdor yo\'q'
  let t = `<b>Qarzdorlar</b> — ${rows.length} ta\n\n`
  rows.forEach((r, i) => {
    const belgi = r.kechikkan ? '🔴' : (r.muddat ? '🟡' : '⚪️')
    t += `${belgi} <b>${r.name}</b>\n`
    t += `   ${fmt(r.qarz)} so'm`
    if (r.muddat) t += ` · ${sana(r.muddat)}`
    if (r.phone)  t += `\n   📞 ${r.phone}`
    t += `\n`
    if (i < rows.length - 1) t += '\n'
  })
  return t
}

function zaxira(rows) {
  if (!rows.length) return '✅ Barcha tovar yetarli'
  let t = `<b>Kam qolgan tovarlar</b> — ${rows.length} ta\n\n`
  rows.forEach(r => {
    t += `⚠️ ${r.name}\n   qoldiq: <b>${r.qty}</b> (eng kam: ${r.min})\n`
  })
  return t
}

const DAVR_NOM = { kun: 'Bugun', hafta: 'Oxirgi 7 kun', oy: 'Shu oy' }

function davr(d, shopName) {
  const foydaBelgi = d.foyda >= 0 ? '📈' : '📉'
  let t = `📊 <b>${shopName}</b>\n<i>${DAVR_NOM[d.davr] || d.davr}</i>\n\n`
  t += `💰 Tushum:     <b>${fmt(d.tushum)}</b> so'm\n`
  t += `🧾 Sotuvlar:   <b>${d.sotuvlar}</b> ta · ${d.tovarlar} dona\n`
  t += `${foydaBelgi} Sof foyda:  <b>${fmt(d.foyda)}</b> so'm`
  if (d.marja) t += ` <i>(${d.marja}%)</i>`
  t += `\n`
  if (d.chegirma > 0) t += `🏷 Chegirma:   ${fmt(d.chegirma)} so'm\n`
  if (d.qarz > 0)     t += `⏰ Qarzga:     ${fmt(d.qarz)} so'm\n`
  if (d.sotuvlar) {
    t += `\n<i>O'rtacha chek: ${fmt(d.tushum / d.sotuvlar)} so'm</i>`
  }
  return t
}

function top(rows, davrNom) {
  if (!rows.length) return 'Bu davrda sotuv yo\'q'
  let t = `🏆 <b>Top tovarlar</b>\n<i>${DAVR_NOM[davrNom] || davrNom}</i>\n\n`
  rows.forEach((r, i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i + 1}.`
    t += `${medal} <b>${r.name}</b>\n`
    t += `    ${r.dona} dona · ${fmt(r.savdo)} so'm`
    if (r.foyda) t += ` · foyda ${fmt(r.foyda)}`
    t += `\n`
  })
  return t
}

function kassirlar(rows, davrNom) {
  if (!rows.length) return 'Bu davrda sotuv yo\'q'
  let t = `👤 <b>Kassirlar</b>\n<i>${DAVR_NOM[davrNom] || davrNom}</i>\n\n`
  rows.forEach(r => {
    t += `<b>${r.name}</b>\n`
    t += `    ${r.sotuvlar} ta sotuv · ${fmt(r.tushum)} so'm`
    if (r.chegirma) t += `\n    chegirma: ${fmt(r.chegirma)} so'm`
    t += `\n\n`
  })
  return t.trimEnd()
}

function kassa(d) {
  const BELGI = { 'Naqd': '💵', 'Karta': '💳', "O'tkazma": '📲', 'Qarz': '⏰' }
  let jami = 0
  let t = `💰 <b>Kassa — bugun</b>\n\n`
  if (!d.turlar.length) return t + 'Bugun sotuv yo\'q'
  d.turlar.forEach(x => {
    jami += x.summa
    t += `${BELGI[x.tur] || '•'} ${x.tur}: <b>${fmt(x.summa)}</b> so'm <i>(${x.soni} ta)</i>\n`
  })
  if (d.qarz_tolovlari > 0) {
    t += `\n↩️ Qarz to'lovlari: <b>${fmt(d.qarz_tolovlari)}</b> so'm\n`
    jami += d.qarz_tolovlari
  }
  t += `\n<b>Jami kassaga: ${fmt(jami)} so'm</b>`
  return t
}

function tovarlar(rows, q) {
  if (!rows.length) return `"${q}" bo'yicha tovar topilmadi`
  let t = `🔍 <b>Topildi: ${rows.length} ta</b>\n\n`
  rows.forEach(r => {
    const holat = r.qty <= 0 ? '🔴' : (r.min > 0 && r.qty <= r.min ? '🟡' : '🟢')
    t += `${holat} <b>${r.name}</b>\n`
    t += `    narx: ${fmt(r.price)} so'm · qoldiq: <b>${r.qty}</b>\n`
    if (r.barcode) t += `    <code>${r.barcode}</code>\n`
    t += `\n`
  })
  return t.trimEnd()
}

function mijozlar(rows, q) {
  if (!rows.length) return `"${q}" bo'yicha mijoz topilmadi`
  let t = `👥 <b>Topildi: ${rows.length} ta</b>\n\n`
  rows.forEach(r => {
    t += `<b>${r.name}</b>\n`
    if (r.phone) t += `    📞 ${r.phone}\n`
    if (r.qarz > 0) {
      t += `    🔴 qarzi: <b>${fmt(r.qarz)}</b> so'm`
      if (r.hujjatlar) t += ` (${r.hujjatlar} hujjat)`
      if (r.muddat) t += `\n    ⏰ muddat: ${sana(r.muddat)}`
      t += `\n`
    } else {
      t += `    ✅ qarzi yo'q\n`
    }
    t += `\n`
  })
  return t.trimEnd()
}

/**
 * Ertalabki eslatma — bugun undirilishi kerak bo'lgan qarzlar.
 *
 * Kassir telefonni qo'liga olib qo'ng'iroq qila olishi kerak, shuning
 * uchun ism, raqam, summa va qachon olingani bir joyda turadi.
 */
function ertalab(rows, shopName) {
  let t = `☀️ <b>Xayrli tong!</b>\n`
  t += `<i>Sellz'ga xush kelibsiz — ${shopName}</i>\n\n`

  if (!rows.length) {
    t += `✅ Bugun undiriladigan qarz yo'q.\n\n<i>Savdongiz baraka topsin!</i>`
    return t
  }

  const kechikkan = rows.filter(r => r.kechikkan)
  const bugun     = rows.filter(r => !r.kechikkan)
  const jami      = rows.reduce((a, r) => a + r.qarz, 0)

  t += `📋 <b>Bugun qarzdorliklarni undiring</b>\n`
  t += `${rows.length} ta mijoz · jami <b>${fmt(jami)}</b> so'm\n`

  const yoz = (r) => {
    let x = `\n<b>${r.name}</b>\n`
    if (r.phone) x += `   📞 <code>${r.phone}</code>\n`
    x += `   💰 <b>${fmt(r.qarz)}</b> so'm`
    if (r.hujjatlar > 1) x += ` <i>(${r.hujjatlar} hujjat)</i>`
    x += `\n`
    if (r.olingan) x += `   🛒 olingan: ${sana(r.olingan)}\n`
    if (r.muddat)  x += `   ⏰ muddat: ${sana(r.muddat)}`
    if (r.kunlar > 0) x += ` — <b>${r.kunlar} kun kechikdi</b>`
    x += `\n`
    return x
  }

  if (kechikkan.length) {
    t += `\n🔴 <b>KECHIKKAN — ${kechikkan.length} ta</b>\n`
    kechikkan.forEach(r => { t += yoz(r) })
  }
  if (bugun.length) {
    t += `\n🟡 <b>BUGUN TO'LASHI KERAK — ${bugun.length} ta</b>\n`
    bugun.forEach(r => { t += yoz(r) })
  }

  t += `\n<i>Qo'ng'iroq qilib eslatib qo'ying.</i>`
  return t
}

/**
 * Kun yakuni — rahbar uchun to'liq kunlik hisobot (avtomatik keladi).
 * kassa / top / kassirlar bo'lmasa (server xatosi) o'sha bo'lim tushib qoladi.
 */
function kunYakuni({ sm, kassa, top, kassirlar }, shopName) {
  const b = sm.bugun, q = sm.qarzdorlar || {}
  const chiziq = '──────────────\n'

  let t = `🌙 <b>KUN YAKUNI</b>\n📊 <b>${shopName}</b> — ${sana(sm.sana)}\n\n`

  if (!b.sotuvlar) {
    t += `Bugun sotuv bo'lmadi.\n`
  } else {
    const foydaBelgi = b.foyda >= 0 ? '📈' : '📉'
    t += `💰 Tushum: <b>${fmt(b.tushum)}</b> so'm\n`
    t += `${foydaBelgi} Sof foyda: <b>${fmt(b.foyda)}</b> so'm`
    if (b.marja) t += ` <i>(${b.marja}%)</i>`
    t += `\n🧾 Sotuvlar: <b>${b.sotuvlar}</b> ta · ${b.tovarlar} dona\n`
    t += `🛒 O'rtacha chek: <b>${fmt(b.tushum / b.sotuvlar)}</b> so'm\n`
    if (b.qarz > 0) t += `⏰ Qarzga sotildi: <b>${fmt(b.qarz)}</b> so'm\n`
  }

  // Kassa — to'lov turlari bo'yicha
  if (kassa?.turlar?.length || kassa?.qarz_tolovlari > 0) {
    const BELGI = { 'Naqd': '💵', 'Karta': '💳', "O'tkazma": '📲', 'Qarz': '⏰' }
    let jami = 0
    t += `\n${chiziq}💼 <b>Kassa</b>\n`
    ;(kassa.turlar || []).forEach(x => {
      if (x.tur !== 'Qarz') jami += x.summa
      t += `${BELGI[x.tur] || '•'} ${x.tur}: <b>${fmt(x.summa)}</b> so'm <i>(${x.soni} ta)</i>\n`
    })
    if (kassa.qarz_tolovlari > 0) {
      t += `↩️ Qarz to'lovlari: <b>${fmt(kassa.qarz_tolovlari)}</b> so'm\n`
      jami += kassa.qarz_tolovlari
    }
    t += `<b>Jami kirim: ${fmt(jami)} so'm</b>\n`
  }

  // Eng ko'p sotilgan tovarlar — birinchi 5 tasi
  if (top?.length) {
    t += `\n${chiziq}🏆 <b>Top tovarlar</b>\n`
    top.slice(0, 5).forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
      t += `${medal} ${r.name} — ${r.dona} dona · ${fmt(r.savdo)} so'm\n`
    })
  }

  // Kassirlar
  if (kassirlar?.length) {
    t += `\n${chiziq}👤 <b>Kassirlar</b>\n`
    kassirlar.forEach(r => {
      t += `${r.name}: ${r.sotuvlar} ta · <b>${fmt(r.tushum)}</b> so'm`
      if (r.chegirma) t += ` <i>(chegirma ${fmt(r.chegirma)})</i>`
      t += `\n`
    })
  }

  // E'tibor talab qiladigan narsalar
  const ogoh = []
  if (q.kechikkan) ogoh.push(`🔴 Muddati o'tgan qarz: ${q.kechikkan} ta — ${fmt(q.kech_sum)} so'm`)
  if (q.bugun)     ogoh.push(`🟡 Bugun to'lanishi kerak edi: ${q.bugun} ta — ${fmt(q.bugun_sum)} so'm`)
  if (sm.kam_zaxira) ogoh.push(`⚠️ Kam qolgan tovar: ${sm.kam_zaxira} ta`)
  if (ogoh.length) t += `\n${chiziq}❗️ <b>Diqqat</b>\n` + ogoh.join('\n') + '\n'

  if (q.jami) t += `\n<i>Jami qarz: ${fmt(q.jami_sum)} so'm (${q.jami} hujjat)</i>`

  return t.trimEnd()
}

module.exports = { fmt, sana, hisobot, qarzdorlar, zaxira, davr, top, kassirlar, kassa, tovarlar, mijozlar, ertalab, kunYakuni }
