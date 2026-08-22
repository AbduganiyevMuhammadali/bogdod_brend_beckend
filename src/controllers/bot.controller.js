const crypto = require('crypto')
const { Op, fn, col, literal } = require('sequelize')
const sequelize          = require('../db/db-sequelize')
const BotLinkModel       = require('../models/bot_link.model')
const KassaRegisterModel = require('../models/kassa_register.model')
const ProductRegisterModel = require('../models/product_register.model')
const ProductModel       = require('../models/product.model')
const SaleModel          = require('../models/sale.model')
const ClientModel        = require('../models/client.model')
const HttpException      = require('../utils/HttpException.utils')
const config             = require('../startup/config')

// Kun chegarasi mahalliy vaqtda
function kunOraligi(sana) {
  const d = sana ? new Date(sana) : new Date()
  const b = new Date(d); b.setHours(0, 0, 0, 0)
  const e = new Date(d); e.setHours(23, 59, 59, 999)
  return { [Op.between]: [b, e] }
}
function bugunKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

class BotController {

  /**
   * POST /api/v1/bot/pair-code
   * Dasturdagi "Botga ulash" tugmasi bosilganda 6 xonali kod yasaydi.
   * Kod 5 daqiqa amal qiladi va bir marta ishlatiladi.
   */
  createPairCode = async (req, res) => {
    const kod = String(crypto.randomInt(100000, 999999))
    const muddat = new Date(Date.now() + 5 * 60 * 1000)

    // Eski ishlatilmagan kodlarni tozalaymiz
    await BotLinkModel.destroy({ where: { chat_id: null } })

    await BotLinkModel.create({
      pair_code: kod,
      code_expires_at: muddat,
      created_by: req.currentUser?.id ?? null,
    })

    res.json({
      code: kod,
      expires_at: muddat,
      // Bot shu manzilga so'rov yuboradi — foydalanuvchiga ko'rsatiladi
      hint: 'Telegram botda shu kodni yuboring. Kod 5 daqiqa amal qiladi.',
    })
  }

  /**
   * POST /api/v1/bot/pair   { code, chat_id, chat_name }
   * Bot chaqiradi (auth SHART EMAS — kodning o'zi tasdiq).
   * Kod to'g'ri bo'lsa uzoq muddatli token qaytaradi.
   */
  pair = async (req, res) => {
    const { code, chat_id, chat_name } = req.body
    if (!code || !chat_id) throw new HttpException(400, 'code va chat_id majburiy')

    const link = await BotLinkModel.findOne({
      where: {
        pair_code: String(code).trim(),
        chat_id: null,
        code_expires_at: { [Op.gt]: new Date() },
      },
      order: [['id', 'DESC']],
    })
    if (!link) throw new HttpException(400, 'Kod noto\'g\'ri yoki muddati tugagan')

    const token = crypto.randomBytes(32).toString('hex')
    await link.update({
      chat_id:   String(chat_id),
      chat_name: chat_name ? String(chat_name).slice(0, 200) : null,
      token,
      pair_code: null,
      code_expires_at: null,
      last_seen: new Date(),
    })

    res.json({
      ok: true,
      token,
      shop: config.db_name,   // do'kon nomi — botda ko'rsatiladi
    })
  }

  /**
   * GET /api/v1/bot/summary
   * Bot uchun tayyor hisobot — bitta so'rovda hammasi.
   * Auth: `X-Bot-Token` sarlavhasi.
   */
  summary = async (req, res) => {
    const link = req.botLink
    const bugun = bugunKey()

    // ── Bugungi savdo (chegirmadan keyingi summa) ──────────────────
    const [k] = await KassaRegisterModel.findAll({
      where: { status: 'completed', date: kunOraligi(), sale_id: { [Op.not]: null } },
      attributes: [
        [fn('COUNT', col('id')), 'sotuvlar'],
        [fn('SUM', literal('total_sum - COALESCE(discount, 0)')), 'tushum'],
        [fn('SUM', col('paid_sum')), 'tolangan'],
        [fn('SUM', col('debt_sum')), 'qarz'],
        [fn('SUM', col('item_count')), 'tovarlar'],
      ],
      raw: true,
    })

    // ── Foyda (product_register — FIFO tannarx bilan) ──────────────
    const [p] = await ProductRegisterModel.findAll({
      where: { status: 'active', date: kunOraligi() },
      attributes: [
        [fn('SUM', col('total_sum')), 'savdo'],
        [fn('SUM', literal('cost_price * qty')), 'tannarx'],
      ],
      raw: true,
    })
    const savdo   = Number(p?.savdo)   || 0
    const tannarx = Number(p?.tannarx) || 0

    // ── Qarzdorlar (bugun to'lashi kerak + kechikkan) ──────────────
    const [qarz] = await sequelize.query(`
      SELECT
        SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) bugun_n,
        SUM(CASE WHEN due_date = ? THEN debt_sum ELSE 0 END) bugun_s,
        SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) kech_n,
        SUM(CASE WHEN due_date < ? THEN debt_sum ELSE 0 END) kech_s,
        COUNT(*) jami_n, SUM(debt_sum) jami_s
      FROM sale
      WHERE debt_sum > 0 AND status <> 'cancelled'
    `, { replacements: [bugun, bugun, bugun, bugun] }).catch(() => [[{}]])
    const q = (qarz && qarz[0]) || {}

    // ── Kam qolgan tovarlar ────────────────────────────────────────
    const kamZaxira = await ProductModel.count({
      where: {
        active: true, is_folder: false,
        min_qty: { [Op.gt]: 0 },
        [Op.and]: literal('`ProductModel`.`qty` <= `ProductModel`.`min_qty`'),
      },
    }).catch(() => 0)

    await link.update({ last_seen: new Date() })

    res.json({
      shop:   config.db_name,
      sana:   bugun,
      bugun: {
        sotuvlar: Number(k?.sotuvlar) || 0,
        tushum:   Number(k?.tushum)   || 0,
        tolangan: Number(k?.tolangan) || 0,
        qarz:     Number(k?.qarz)     || 0,
        tovarlar: Number(k?.tovarlar) || 0,
        savdo, tannarx,
        foyda:    savdo - tannarx,
        marja:    savdo > 0 ? +((savdo - tannarx) / savdo * 100).toFixed(1) : 0,
      },
      qarzdorlar: {
        bugun:     Number(q.bugun_n) || 0,
        bugun_sum: Number(q.bugun_s) || 0,
        kechikkan: Number(q.kech_n)  || 0,
        kech_sum:  Number(q.kech_s)  || 0,
        jami:      Number(q.jami_n)  || 0,
        jami_sum:  Number(q.jami_s)  || 0,
      },
      kam_zaxira: kamZaxira,
    })
  }

  /** GET /api/v1/bot/debtors — qarzdorlar ro'yxati (bot uchun qisqa) */
  debtors = async (req, res) => {
    const bugun = bugunKey()
    const [rows] = await sequelize.query(`
      SELECT c.name, c.phone, SUM(s.debt_sum) qarz, MIN(s.due_date) muddat
        FROM sale s JOIN client c ON c.id = s.client_id
       WHERE s.debt_sum > 0 AND s.status <> 'cancelled'
       GROUP BY s.client_id
       ORDER BY (MIN(s.due_date) IS NULL), MIN(s.due_date) ASC
       LIMIT 30
    `).catch(() => [[]])

    res.json((rows || []).map(r => ({
      name: r.name, phone: r.phone,
      qarz: Number(r.qarz) || 0,
      muddat: r.muddat ? String(r.muddat).slice(0, 10) : null,
      kechikkan: r.muddat ? String(r.muddat).slice(0, 10) < bugun : false,
    })))
  }

  /** GET /api/v1/bot/low-stock — kam qolgan tovarlar */
  lowStock = async (req, res) => {
    const rows = await ProductModel.findAll({
      where: {
        active: true, is_folder: false,
        min_qty: { [Op.gt]: 0 },
        [Op.and]: literal('`ProductModel`.`qty` <= `ProductModel`.`min_qty`'),
      },
      attributes: ['id', 'name', 'qty', 'min_qty'],
      order: [['qty', 'ASC']],
      limit: 30,
      raw: true,
    }).catch(() => [])

    res.json(rows.map(r => ({
      name: r.name,
      qty: Number(r.qty) || 0,
      min: Number(r.min_qty) || 0,
    })))
  }

  /** GET /api/v1/bot/links — bog'langan chatlar (Sozlamalar uchun) */
  links = async (req, res) => {
    const rows = await BotLinkModel.findAll({
      where: { chat_id: { [Op.not]: null } },
      attributes: ['id', 'chat_id', 'chat_name', 'active', 'daily', 'last_seen', 'created_at'],
      order: [['id', 'DESC']],
    })
    res.json(rows)
  }

  /** DELETE /api/v1/bot/links/:id — bog'lanishni uzish */
  unlink = async (req, res) => {
    const link = await BotLinkModel.findByPk(req.params.id)
    if (!link) throw new HttpException(404, 'Bog\'lanish topilmadi')
    await link.destroy()
    res.json({ ok: true })
  }

  /** GET /api/v1/bot/daily-targets — kunlik xabar kerak bo'lgan chatlar */
  dailyTargets = async (req, res) => {
    const rows = await BotLinkModel.findAll({
      where: { chat_id: { [Op.not]: null }, active: true, daily: true },
      attributes: ['chat_id'],
      raw: true,
    })
    res.json({ shop: config.db_name, chats: rows.map(r => r.chat_id) })
  }
}

module.exports = new BotController()
