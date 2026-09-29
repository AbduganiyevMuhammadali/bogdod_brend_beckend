require('dotenv').config()
const { Telegraf, Markup } = require('telegraf')
const cron = require('node-cron')
const store = require('./store')
const api = require('./api')
const F = require('./format')
const dev = require('./dev')

const TOKEN = process.env.BOT_TOKEN
if (!TOKEN) {
  console.error('BOT_TOKEN belgilanmagan (.env faylga yozing)')
  process.exit(1)
}

const bot = new Telegraf(TOKEN)

// ── Yordamchilar ─────────────────────────────────────────────────────
const menyu = Markup.keyboard([
  ['📊 Hisobot', '🏆 Top tovarlar'],
  ['🔴 Qarzdorlar', '💰 Kassa'],
  ['⚠️ Zaxira', '👤 Kassirlar'],
  ['🔍 Qidirish', '⚙️ Sozlamalar'],
]).resize()

function shopKerak(ctx) {
  const shop = store.get(ctx.chat.id)
  if (!shop) {
    ctx.reply(
      "Bu chat hali do'konga ulanmagan.\n\n" +
      "Dasturda <b>Sozlamalar → Botga ulash</b> bo'limini oching, " +
      "6 xonali kodni oling va shu yerga yuboring.",
      { parse_mode: 'HTML' }
    )
    return null
  }
  return shop
}

async function xato(ctx, e) {
  console.error('[xato]', e.message)
  await ctx.reply(`⚠️ ${e.message}`)
}

// ── /start ───────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  // Dasturchi — alohida menyu
  if (dev.dasturchimi(ctx.chat.id)) {
    return ctx.reply(
      `🛠 <b>Dasturchi rejimi</b>\n\n` +
      `Barcha do'konlar bo'yicha umumiy ko'rinish.\n\n` +
      `/dokonlar — do'konlar va ulanishlar\n` +
      `/texnik — serverlar holati`,
      { parse_mode: 'HTML', ...devMenyu }
    )
  }

  const shop = store.get(ctx.chat.id)
  if (shop) {
    return ctx.reply(
      `Salom! Bu chat <b>${shop.shop_name}</b> do'koniga ulangan.\n\n` +
      `Quyidagi tugmalardan foydalaning.`,
      { parse_mode: 'HTML', ...menyu }
    )
  }
  await ctx.reply(
    "👋 <b>Sellz POS</b> botiga xush kelibsiz!\n\n" +
    "Do'koningiz hisobotlarini shu yerdan ko'rasiz.\n\n" +
    "<b>Ulash uchun:</b>\n" +
    "1. Dasturda <b>Sozlamalar → Botga ulash</b> ni oching\n" +
    "2. Chiqqan 6 xonali kodni shu yerga yuboring\n\n" +
    "<i>Kod 5 daqiqa amal qiladi.</i>",
    { parse_mode: 'HTML' }
  )
})

// ── Kod bilan bog'lash ───────────────────────────────────────────────
// Foydalanuvchi "482913" yoki "3003 482913" yuborishi mumkin.
// Ikkinchi shakl — port boshqa bo'lsa.
bot.hears(/^\s*(?:(\d{2,5})\s+)?(\d{6})\s*$/, async (ctx) => {
  const port = ctx.match[1]
  const code = ctx.match[2]

  // Do'kon manzillari — bir nechta portni sinab ko'ramiz
  const bazaviy = process.env.SHOP_HOST || 'http://201.51.11.98'
  const portlar = port ? [port] : (process.env.SHOP_PORTS || '3003,3009').split(',')

  await ctx.reply('🔄 Tekshirilmoqda...')

  const xatolar = []
  for (const p of portlar) {
    const apiUrl = `${bazaviy}:${String(p).trim()}/api/v1`
    try {
      const r = await api.pair(apiUrl, {
        code,
        chatId: ctx.chat.id,
        chatName: ctx.chat.title
          || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
          || null,
        // Kartochkada "@username" ko'rinsin — do'kon egasi qaysi akkaunt
        // ulanganini aniq bilishi kerak
        chatUsername: ctx.from.username || null,
      })
      store.link({
        chatId: ctx.chat.id,
        shopName: r.shop || 'Do\'kon',
        apiUrl,
        token: r.token,
      })
      return ctx.reply(
        `✅ Ulandi!\n\nDo'kon: <b>${r.shop}</b>\n\n` +
        `Endi hisobotlarni ko'rishingiz mumkin.`,
        { parse_mode: 'HTML', ...menyu }
      )
    } catch (e) {
      xatolar.push(`${p}: ${e.message}`)
    }
  }

  await ctx.reply(
    `❌ Ulanmadi.\n\n` +
    `Sabablari:\n• Kod muddati tugagan (5 daqiqa)\n` +
    `• Kod allaqachon ishlatilgan\n• Do'kon serveri o'chiq\n\n` +
    `Dasturda yangi kod oling va qayta urinib ko'ring.`,
  )
  console.log('[pair xatolari]', xatolar.join(' | '))
})

// ── Hisobot ──────────────────────────────────────────────────────────
async function hisobotYubor(ctx) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const s = await api.summary(shop)
    store.touch(ctx.chat.id)
    await ctx.reply(F.hisobot(s, shop.shop_name), { parse_mode: 'HTML', ...menyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('📊 Hisobot', hisobotYubor)
bot.command('hisobot', hisobotYubor)

// ── Qarzdorlar ───────────────────────────────────────────────────────
async function qarzYubor(ctx) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const rows = await api.debtors(shop)
    store.touch(ctx.chat.id)
    await ctx.reply(F.qarzdorlar(rows), { parse_mode: 'HTML', ...menyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('🔴 Qarzdorlar', qarzYubor)
bot.command('qarzdorlar', qarzYubor)

// ── Zaxira ───────────────────────────────────────────────────────────
async function zaxiraYubor(ctx) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const rows = await api.lowStock(shop)
    store.touch(ctx.chat.id)
    await ctx.reply(F.zaxira(rows), { parse_mode: 'HTML', ...menyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('⚠️ Zaxira', zaxiraYubor)
bot.command('zaxira', zaxiraYubor)

// ── Davr hisoboti (hafta / oy) ───────────────────────────────────────
async function davrYubor(ctx, p) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const d = await api.period(shop, p)
    store.touch(ctx.chat.id)
    await ctx.reply(F.davr(d, shop.shop_name), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('Bugun', 'davr_kun'),
        Markup.button.callback('Hafta', 'davr_hafta'),
        Markup.button.callback('Oy',    'davr_oy'),
      ]]),
    })
  } catch (e) { await xato(ctx, e) }
}
bot.command('hafta', ctx => davrYubor(ctx, 'hafta'))
bot.command('oy',    ctx => davrYubor(ctx, 'oy'))
bot.action(/^davr_(kun|hafta|oy)$/, async (ctx) => {
  await ctx.answerCbQuery()
  await davrYubor(ctx, ctx.match[1])
})

// ── Top tovarlar ─────────────────────────────────────────────────────
async function topYubor(ctx, p = 'kun') {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const d = await api.top(shop, p)
    store.touch(ctx.chat.id)
    await ctx.reply(F.top(d.data, d.davr), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('Bugun', 'top_kun'),
        Markup.button.callback('Hafta', 'top_hafta'),
        Markup.button.callback('Oy',    'top_oy'),
      ]]),
    })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('🏆 Top tovarlar', ctx => topYubor(ctx, 'kun'))
bot.command('top', ctx => topYubor(ctx, 'kun'))
bot.action(/^top_(kun|hafta|oy)$/, async (ctx) => {
  await ctx.answerCbQuery()
  await topYubor(ctx, ctx.match[1])
})

// ── Kassirlar ────────────────────────────────────────────────────────
async function kassirYubor(ctx, p = 'kun') {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const d = await api.cashiers(shop, p)
    store.touch(ctx.chat.id)
    await ctx.reply(F.kassirlar(d.data, d.davr), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('Bugun', 'kas_kun'),
        Markup.button.callback('Hafta', 'kas_hafta'),
        Markup.button.callback('Oy',    'kas_oy'),
      ]]),
    })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('👤 Kassirlar', ctx => kassirYubor(ctx, 'kun'))
bot.command('kassirlar', ctx => kassirYubor(ctx, 'kun'))
bot.action(/^kas_(kun|hafta|oy)$/, async (ctx) => {
  await ctx.answerCbQuery()
  await kassirYubor(ctx, ctx.match[1])
})

// ── Kassa (to'lov turlari) ───────────────────────────────────────────
async function kassaYubor(ctx) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const d = await api.cash(shop)
    store.touch(ctx.chat.id)
    await ctx.reply(F.kassa(d), { parse_mode: 'HTML', ...menyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('💰 Kassa', kassaYubor)
bot.command('kassa', kassaYubor)

// ── Qidirish ─────────────────────────────────────────────────────────
// Foydalanuvchi "🔍 Qidirish" bosgach keyingi xabari qidiruv so'zi
// bo'lib qabul qilinadi.
const qidiruvKutish = new Set()

bot.hears('🔍 Qidirish', async (ctx) => {
  const shop = shopKerak(ctx); if (!shop) return
  qidiruvKutish.add(ctx.chat.id)
  await ctx.reply(
    "🔍 Tovar nomi, shtrix-kod yoki mijoz ismini yuboring.\n\n" +
    "<i>Masalan: Nike, 8542672470924, yoki Aziz</i>",
    { parse_mode: 'HTML' }
  )
})

async function qidir(ctx, q) {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    const [tovar, mijoz] = await Promise.all([
      api.findProduct(shop, q).catch(() => []),
      api.findClient(shop, q).catch(() => []),
    ])
    store.touch(ctx.chat.id)

    if (!tovar.length && !mijoz.length) {
      return ctx.reply(`"${q}" bo'yicha hech narsa topilmadi`, menyu)
    }
    if (tovar.length) await ctx.reply(F.tovarlar(tovar, q), { parse_mode: 'HTML' })
    if (mijoz.length) await ctx.reply(F.mijozlar(mijoz, q), { parse_mode: 'HTML', ...menyu })
    else if (tovar.length) await ctx.reply('—', menyu).catch(() => {})
  } catch (e) { await xato(ctx, e) }
}
bot.command('qidir', async (ctx) => {
  const q = ctx.message.text.replace(/^\/qidir\s*/, '').trim()
  if (!q) { qidiruvKutish.add(ctx.chat.id); return ctx.reply('Nimani qidiray?') }
  await qidir(ctx, q)
})

// ── Sozlamalar ───────────────────────────────────────────────────────
const vaqt = (h, m = 0) => `${String(h ?? 22).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  const shop = shopKerak(ctx); if (!shop) return
  await ctx.reply(
    `<b>Sozlamalar</b>\n\n` +
    `Do'kon: <b>${shop.shop_name}</b>\n` +
    `🌙 Kun yakuni: ${shop.daily ? `✅ <b>${vaqt(shop.daily_hour, shop.daily_minute)}</b>` : '❌ o\'chirilgan'}\n` +
    `☀️ Ertalabki qarz eslatmasi: ${shop.morning ? `✅ <b>${String(shop.morning_hour ?? 9).padStart(2,'0')}:00</b>` : '❌ o\'chirilgan'}\n`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(
          shop.daily ? '🔕 Kunlik xabarni o\'chirish' : '🔔 Kunlik xabarni yoqish',
          'daily_toggle')],
        [Markup.button.callback('🕐 Kun yakuni vaqti', 'hour_pick')],
        [Markup.button.callback(
          shop.morning ? '🔕 Ertalabki eslatmani o\'chirish' : '☀️ Ertalabki eslatmani yoqish',
          'morning_toggle')],
        [Markup.button.callback('🕘 Ertalabki eslatma vaqti', 'mhour_pick')],
        [Markup.button.callback('🔌 Do\'kondan uzish', 'unlink')],
      ]),
    }
  )
})

bot.action('daily_toggle', async (ctx) => {
  const shop = store.get(ctx.chat.id)
  if (!shop) return ctx.answerCbQuery('Ulanmagan')
  store.setDaily(ctx.chat.id, !shop.daily)
  await ctx.answerCbQuery(shop.daily ? 'O\'chirildi' : 'Yoqildi')
  await ctx.editMessageText(
    `Kunlik xabar: ${!shop.daily ? '✅ yoqildi' : '❌ o\'chirildi'}`,
    { parse_mode: 'HTML' }
  )
})

// Kunlik xabar soatini tanlash — har chat o'zi belgilaydi
bot.action('hour_pick', async (ctx) => {
  await ctx.answerCbQuery()
  const vaqtlar = [[18, 0], [19, 0], [20, 0], [21, 0], [21, 30], [22, 0], [22, 30], [23, 0], [23, 30]]
  const qatorlar = []
  for (let i = 0; i < vaqtlar.length; i += 3) {
    qatorlar.push(vaqtlar.slice(i, i + 3).map(([h, m]) =>
      Markup.button.callback(vaqt(h, m), `hour_${h}_${m}`)))
  }
  await ctx.reply('🕐 Kunlik xabar qaysi soatda kelsin?', Markup.inlineKeyboard(qatorlar))
})

// Eski tugmalar "hour_21" shaklida bo'lishi mumkin — daqiqa ixtiyoriy
bot.action(/^hour_(\d{1,2})(?:_(\d{1,2}))?$/, async (ctx) => {
  const h = Number(ctx.match[1])
  const m = Number(ctx.match[2] || 0)
  if (!store.get(ctx.chat.id)) return ctx.answerCbQuery('Ulanmagan')
  store.setHour(ctx.chat.id, h, m)
  await ctx.answerCbQuery(vaqt(h, m) + ' ga o\'rnatildi')
  await ctx.editMessageText(
    '✅ Kunlik xabar har kuni <b>' + vaqt(h, m) + '</b> da keladi',
    { parse_mode: 'HTML' }
  )
})

// Ertalabki eslatma — yoqish/o'chirish
bot.action('morning_toggle', async (ctx) => {
  const shop = store.get(ctx.chat.id)
  if (!shop) return ctx.answerCbQuery('Ulanmagan')
  store.setMorning(ctx.chat.id, !shop.morning)
  await ctx.answerCbQuery(shop.morning ? 'O\'chirildi' : 'Yoqildi')
  await ctx.editMessageText(
    `☀️ Ertalabki qarz eslatmasi: ${!shop.morning
      ? `✅ yoqildi · <b>${String(shop.morning_hour ?? 9).padStart(2,'0')}:00</b>`
      : '❌ o\'chirildi'}`,
    { parse_mode: 'HTML' }
  )
})

// Ertalabki eslatma soati
bot.action('mhour_pick', async (ctx) => {
  await ctx.answerCbQuery()
  const soatlar = [7, 8, 9, 10, 11, 12]
  const qatorlar = []
  for (let i = 0; i < soatlar.length; i += 3) {
    qatorlar.push(soatlar.slice(i, i + 3).map(h =>
      Markup.button.callback(String(h).padStart(2, '0') + ':00', 'mhour_' + h)))
  }
  await ctx.reply('🕘 Ertalabki qarz eslatmasi qaysi soatda kelsin?',
    Markup.inlineKeyboard(qatorlar))
})

bot.action(/^mhour_(\d{1,2})$/, async (ctx) => {
  const h = Number(ctx.match[1])
  if (!store.get(ctx.chat.id)) return ctx.answerCbQuery('Ulanmagan')
  store.setMorningHour(ctx.chat.id, h)
  await ctx.answerCbQuery(h + ':00 ga o\'rnatildi')
  await ctx.editMessageText(
    '✅ Ertalabki qarz eslatmasi har kuni <b>' + String(h).padStart(2, '0') + ':00</b> da keladi',
    { parse_mode: 'HTML' }
  )
})

bot.action('unlink', async (ctx) => {
  store.unlink(ctx.chat.id)
  await ctx.answerCbQuery('Uzildi')
  await ctx.editMessageText(
    "🔌 Do'kondan uzildi.\n\nQayta ulash uchun dasturdan yangi kod oling."
  )
})

// ── Dasturchi paneli ─────────────────────────────────────────────────
// Faqat `DEV_CHAT_IDS` dagi chatlar ko'radi. Oddiy do'kon egasi bu
// buyruqlarni bilsa ham javob ololmaydi.
const devMenyu = Markup.keyboard([
  ['🛠 Do\'konlar', '⚙️ Texnik holat'],
  ['📊 Hisobot', '⚙️ Sozlamalar'],
]).resize()

function devKerak(ctx) {
  if (!dev.dasturchimi(ctx.chat.id)) return false
  return true
}

async function devUmumiy(ctx) {
  if (!devKerak(ctx)) return
  await ctx.reply('🔄 Do\'konlar tekshirilmoqda...')
  try {
    const d = await dev.umumiy()
    await ctx.reply(dev.umumiyMatn(d), { parse_mode: 'HTML', ...devMenyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('🛠 Do\'konlar', devUmumiy)
bot.command('dokonlar', devUmumiy)

async function devTexnik(ctx) {
  if (!devKerak(ctx)) return
  await ctx.reply('🔄 Serverlar tekshirilmoqda...')
  try {
    await ctx.reply(await dev.texnik(), { parse_mode: 'HTML', ...devMenyu })
  } catch (e) { await xato(ctx, e) }
}
bot.hears('⚙️ Texnik holat', devTexnik)
bot.command('texnik', devTexnik)

bot.command('dev', async (ctx) => {
  if (!dev.dasturchimi(ctx.chat.id)) {
    return ctx.reply('Bu buyruq siz uchun emas.')
  }
  await ctx.reply(
    `🛠 <b>Dasturchi rejimi</b>\n\n` +
    `Chat ID: <code>${ctx.chat.id}</code>\n\n` +
    `/dokonlar — barcha do'konlar holati\n` +
    `/texnik — serverlar javob beryaptimi\n\n` +
    `<i>Do'kon hisobotini ko'rish uchun o'sha do'konga ulaning.</i>`,
    { parse_mode: 'HTML', ...devMenyu }
  )
})

bot.command('help', (ctx) => ctx.reply(
  "<b>Buyruqlar</b>\n\n" +
  "<b>Hisobotlar</b>\n" +
  "/hisobot — bugungi savdo va foyda\n" +
  "/hafta — oxirgi 7 kun\n" +
  "/oy — shu oy\n" +
  "/top — eng ko'p sotilgan tovarlar\n" +
  "/kassirlar — kassirlar bo'yicha\n" +
  "/kassa — to'lov turlari (naqd/karta)\n\n" +
  "<b>Ma'lumot</b>\n" +
  "/qarzdorlar — qarzdorlar ro'yxati\n" +
  "/zaxira — kam qolgan tovarlar\n" +
  "/qidir <i>so'z</i> — tovar yoki mijoz qidirish\n\n" +
  "<b>Sozlash</b>\n" +
  "/sozlamalar — kunlik xabar vaqti va ulanish\n\n" +
  "<i>Shtrix-kod yuborsangiz ham tovar topiladi.</i>",
  { parse_mode: 'HTML' }
))

bot.command('sozlamalar', async (ctx) => {
  await ctx.reply('⚙️ Sozlamalar tugmasini bosing', menyu)
})

// ── Kun yakuni hisoboti ──────────────────────────────────────────────
// Rahbar uchun bitta xabarda kunning to'liq manzarasi: tushum va foyda,
// kassa (to'lov turlari), eng ko'p sotilgan tovarlar, kassirlar va
// e'tibor talab qiladigan narsalar. Qo'shimcha bo'limlardan biri
// olinmasa ham asosiy hisobot baribir yuboriladi.
async function kunYakuni(shop) {
  const sm = await api.summary(shop)
  const [kassa, topT, kassir] = await Promise.all([
    api.cash(shop).catch(() => null),
    api.top(shop, 'kun').catch(() => null),
    api.cashiers(shop, 'kun').catch(() => null),
  ])
  return F.kunYakuni({ sm, kassa, top: topT?.data, kassirlar: kassir?.data }, shop.shop_name)
}

// Kun yakuni hisobotini vaqtini kutmasdan ko'rish
bot.command('kunyakuni', async (ctx) => {
  const shop = shopKerak(ctx); if (!shop) return
  try {
    await ctx.reply(await kunYakuni(shop), { parse_mode: 'HTML', ...menyu })
  } catch (e) { await xato(ctx, e) }
})

// ── Kunlik avtomatik xabar ───────────────────────────────────────────
// Har soat boshida ishlaydi va aynan shu soatni tanlagan chatlarga
// yuboradi. Ilgari vaqt `.env` da qat'iy edi va do'kon egasi uni
// o'zgartira olmasdi — endi har chat o'zi belgilaydi (/sozlamalar).
cron.schedule('0,30 * * * *', async () => {
  // Vaqtni TZ bo'yicha olamiz — server boshqa zonada bo'lsa ham
  // Toshkent vaqtida ishlasin
  const [soat, daqiqa] = new Date()
    .toLocaleTimeString('en-GB', { timeZone: process.env.TZ || 'Asia/Tashkent', hour12: false })
    .split(':').map(Number)
  const chats = store.chatsAtTime(soat, daqiqa)
  if (!chats.length) return
  console.log(`[kunlik ${vaqt(soat, daqiqa)}] ${chats.length} ta chatga yuborilmoqda`)

  for (const shop of chats) {
    try {
      await bot.telegram.sendMessage(shop.chat_id, await kunYakuni(shop), { parse_mode: 'HTML' })
    } catch (e) {
      console.error(`[kunlik xato] ${shop.shop_name}:`, e.message)
    }
  }
}, { timezone: process.env.TZ || 'Asia/Tashkent' })

// ── Ertalabki qarz eslatmasi ─────────────────────────────────────────
// Har kuni belgilangan soatda (standart 09:00) bugun undirilishi kerak
// bo'lgan qarzlar ro'yxati keladi: ism, telefon, summa, qachon olingani.
cron.schedule('0 * * * *', async () => {
  const soat = new Date().getHours()
  const chats = store.morningAtHour(soat)
  if (!chats.length) return
  console.log(`[ertalab ${soat}:00] ${chats.length} ta chatga yuborilmoqda`)

  for (const shop of chats) {
    try {
      const rows = await api.debtorsToday(shop)
      await bot.telegram.sendMessage(
        shop.chat_id,
        F.ertalab(rows, shop.shop_name),
        { parse_mode: 'HTML' }
      )
    } catch (e) {
      console.error(`[ertalab xato] ${shop.shop_name}:`, e.message)
    }
  }
}, { timezone: process.env.TZ || 'Asia/Tashkent' })

// ── Ishga tushirish ──────────────────────────────────────────────────
// Qidiruv rejimida yuborilgan matnni ushlaymiz.
// Bu eng oxirida turishi kerak — boshqa tugmalar va buyruqlar
// avval tekshirilsin, aks holda ular ham qidiruv deb qabul qilinardi.
bot.on('text', async (ctx) => {
  const t = (ctx.message.text || '').trim()
  if (!t || t.startsWith('/')) return
  if (!qidiruvKutish.has(ctx.chat.id)) return
  qidiruvKutish.delete(ctx.chat.id)
  await qidir(ctx, t)
})

bot.catch((e, ctx) => {
  console.error('[bot xato]', e?.message)
  ctx?.reply?.('⚠️ Kutilmagan xatolik. Qaytadan urinib ko\'ring.').catch(() => {})
})

bot.launch()
// Kunlik xabar endi har chat o'z soatida oladi (cron soat boshida
// ishlaydi va o'sha soatni tanlaganlarga yuboradi).
console.log(`Bot ishga tushdi | ulangan do'konlar: ${store.all().length}`)

process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
