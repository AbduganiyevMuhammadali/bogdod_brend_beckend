const { Op } = require('sequelize')
const ClientModel          = require('../models/client.model')
const SaleModel            = require('../models/sale.model')
const SaleItemModel        = require('../models/sale_item.model')
const CashTransactionModel = require('../models/cash_transaction.model')
const HttpException        = require('../utils/HttpException.utils')

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

    // Merge and sort by date
    const entries = []
    for (const s of sales) {
      entries.push({
        id:           `sale-${s.id}`,
        type:         'sale',
        date:         s.date,
        description:  `#KRM-${String(s.doc_number ?? s.id).padStart(5, '0')} — Sotuv`,
        payment_type: s.payment_type,
        debit:        Number(s.total_sum) || 0,
        credit:       Number(s.paid_sum)  || 0,
        debt:         Number(s.debt_sum)  || 0,
        status:       s.status,
        items_count:  s.items?.length ?? 0,
        sale_id:      s.id,
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

    entries.sort((a, b) => new Date(a.date) - new Date(b.date))

    // Compute running balance (negative = owes)
    let running = 0
    for (const e of entries) {
      if (e.status === 'cancelled') {
        e.running_balance = running
        continue
      }
      if (e.type === 'sale') {
        running -= e.debt  // on credit portion only
      } else {
        running += e.credit
      }
      e.running_balance = running
    }

    // Recompute balance from DB to be authoritative
    const totalDebt = sales
      .filter(s => s.status !== 'cancelled')
      .reduce((s, x) => s + (Number(x.debt_sum) || 0), 0)
    const totalPaid = payments.reduce((s, x) => s + (Number(x.amount) || 0), 0)
    const computedBalance = totalPaid - totalDebt

    // Sync if diverged
    if (Math.round(computedBalance) !== Math.round(Number(client.balance))) {
      await client.update({ balance: computedBalance })
      client.balance = computedBalance
    }

    res.json({
      client:  client,
      entries: entries.reverse(), // newest first
      totalSales:   sales.filter(s => s.status !== 'cancelled').reduce((s, x) => s + (Number(x.total_sum) || 0), 0),
      totalPaid,
      totalDebt,
      balance: computedBalance,
    })
  }

  create = async (req, res) => {
    const count = await ClientModel.count()
    const code  = `C-${String(count + 1).padStart(4, '0')}`
    const client = await ClientModel.create({ ...req.body, code })
    res.status(201).json(client)
  }

  update = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Topilmadi')
    await client.update(req.body)
    res.json(client)
  }

  remove = async (req, res) => {
    const client = await ClientModel.findByPk(req.params.id)
    if (!client) throw new HttpException(404, 'Topilmadi')
    await client.destroy()
    res.json({ message: "O'chirildi" })
  }
}

module.exports = new ClientController()
