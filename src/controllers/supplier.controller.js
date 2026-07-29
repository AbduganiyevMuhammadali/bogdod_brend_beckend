const { Op }               = require('sequelize')
const sequelize             = require('../db/db-sequelize')
const SupplierModel         = require('../models/supplier.model')
const PurchaseModel         = require('../models/purchase.model')
const CashTransactionModel  = require('../models/cash_transaction.model')

const HttpException         = require('../utils/HttpException.utils')
const BaseController        = require('./BaseController')

class SupplierController extends BaseController {

  getAll = async (req, res) => {
    const { search, active } = req.query
    const where = {}
    if (active !== undefined) where.active = active === 'true'
    if (search) {
      where[Op.or] = [
        { name:  { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { code:  { [Op.like]: `%${search}%` } },
      ]
    }
    const rows = await SupplierModel.findAll({ where, order: [['name', 'ASC']] })

    // Har bir supplier uchun haqiqiy balansni hisoblash va kerak bo'lsa sinxronlashtirish
    await Promise.all(rows.map(async (s) => {
      const purchased = await PurchaseModel.sum('total_sum', { where: { supplier_id: s.id, status: 'confirmed' } }) || 0
      const paid      = await CashTransactionModel.sum('amount', { where: { reference_type: 'supplier_payment', reference_id: s.id } }) || 0
      const computed  = paid - purchased
      if (Number(s.balance) !== computed) {
        await s.update({ balance: computed })
      }
      s.balance = computed
    }))

    res.json(rows)
  }

  getById = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    res.json(s)
  }

  create = async (req, res) => {
    const { name, phone, address, comment, code } = req.body
    if (!name) throw new HttpException(400, 'Yetkazuvchi ismi majburiy')
    const supplier = await SupplierModel.create({ name, phone, address, comment, code, balance: 0 })
    res.status(201).json(supplier)
  }

  update = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    const { name, phone, address, comment, code, active } = req.body
    await s.update({ name, phone, address, comment, code, active })
    res.json(s)
  }

  delete = async (req, res) => {
    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))
    // Allow delete only if no debt
    if (Number(s.balance) < 0) throw new HttpException(400, 'Qarzli yetkazuvchini o\'chirib bo\'lmaydi')
    await s.destroy()
    res.json({ message: req.mf('data has been deleted') })
  }

  // POST /suppliers/:id/pay  — yetkazuvchiga qarz to'lovi
  pay = async (req, res) => {
    const { amount, payment_type = 'Naqd', purchase_id, comment } = req.body
    const amt        = Number(amount)
    const safePayType = ['Naqd', 'Karta', "O'tkazma"].includes(payment_type) ? payment_type : 'Naqd'
    if (!amt || amt <= 0) throw new HttpException(400, 'Summa noto\'g\'ri')

    const s = await SupplierModel.findByPk(req.params.id)
    if (!s) throw new HttpException(404, req.mf('data not found'))

    // Balansni entries dan hisoblash (ishonchli)
    const purchasesTotal = await PurchaseModel.sum('total_sum', { where: { supplier_id: s.id, status: 'confirmed' } }) || 0
    const paymentsTotal  = await CashTransactionModel.sum('amount', { where: { reference_type: 'supplier_payment', reference_id: s.id } }) || 0
    const trueBalance    = paymentsTotal - purchasesTotal
    const debt = Math.abs(Math.min(0, trueBalance))
    if (amt > debt + 0.01) throw new HttpException(400, `Qarz miqdoridan ko'p to'lab bo'lmaydi. Qarz: ${debt}`)

    const now       = new Date()
    const cashierId = req.currentUser?.id ?? null
    const desc      = comment || `Yetkazuvchi to'lovi: ${s.name}`

    await sequelize.transaction(async (t) => {
      // 1. Supplier balansini yangi haqiqiy qiymat bilan yangilash
      await s.update({ balance: trueBalance + amt }, { transaction: t })

      // 2. cash_transaction — expense, reference_id = supplier.id (ledger query shu bo'yicha qidiradi)
      await CashTransactionModel.create({
        date:           now,
        type:           'expense',
        amount:         amt,
        payment_type:   safePayType,
        reference_id:   s.id,
        reference_type: 'supplier_payment',
        description:    desc,
        cashier_id:     cashierId,
      }, { transaction: t })
    })

    const updated = await SupplierModel.findByPk(s.id)
    res.json(updated)
  }

  // GET /suppliers/:id/purchases — shu yetkazuvchining xaridlari
  getPurchases = async (req, res) => {
    const rows = await PurchaseModel.findAll({
      where:  { supplier_id: req.params.id },
      order:  [['date', 'DESC']],
      limit:  50,
    })
    res.json(rows)
  }

  // GET /suppliers/:id/ledger — oldi-berdi tarixi
  getLedger = async (req, res) => {
    const id = req.params.id
    const s  = await SupplierModel.findByPk(id)
    if (!s) throw new HttpException(404, req.mf('data not found'))

    // 1. Barcha tasdiqlangan kirimlar
    const purchases = await PurchaseModel.findAll({
      where: { supplier_id: id, status: 'confirmed' },
      order: [['date', 'ASC']],
    })

    // 2. Ushbu yetkazuvchiga qilingan to'lovlar (supplier_id orqali)
    const payments = await CashTransactionModel.findAll({
      where: {
        reference_type: 'supplier_payment',
        reference_id:   id,
      },
      order: [['date', 'ASC']],
    })

    // 3. Xronologik ro'yxat
    const entries = []

    purchases.forEach(p => {
      entries.push({
        id:            `purchase-${p.id}`,
        type:          'purchase',
        date:          p.date,
        doc_number:    p.doc_number,
        description:   `Kirim #${p.doc_number}`,
        payment_type:  p.payment_type,
        total_sum:     Number(p.total_sum)     || 0,
        total_usd:     Number(p.total_usd)     || 0,
        exchange_rate: Number(p.exchange_rate) || 11000,
        debit:         Number(p.total_sum)     || 0,
        credit:        0,
        warehouse:     p.warehouse,
        status:        p.status,
      })
    })

    payments.forEach(p => {
      entries.push({
        id:           `payment-${p.id}`,
        type:         'payment',
        date:         p.date,
        description:  p.description || "Yetkazuvchiga to'lov",
        payment_type: p.payment_type,
        total_sum:    Number(p.amount) || 0,
        debit:        0,
        credit:       Number(p.amount) || 0,
      })
    })

    entries.sort((a, b) => new Date(a.date) - new Date(b.date))

    // 4. Running balance hisoblash va haqiqiy balansni topish
    let computedBalance = 0
    entries.forEach(e => {
      if (e.type === 'purchase') computedBalance -= e.debit
      else if (e.type === 'payment') computedBalance += e.credit
      e.running_balance = computedBalance
    })

    // 5. Agar supplier.balance entries dan farq qilsa — to'g'irla
    if (Number(s.balance) !== computedBalance) {
      await s.update({ balance: computedBalance })
    }

    res.json({
      supplier: { ...s.toJSON(), balance: computedBalance },
      entries:  entries.reverse(),
      balance:  computedBalance,
    })
  }
}

module.exports = new SupplierController()
