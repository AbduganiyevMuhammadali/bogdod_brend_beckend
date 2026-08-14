const { Op, fn, col, literal } = require('sequelize')
const sequelize        = require('../db/db-sequelize')
const ClientModel      = require('../models/client.model')
const ClientNoteModel  = require('../models/client_note.model')
const SaleModel        = require('../models/sale.model')
const HttpException    = require('../utils/HttpException.utils')

/**
 * Qarzdorlar bo'limi (CRM).
 *
 * Asosiy g'oya: mijozning qarzi bitta raqam emas — bir necha sotuvdan
 * yig'iladi va har birining o'z to'lash muddati bor. Shuning uchun
 * ro'yxat `sale` jadvalidan yig'iladi, `client.balance` esa faqat
 * umumiy nazorat uchun ishlatiladi.
 *
 * Kategoriyalar (muddat bo'yicha):
 *   kechikkan  — muddati o'tib ketgan
 *   bugun      — bugun to'lashi kerak
 *   hafta      — keyingi 7 kun ichida
 *   keyin      — 7 kundan keyin
 *   muddatsiz  — sana belgilanmagan
 */

// Sana yordamchilari — hammasi do'kon vaqt zonasida (lokal)
function bugunKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function kunQoshish(kunKey, n) {
  const d = new Date(kunKey)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Muddatga qarab kategoriya
function muddatToifasi(dueDate, bugun) {
  if (!dueDate) return 'muddatsiz'
  const d = String(dueDate).slice(0, 10)
  if (d < bugun) return 'kechikkan'
  if (d === bugun) return 'bugun'
  if (d <= kunQoshish(bugun, 7)) return 'hafta'
  return 'keyin'
}

// Qarz hajmiga qarab kategoriya
function hajmToifasi(sum) {
  const s = Number(sum) || 0
  if (s >= 5_000_000) return 'yirik'
  if (s >= 1_000_000) return 'orta'
  return 'kichik'
}

class DebtorController {

  /**
   * GET /api/v1/debtors
   *
   * Qarzi bor mijozlar ro'yxati — har biri bo'yicha jami qarz, eng
   * yaqin muddat va kategoriyalar bilan.
   *
   * Filtrlar: ?muddat=bugun|kechikkan|hafta|keyin|muddatsiz
   *           ?hajm=yirik|orta|kichik
   *           ?status=faol|muammoli|ishonchli|qora
   *           ?teg=VIP
   *           ?search=ism yoki telefon
   */
  getAll = async (req, res) => {
    const bugun = bugunKey()

    // Qarzli sotuvlarni mijoz kesimida yig'amiz.
    // `debt_sum > 0` va bekor qilinmagan sotuvlar hisobga olinadi.
    const rows = await SaleModel.findAll({
      attributes: [
        'client_id',
        [fn('SUM', col('debt_sum')), 'qarz'],
        [fn('COUNT', col('id')),     'sotuvlar'],
        [fn('MIN', col('due_date')), 'eng_yaqin'],
        [fn('MAX', col('date')),     'oxirgi_sotuv'],
      ],
      where: {
        debt_sum: { [Op.gt]: 0 },
        client_id: { [Op.ne]: null },
        status: { [Op.ne]: 'cancelled' },
      },
      group: ['client_id'],
      raw: true,
    })

    if (!rows.length) return res.json({ data: [], jami: this._boshSanoq() })

    const ids = rows.map(r => r.client_id)
    const clients = await ClientModel.findAll({ where: { id: { [Op.in]: ids } } })
    const byId = new Map(clients.map(c => [c.id, c]))

    // Eslatmalar: har mijozning oxirgi izohi va kutilayotgan eslatmasi
    const [notes] = await sequelize.query(
      `SELECT n.client_id, n.text, n.kind, n.remind_at, n.created_at
         FROM client_note n
         JOIN (SELECT client_id, MAX(id) mx FROM client_note
                WHERE client_id IN (${ids.map(Number).join(',')})
                GROUP BY client_id) t
           ON t.mx = n.id`
    ).catch(() => [[]])
    const oxirgiIzoh = new Map((notes || []).map(n => [n.client_id, n]))

    // Bugungi/kechikkan eslatmalar soni
    const [remind] = await sequelize.query(
      `SELECT client_id, COUNT(*) n FROM client_note
        WHERE done = 0 AND remind_at IS NOT NULL AND remind_at <= ?
          AND client_id IN (${ids.map(Number).join(',')})
        GROUP BY client_id`,
      { replacements: [bugun] }
    ).catch(() => [[]])
    const eslatmaSoni = new Map((remind || []).map(r => [r.client_id, Number(r.n)]))

    let data = rows.map(r => {
      const c = byId.get(r.client_id)
      const qarz = Number(r.qarz) || 0
      const izoh = oxirgiIzoh.get(r.client_id)
      return {
        clientId:   r.client_id,
        name:       c?.name || 'Nomsiz',
        phone:      c?.phone || '',
        address:    c?.address || '',
        status:     c?.status || 'faol',
        tags:       Array.isArray(c?.tags) ? c.tags : [],
        qarz,
        sotuvlar:   Number(r.sotuvlar) || 0,
        dueDate:    r.eng_yaqin ? String(r.eng_yaqin).slice(0, 10) : null,
        oxirgiSotuv: r.oxirgi_sotuv,
        muddat:     muddatToifasi(r.eng_yaqin, bugun),
        hajm:       hajmToifasi(qarz),
        kechikkanKun: r.eng_yaqin && String(r.eng_yaqin).slice(0, 10) < bugun
          ? Math.round((new Date(bugun) - new Date(String(r.eng_yaqin).slice(0, 10))) / 86400000)
          : 0,
        oxirgiIzoh: izoh ? { text: izoh.text, kind: izoh.kind, at: izoh.created_at } : null,
        eslatmalar: eslatmaSoni.get(r.client_id) || 0,
      }
    })

    // Jami sanoq — filtrdan OLDIN hisoblanadi, chunki yorliqlardagi
    // raqamlar filtr tanlanganda ham o'zgarmasligi kerak
    const jami = this._sanoq(data)

    // ── Filtrlar ────────────────────────────────────────────────────
    const { muddat, hajm, status, teg, search } = req.query
    if (muddat && muddat !== 'all') data = data.filter(d => d.muddat === muddat)
    if (hajm   && hajm   !== 'all') data = data.filter(d => d.hajm === hajm)
    if (status && status !== 'all') data = data.filter(d => d.status === status)
    if (teg    && teg    !== 'all') data = data.filter(d => d.tags.includes(teg))
    if (search) {
      const q = String(search).trim().toLowerCase()
      data = data.filter(d =>
        d.name.toLowerCase().includes(q) || (d.phone || '').includes(q)
      )
    }

    // Saralash: kechikkanlar birinchi, keyin muddati yaqinlar
    const tartib = { kechikkan: 0, bugun: 1, hafta: 2, keyin: 3, muddatsiz: 4 }
    data.sort((a, b) => {
      const t = tartib[a.muddat] - tartib[b.muddat]
      if (t !== 0) return t
      return b.qarz - a.qarz          // bir toifada — kattaroq qarz oldinda
    })

    res.json({ data, jami, bugun })
  }

  /**
   * GET /api/v1/debtors/:id — bitta mijozning to'liq kartochkasi:
   * qarzlari (har biri muddati bilan), to'lov tarixi va izohlari.
   */
  getOne = async (req, res) => {
    const id = Number(req.params.id)
    const client = await ClientModel.findByPk(id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')

    const bugun = bugunKey()

    // Qarzli sotuvlar
    const sales = await SaleModel.findAll({
      where: {
        client_id: id,
        debt_sum: { [Op.gt]: 0 },
        status: { [Op.ne]: 'cancelled' },
      },
      order: [['due_date', 'ASC'], ['date', 'ASC']],
    })

    // To'lovlar tarixi
    const CashTransactionModel = require('../models/cash_transaction.model')
    const payments = await CashTransactionModel.findAll({
      where: { type: 'debt_payment', reference_id: id },
      order: [['date', 'DESC']],
      limit: 100,
    }).catch(() => [])

    const notes = await ClientNoteModel.findAll({
      where: { client_id: id },
      order: [['id', 'DESC']],
      limit: 100,
    })

    res.json({
      client: {
        id: client.id, name: client.name, phone: client.phone,
        address: client.address, balance: Number(client.balance) || 0,
        status: client.status || 'faol',
        tags: Array.isArray(client.tags) ? client.tags : [],
        comment: client.comment || '',
      },
      qarzlar: sales.map(s => ({
        id: s.id,
        docNumber: s.doc_number,
        date: s.date,
        total: Number(s.total_sum) || 0,
        debt: Number(s.debt_sum) || 0,
        dueDate: s.due_date ? String(s.due_date).slice(0, 10) : null,
        muddat: muddatToifasi(s.due_date, bugun),
      })),
      tolovlar: (payments || []).map(p => ({
        id: p.id, date: p.date,
        amount: Number(p.amount) || 0,
        paymentType: p.payment_type,
        description: p.description,
      })),
      izohlar: notes.map(n => ({
        id: n.id, text: n.text, kind: n.kind,
        remindAt: n.remind_at ? String(n.remind_at).slice(0, 10) : null,
        done: !!n.done, user: n.user_name,
        createdAt: n.created_at,
      })),
    })
  }

  /** PATCH /api/v1/debtors/:id — status va teglarni o'zgartirish */
  updateClient = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')

    const patch = {}
    if (req.body.status !== undefined) {
      const ok = ['faol', 'muammoli', 'ishonchli', 'qora']
      if (!ok.includes(req.body.status)) throw new HttpException(400, 'Noto\'g\'ri status')
      patch.status = req.body.status
    }
    if (req.body.tags !== undefined) {
      patch.tags = Array.isArray(req.body.tags)
        ? req.body.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20)
        : []
    }
    if (req.body.comment !== undefined) patch.comment = req.body.comment

    await client.update(patch)
    res.json({ ok: true, status: client.status, tags: client.tags })
  }

  /** PATCH /api/v1/debtors/sale/:saleId/due — sotuv muddatini o'zgartirish */
  updateDue = async (req, res) => {
    const sale = await SaleModel.findByPk(req.params.saleId)
    if (!sale) throw new HttpException(404, 'Sotuv topilmadi')
    if (Number(sale.debt_sum) <= 0) throw new HttpException(400, 'Bu sotuvda qarz yo\'q')

    const d = req.body.due_date || null
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpException(400, 'Sana formati noto\'g\'ri')

    await sale.update({ due_date: d })
    res.json({ ok: true, due_date: d })
  }

  // ── Eslatmalar (CRM izohlari) ─────────────────────────────────────

  /** POST /api/v1/debtors/:id/notes */
  addNote = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')

    const text = String(req.body.text || '').trim()
    if (!text) throw new HttpException(400, 'Izoh matni bo\'sh')

    const kinds = ['izoh', 'qongiroq', 'uchrashuv', 'vada']
    const note = await ClientNoteModel.create({
      client_id: client.id,
      text,
      kind: kinds.includes(req.body.kind) ? req.body.kind : 'izoh',
      remind_at: req.body.remind_at || null,
      user_id:   req.currentUser?.id ?? null,
      user_name: req.currentUser?.fullname || req.currentUser?.username || null,
    })
    res.status(201).json(note)
  }

  /** PATCH /api/v1/debtors/notes/:noteId — bajarildi deb belgilash */
  updateNote = async (req, res) => {
    const note = await ClientNoteModel.findByPk(req.params.noteId)
    if (!note) throw new HttpException(404, 'Izoh topilmadi')
    const patch = {}
    if (req.body.done !== undefined)      patch.done = !!req.body.done
    if (req.body.remind_at !== undefined) patch.remind_at = req.body.remind_at || null
    if (req.body.text !== undefined)      patch.text = String(req.body.text).trim()
    await note.update(patch)
    res.json(note)
  }

  /** DELETE /api/v1/debtors/notes/:noteId */
  removeNote = async (req, res) => {
    const note = await ClientNoteModel.findByPk(req.params.noteId)
    if (!note) throw new HttpException(404, 'Izoh topilmadi')
    await note.destroy()
    res.json({ ok: true })
  }

  /** GET /api/v1/debtors/reminders — bugungi va kechikkan eslatmalar */
  reminders = async (req, res) => {
    const bugun = bugunKey()
    const [rows] = await sequelize.query(
      `SELECT n.id, n.client_id, n.text, n.kind, n.remind_at, c.name, c.phone
         FROM client_note n JOIN client c ON c.id = n.client_id
        WHERE n.done = 0 AND n.remind_at IS NOT NULL AND n.remind_at <= ?
        ORDER BY n.remind_at ASC LIMIT 100`,
      { replacements: [bugun] }
    ).catch(() => [[]])

    res.json((rows || []).map(r => ({
      id: r.id, clientId: r.client_id, name: r.name, phone: r.phone,
      text: r.text, kind: r.kind,
      remindAt: String(r.remind_at).slice(0, 10),
      kechikkan: String(r.remind_at).slice(0, 10) < bugun,
    })))
  }

  // ── Ichki yordamchilar ────────────────────────────────────────────

  _boshSanoq() {
    return {
      hammasi: { n: 0, sum: 0 },
      kechikkan: { n: 0, sum: 0 }, bugun: { n: 0, sum: 0 },
      hafta: { n: 0, sum: 0 }, keyin: { n: 0, sum: 0 }, muddatsiz: { n: 0, sum: 0 },
      yirik: { n: 0, sum: 0 }, orta: { n: 0, sum: 0 }, kichik: { n: 0, sum: 0 },
      faol: { n: 0, sum: 0 }, muammoli: { n: 0, sum: 0 },
      ishonchli: { n: 0, sum: 0 }, qora: { n: 0, sum: 0 },
    }
  }

  _sanoq(data) {
    const s = this._boshSanoq()
    const qosh = (k, sum) => { if (s[k]) { s[k].n++; s[k].sum += sum } }
    for (const d of data) {
      s.hammasi.n++; s.hammasi.sum += d.qarz
      qosh(d.muddat, d.qarz)
      qosh(d.hajm, d.qarz)
      qosh(d.status, d.qarz)
    }
    return s
  }
}

module.exports = new DebtorController()
