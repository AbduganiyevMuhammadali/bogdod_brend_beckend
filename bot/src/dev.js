/**
 * Dasturchi rejimi.
 *
 * `DEV_CHAT_IDS` da ko'rsatilgan Telegram chatlar barcha do'konlar
 * bo'yicha umumiy ko'rinishni oladi: kim ulangan, do'konlar ishlayaptimi,
 * qaysi biri qancha savdo qilgan.
 *
 * Do'kon serverlariga hech qanday maxsus huquq qo'shilmaydi — dasturchi
 * ham o'sha `X-Bot-Token` orqali, faqat o'qish uchun murojaat qiladi.
 */
const store = require('./store')
const api = require('./api')
const F = require('./format')

function devChatlar() {
  return String(process.env.DEV_CHAT_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

function dasturchimi(chatId) {
  return devChatlar().includes(String(chatId))
}

/** Barcha ulangan do'konlar bo'yicha umumiy holat */
async function umumiy() {
  const shops = store.all()
  if (!shops.length) {
    return { matn: 'Hali hech qaysi do\'kon ulanmagan.', shops: [] }
  }

  // Do'kon nomi bo'yicha guruhlaymiz — bitta do'konga bir necha chat
  // ulangan bo'lishi mumkin
  const byShop = new Map()
  for (const s of shops) {
    if (!byShop.has(s.shop_name)) byShop.set(s.shop_name, [])
    byShop.get(s.shop_name).push(s)
  }

  const natija = []
  for (const [nom, chatlar] of byShop) {
    // Har do'kondan bitta chat orqali holat so'raymiz
    let holat = null, xato = null
    try {
      holat = await api.summary(chatlar[0])
    } catch (e) {
      xato = e.message
    }
    natija.push({ nom, chatlar, holat, xato })
  }
  return { shops: natija }
}

function umumiyMatn(data) {
  if (data.matn) return data.matn

  let t = `🛠 <b>Dasturchi paneli</b>\n\n`
  let jamiTushum = 0, jamiSotuv = 0, ishlayapti = 0

  for (const s of data.shops) {
    const belgi = s.xato ? '🔴' : '🟢'
    if (!s.xato) ishlayapti++
    t += `${belgi} <b>${s.nom}</b>\n`

    if (s.holat) {
      jamiTushum += s.holat.bugun.tushum
      jamiSotuv  += s.holat.bugun.sotuvlar
      t += `    ${F.fmt(s.holat.bugun.tushum)} so'm · ${s.holat.bugun.sotuvlar} ta sotuv\n`
      if (s.holat.qarzdorlar?.kechikkan) {
        t += `    🔴 ${s.holat.qarzdorlar.kechikkan} ta kechikkan qarz\n`
      }
    } else {
      t += `    <i>${s.xato}</i>\n`
    }

    // Ulangan chatlar
    t += `    👥 ${s.chatlar.length} ta akkaunt: `
    t += s.chatlar.map(c => c.shop_name && c.chat_id).length
      ? s.chatlar.map(c => `<code>${c.chat_id}</code>`).join(', ')
      : '—'
    t += `\n\n`
  }

  t += `━━━━━━━━━━━━━━━\n`
  t += `Do'konlar: <b>${data.shops.length}</b> (${ishlayapti} ta ishlayapti)\n`
  t += `Bugungi jami: <b>${F.fmt(jamiTushum)}</b> so'm · ${jamiSotuv} ta sotuv`
  return t
}

/** Texnik holat — server javob beryaptimi, javob tezligi */
async function texnik() {
  const shops = store.all()
  if (!shops.length) return 'Hali hech qaysi do\'kon ulanmagan.'

  let t = `⚙️ <b>Texnik holat</b>\n\n`
  for (const s of shops) {
    const boshland = Date.now()
    let holat, vaqt
    try {
      await api.summary(s)
      vaqt = Date.now() - boshland
      holat = vaqt < 1000 ? '🟢' : '🟡'
    } catch (e) {
      holat = '🔴'
      vaqt = null
      t += `${holat} <b>${s.shop_name}</b>\n    ${e.message}\n\n`
      continue
    }
    t += `${holat} <b>${s.shop_name}</b>\n`
    t += `    ${s.api_url}\n`
    t += `    javob: ${vaqt} ms`
    if (s.last_used) t += ` · oxirgi so'rov: ${s.last_used}`
    t += `\n\n`
  }
  return t.trimEnd()
}

module.exports = { dasturchimi, umumiy, umumiyMatn, texnik }
