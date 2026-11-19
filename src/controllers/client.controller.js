const { Op } = require('sequelize')
const ClientModel          = require('../models/client.model')
const SaleModel            = require('../models/sale.model')
const SaleItemModel        = require('../models/sale_item.model')
const CashTransactionModel = require('../models/cash_transaction.model')
const HttpException        = require('../utils/HttpException.utils')
const { syncClientDebt, r2 } = require('../utils/clientDebt.utils')

// Mijoz kartochkasidan o'zgartirish mumkin bo'lgan maydonlar.
// `balance` YO'Q — u sotuv va to'lovlardan hisoblanadi (clientDebt.utils),
// qo'lda yozilsa nasiya hisobi buziladi. `branch_id` ham hook orqali qo'yiladi.
const FIELDS = ['name', 'phone', 'address', 'comment', 'active', 'status', 'tags']
function pick(body = {}) {
  const out = {}
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f]
  if (out.name !== undefined) out.name = String(out.name || '').trim()
  return out
}

class ClientController {

  getAll = async (req, res) => {
    const { search, active, page = 1, limit = 100 } = req.query
    const where = {}
    if (active !== undefined && active !== 'all') where.active = active === 'true'
    if (search) {
      where[Op.or] = [
        { name:  { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { code:  { [Op.like]: `%${search}%` } },
      ]
    }
    const offset = (Number(page) - 1) * Number(limit)
    const { count, rows } = await ClientModel.findAndCountAll({
      where, order: [['name', 'ASC']], limit: Number(limit), offset,
    })
    res.json({ total: count, data: rows })
  }

  getById = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Topilmadi')
    res.json(client)
  }

  getHistory = async (req, res) => {
    const { page = 1, limit = 30 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const { count, rows } = await SaleModel.findAndCountAll({
      where:   { client_id: req.params.id, status: 'completed' },
      order:   [['date', 'DESC']],
      limit:   Number(limit),
      offset,
      include: [{ model: SaleItemModel, as: 'items', attributes: ['id'] }],
    })
    res.json({ total: count, data: rows })
  }

  // Full ledger: all sales + debt payments for a client
  getLedger = async (req, res) => {
    const id = Number(req.params.id)
    const client = await ClientModel.findByPk(id)
    if (!client) throw new HttpException(404, 'Topilmadi')

    // Sales (debit entries)
    const sales = await SaleModel.findAll({
      where:   { client_id: id },
      order:   [['date', 'ASC']],
      include: [{ model: SaleItemModel, as: 'items', attributes: ['id'] }],
    })

    // Debt payment cash transactions (credit entries)
    const payments = await CashTransactionModel.findAll({
      where: { client_id: id, type: 'debt_payment' },
      order: [['date', 'ASC']],
    })
    // Naqd qaytarishlar — balansga ta'sir qilmaydi (pul kassadan qaytdi),
    // lekin tarixda ko'rinishi kerak
    const refunds = await CashTransactionModel.findAll({
      where: { client_id: id, type: 'refund' },
      order: [['date', 'ASC']],
    }).catch(() => [])

    // Merge and sort by date
    const entries = []
    for (const s of sales) {
      entries.push({
        id:           `sale-${s.id}`,
        type:         'sale',
        date:         s.date,
        description:  `#KRM-${String(s.doc_number ?? s.id).padStart(5, '0')} — Sotuv`,
        payment_type: s.payment_type,
        // Chegirmadan keyingi haqiqiy summa
        debit:        r2(Number(s.total_sum) - Number(s.discount)),
        credit:       Number(s.paid_sum)  || 0,
        debt:         Number(s.debt_sum)  || 0,
        debt_paid:    Number(s.debt_paid) || 0,
        returned:     Number(s.returned_sum) || 0,
        status:       s.status,
        items_count:  s.items?.length ?? 0,
        sale_id:      s.id,
      })
    }
    for (const r of refunds) {
      entries.push({
        id:           `refund-${r.id}`,
        type:         'refund',
        date:         r.date,
        description:  r.description || 'Qaytarish (naqd)',
        payment_type: r.payment_type,
        debit:        0,
        credit:       0,
        refund:       Number(r.amount) || 0,
        debt:         0,
        status:       'completed',
        items_count:  0,
        sale_id:      r.reference_id ?? null,
      })
    }
    for (const p of payments) {
      entries.push({
        id:           `pay-${p.id}`,
        type:         'payment',
        date:         p.date,
        description:  p.description || "Qarz to'lovi",
        payment_type: p.payment_type,
        debit:        0,
        credit:       Number(p.amount) || 0,
        debt:         0,
        status:       'completed',
        items_count:  0,
      })
    }

    entries.sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)))

    // Compute running balance (negative = owes)
    let running = 0
    for (const e of entries) {
      if (e.status === 'cancelled' || e.type === 'refund') {
        e.running_balance = running
        continue
      }
      if (e.type === 'sale') {
        running = r2(running - e.debt)  // on credit portion only
      } else {
        running = r2(running + e.credit)
      }
      e.running_balance = running
    }

    // Balans yagona qoida bo'yicha (clientDebt.utils) — farq bo'lsa tuzatiladi
    const hisob = await syncClientDebt(id)
    client.balance = hisob.balance

    const live = sales.filter(s => s.status !== 'cancelled')
    res.json({
      client:  client,
      entries: entries.reverse(), // newest first
      totalSales: r2(live.reduce((s, x) => s + (Number(x.total_sum) - Number(x.discount)), 0)),
      totalPaid:  hisob.tolangan,
      totalDebt:  r2(live.reduce((s, x) => s + (Number(x.debt_sum) || 0), 0)),
      totalRefunded: r2(refunds.reduce((s, x) => s + (Number(x.amount) || 0), 0)),
      balance: hisob.balance,
      qarz:    hisob.qarz,
      kredit:  hisob.kredit,
    })
  }

  create = async (req, res) => {
    const data = pick(req.body)
    if (!data.name) throw new HttpException(400, 'Mijoz ismi kiritilishi shart')
    // Kod filial ichida ketma-ket. count() o'chirilganlarni sanamaydi —
    // band kod bo'lsa keyingisiga o'tamiz.
    let n = await ClientModel.count()
    let code
    do { code = `C-${String(++n).padStart(4, '0')}` }
    while (await ClientModel.findOne({ where: { code }, attributes: ['id'] }))
    const client = await ClientModel.create({ ...data, code, balance: 0 })
    res.status(201).json(client)
  }

  update = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Topilmadi')
    const data = pick(req.body)
    if (data.name !== undefined && !data.name) throw new HttpException(400, 'Mijoz ismi bo\'sh bo\'lmasin')
    await client.update(data)
    res.json(client)
  }

  remove = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Topilmadi')
    // Qarzi yoki sotuv tarixi bor mijoz o'chirilmaydi — qarz "havoda"
    // qolib ketardi (sale.client_id NULL bo'lib qoladi). Faolsiz qilish mumkin.
    const hisob = await syncClientDebt(client.id)
    if (hisob.qarz > 0 || hisob.kredit > 0) {
      throw new HttpException(409, `Mijozda ${hisob.qarz > 0 ? 'qarz' : 'kredit'} bor — o'chirib bo'lmaydi. Faolsiz qiling.`)
    }
    const sotuvlar = await SaleModel.count({ where: { client_id: client.id } })
    if (sotuvlar > 0) {
      await client.update({ active: false })
      return res.json({ message: 'Mijozning sotuv tarixi bor — faolsiz qilindi', arxiv: true })
    }
    await client.destroy()
    res.json({ message: "O'chirildi" })
  }
}

module.exports = new ClientController()
