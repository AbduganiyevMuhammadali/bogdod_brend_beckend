const { Op } = require('sequelize')
const SaleModel             = require('../models/sale.model')
const SaleItemModel         = require('../models/sale_item.model')
const ProductModel          = require('../models/product.model')
const PurchaseModel         = require('../models/purchase.model')
const PurchaseItemModel     = require('../models/purchase_item.model')
const ClientModel           = require('../models/client.model')
const CashTransactionModel  = require('../models/cash_transaction.model')
const ProductRegisterModel  = require('../models/product_register.model')
const KassaRegisterModel    = require('../models/kassa_register.model')
const HttpException         = require('../utils/HttpException.utils')
const { dateRange }         = require('../utils/dateRange.utils')
const { barcodeVariants }   = require('../utils/barcode.utils')

class SaleController {

  // ── List ──────────────────────────────────────────────────────
  getAll = async (req, res) => {
    const { search, status, client_id, date_from, date_to, page = 1, limit = 50 } = req.query
    const where = {}
    if (status    && status !== 'all') where.status    = status
    if (client_id && client_id !== 'all') where.client_id = client_id
    // Kun chegarasi mahalliy vaqtda — ilgari `new Date('2026-08-06')`
    // UTC yarim tuni deb o'qilib, filtr soat 05:00 dan boshlanardi va
    // tongdagi savdolar tushib qolardi.
    const dr = dateRange(Op, date_from, date_to)
    if (dr) where.date = dr
    // Qidiruv: mijoz nomi, hujjat raqami, TOVAR NOMI va SHTRIX-KOD.
    //
    // Qaytarishlarda kassir odatda tovarni qo'lida ushlab turadi va uning
    // yorlig'ini skanerlaydi — shuning uchun shtrix-kod bo'yicha o'sha
    // tovar sotilgan hujjatni topa olish kerak.
    //
    // Shtrix-kod skanerdan boshidagi nol tushib kelishi mumkin, shuning
    // uchun barcha shakllari bo'yicha qidiramiz (barcodeVariants).
    if (search) {
      const q = String(search).trim()
      const kodlar = barcodeVariants(q)

      // Tovar satrlari bo'yicha mos keladigan sotuvlarni topamiz
      const items = await SaleItemModel.findAll({
        attributes: ['sale_id'],
        where: {
          [Op.or]: [
            { product_name: { [Op.like]: `%${q}%` } },
            ...kodlar.map(k => ({ barcode: k })),
          ],
        },
        group: ['sale_id'],
        raw: true,
        limit: 500,
      }).catch(() => [])
      const saleIdsByItem = items.map(i => i.sale_id).filter(Boolean)

      // Mijozlarni ham oldindan topamiz.
      //
      // `$client.name$` ishlatib bo'lmaydi: `findAndCountAll` + `limit`
      // bilan Sequelize alohida COUNT so'rovini JOIN'siz yasaydi va
      // "Unknown column 'client.name'" xatosi chiqadi. Shuning uchun
      // mijoz id'larini alohida so'rov bilan olamiz.
      const clients = await ClientModel.findAll({
        attributes: ['id'],
        where: { name: { [Op.like]: `%${q}%` } },
        raw: true,
        limit: 200,
      }).catch(() => [])
      const clientIds = clients.map(c => c.id)

      where[Op.or] = [
        { doc_number: isNaN(q) ? -1 : Number(q) },
        ...(clientIds.length    ? [{ client_id: { [Op.in]: clientIds } }]  : []),
        ...(saleIdsByItem.length ? [{ id: { [Op.in]: saleIdsByItem } }]    : []),
      ]
    }

    const offset = (Number(page) - 1) * Number(limit)
    const { count, rows } = await SaleModel.findAndCountAll({
      where,
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit: Number(limit),
      offset,
      include: [
        { model: ClientModel,   as: 'client',  attributes: ['id', 'name', 'phone'] },
        { model: SaleItemModel, as: 'items',   attributes: ['id'] },
      ],
    })

    res.json({
      total: count,
      page: Number(page),
      data: rows,
      // Qidiruv shtrix-kod/tovar bo'yicha mos kelganini frontend biladi —
      // topilgan hujjatni darhol ochib, o'sha tovarni belgilab bera oladi
      matched_query: search ? String(search).trim() : null,
    })
  }

  getById = async (req, res) => {
    const sale = await SaleModel.findOne({
      where:   { id: req.params.id },
      include: [
        { model: ClientModel,   as: 'client' },
        { model: SaleItemModel, as: 'items'  },
      ],
    })
    if (!sale) throw new HttpException(404, 'Topilmadi')

    // Enrich with cashier name from kassa_register
    const kassa = await KassaRegisterModel.findOne({
      where:      { sale_id: sale.id },
      attributes: ['cashier_id', 'cashier_name'],
    })
    const result = sale.toJSON()
    result.cashier_name = kassa?.cashier_name ?? null
    result.cashier_id   = kassa?.cashier_id   ?? null

    res.json(result)
  }

  getNextDocNumber = async (req, res) => {
    const max = await SaleModel.max('doc_number')
    res.json({ doc_number: (Number(max) || 0) + 1 })
  }

  // ── Complete sale (main POS action) ──────────────────────────
  complete = async (req, res) => {
    const { items = [], ...header } = req.body
    if (!items.length) throw new HttpException(400, 'Savat bo\'sh')

    if (!header.date) header.date = new Date()
    if (!header.doc_number) {
      const max = await SaleModel.max('doc_number')
      header.doc_number = (Number(max) || 0) + 1
    }
    header.cashier_id = req.currentUser?.id ?? null

    // Exchange rate: sent from frontend settings, fallback 0 (= so'm only)
    const rate = Number(header.exchange_rate) || 0

    // Calculate totals
    const totalSum  = items.reduce((s, i) => s + Number(i.total_sum), 0)
    const discount  = Number(header.discount) || 0
    const paidSum   = header.payment_type === 'Qarz' ? 0 : (totalSum - discount)
    const debtSum   = header.payment_type === 'Qarz' ? (totalSum - discount) : 0
    const toUSD     = v => rate > 0 ? +(v / rate).toFixed(4) : 0

    header.total_sum    = totalSum
    header.paid_sum     = paidSum
    header.debt_sum     = debtSum
    header.exchange_rate = rate
    header.total_usd    = toUSD(totalSum)
    header.discount_usd = toUSD(discount)
    header.paid_usd     = toUSD(paidSum)
    header.debt_usd     = toUSD(debtSum)
    header.status       = 'completed'

    // Qarz muddati — faqat qarzli sotuvda saqlanadi. Naqd sotuvga
    // muddat kelib qolsa (eski oynadan), uni tashlab yuboramiz.
    header.due_date = debtSum > 0 && header.due_date ? header.due_date : null

    const sale = await SaleModel.create(header)

    const cashierName = req.currentUser?.fullname ?? req.currentUser?.username ?? null

    // Chegirma butun chekka beriladi, foyda esa har mahsulot bo'yicha
    // hisoblanadi. Shuning uchun chegirmani satrlar orasida ularning
    // summasiga proporsional taqsimlaymiz.
    //
    // Busiz `product_register` ga chegirmasiz narx tushib, foyda
    // hisobotida haqiqiydan katta foyda ko'rinardi (chegirma 99% ga
    // yetganda farq juda katta bo'lardi).
    const discountRatio = totalSum > 0 ? Math.min(discount / totalSum, 1) : 0

    // Process items: FIFO deduction + SaleItem creation
    // fifoMap stores deductions per SaleItem id for ProductRegister
    const saleItemsFifo = []
    for (const item of items) {
      let deductions = []   // [{batchId, qty, costPrice}]

      if (item.product_id) {
        deductions = await this._applyFIFO(item.product_id, Number(item.qty))
        const product = await ProductModel.findByPk(item.product_id)
        if (product) {
          // Clamp yo'q: qoldiq manfiyga tushishi mumkin — bekor qilishda to'liq qaytadi
          // (aks holda oversell + cancel fantom zaxira yaratadi)
          await product.update({ qty: Number(product.qty) - Number(item.qty) })
        }
      }

      // Weighted average cost_price for the SaleItem row
      const totalQty  = deductions.reduce((s, d) => s + d.qty, 0)
      const totalCost = deductions.reduce((s, d) => s + d.qty * d.costPrice, 0)
      const avgCost   = totalQty > 0 ? totalCost / totalQty : 0

      const created = await SaleItemModel.create({
        sale_id:          sale.id,
        product_id:       item.product_id ?? null,
        purchase_item_id: deductions[0]?.batchId ?? null,
        barcode:          item.barcode ?? null,
        product_name:     item.product_name || item.name || '',
        qty:              item.qty,
        price:            item.price,
        price_usd:        rate > 0 ? +(Number(item.price) / rate).toFixed(4) : 0,
        cost_price:       avgCost,
        total_sum:        item.total_sum,
        total_usd:        rate > 0 ? +(Number(item.total_sum) / rate).toFixed(4) : 0,
        price_type:       header.price_type || 'chakana',
      })
      saleItemsFifo.push({ item: created, deductions })
    }

    // ProductRegister — one row per FIFO batch portion (accurate cost per batch)
    for (const { item, deductions } of saleItemsFifo) {
      // Chegirmadan keyingi haqiqiy narx. `item` bu yerda saqlangan
      // SaleItem (yuqoridagi sikldagi kirish satri emas), shuning uchun
      // narxni shu yerda qaytadan hisoblaymiz.
      const netPrice = +(Number(item.price) * (1 - discountRatio)).toFixed(4)

      const regBase = {
        date:         header.date,
        sale_id:      sale.id,
        doc_number:   header.doc_number,
        warehouse:    header.warehouse || 'Asosiy ombor',
        product_id:   item.product_id ?? null,
        product_name: item.product_name,
        barcode:      item.barcode ?? null,
        // Chegirmadan keyingi haqiqiy narx — hisobotdagi "o'rtacha narx"
        // shu ustundan olinadi
        price:        netPrice,
        price_type:   header.price_type || 'chakana',
        cashier_id:   header.cashier_id,
        cashier_name: cashierName,
        status:       'active',
      }

      // `total_sum` — chegirmadan KEYINGI summa. Foyda hisoboti aynan
      // shu ustundan hisoblanadi, shuning uchun bu yerga chegirmasiz
      // narx yozilsa foyda soxta katta chiqadi.
      if (deductions.length > 0) {
        for (const d of deductions) {
          await ProductRegisterModel.create({
            ...regBase,
            purchase_item_id: d.batchId,
            qty:        d.qty,
            cost_price: d.costPrice,
            total_sum:  +(netPrice * d.qty).toFixed(2),
          })
        }
      } else {
        // No batch found (product has no confirmed purchases) — record with 0 cost
        await ProductRegisterModel.create({
          ...regBase,
          purchase_item_id: null,
          qty:        item.qty,
          cost_price: 0,
          total_sum:  +(Number(item.total_sum) * (1 - discountRatio)).toFixed(2),
        })
      }
    }

    // Record kassa_register — one row per sale
    await KassaRegisterModel.create({
      date:          header.date,
      sale_id:       sale.id,
      doc_number:    header.doc_number,
      warehouse:     header.warehouse || 'Asosiy ombor',
      payment_type:  header.payment_type,
      price_type:    header.price_type || 'chakana',
      total_sum:     totalSum,
      paid_sum:      paidSum,
      debt_sum:      debtSum,
      discount:      discount,
      item_count:    items.length,
      client_id:     header.client_id ?? null,
      client_name:   header.client_id ? (await ClientModel.findByPk(header.client_id))?.name ?? null : null,
      cashier_id:    header.cashier_id,
      cashier_name:  cashierName,
      status:        'completed',
      exchange_rate: rate,
      total_usd:     toUSD(totalSum),
    })

    // Record cash transaction
    if (paidSum > 0) {
      await CashTransactionModel.create({
        date:           header.date,
        type:           'sale',
        amount:         paidSum,
        payment_type:   ['Naqd', 'Karta', "O'tkazma"].includes(header.payment_type)
                          ? header.payment_type : 'Naqd',
        reference_id:   sale.id,
        reference_type: 'sale',
        client_id:      header.client_id ?? null,
        description:    `Sotuv #${header.doc_number}`,
        cashier_id:     header.cashier_id,
        exchange_rate:  rate,
        amount_usd:     toUSD(paidSum),
      })
    }

    // Update client balance (debt)
    if (header.client_id && debtSum > 0) {
      const client = await ClientModel.findByPk(header.client_id)
      if (client) {
        await client.update({ balance: Number(client.balance) - debtSum })
      }
    }

    const result = await SaleModel.findOne({
      where:   { id: sale.id },
      include: [
        { model: ClientModel,   as: 'client' },
        { model: SaleItemModel, as: 'items'  },
      ],
    })
    res.status(201).json(result)
  }

  // ── Cancel ────────────────────────────────────────────────────
  cancel = async (req, res) => {
    const sale = await SaleModel.findOne({
      where:   { id: req.params.id },
      include: [{ model: SaleItemModel, as: 'items' }],
    })
    if (!sale) throw new HttpException(404, 'Topilmadi')
    if (sale.status === 'cancelled') throw new HttpException(400, 'Allaqachon bekor')

    // Reverse stock: restore product.qty and per-batch sold_qty via ProductRegister
    for (const item of sale.items) {
      if (!item.product_id) continue
      const product = await ProductModel.findByPk(item.product_id)
      if (product) {
        await product.update({ qty: Number(product.qty) + Number(item.qty) })
      }
    }

    // Restore sold_qty on every batch that was consumed (read from ProductRegister)
    const regRows = await ProductRegisterModel.findAll({
      where: { sale_id: sale.id, status: 'active' },
      attributes: ['purchase_item_id', 'qty'],
    })
    for (const reg of regRows) {
      if (!reg.purchase_item_id) continue
      const batch = await PurchaseItemModel.findByPk(reg.purchase_item_id)
      if (batch) {
        await batch.update({ sold_qty: Math.max(0, Number(batch.sold_qty) - Number(reg.qty)) })
      }
    }

    // Reverse client balance
    if (sale.client_id && sale.debt_sum > 0) {
      const client = await ClientModel.findByPk(sale.client_id)
      if (client) await client.update({ balance: Number(client.balance) + Number(sale.debt_sum) })
    }

    // Mark registers as reversed/cancelled
    await ProductRegisterModel.update({ status: 'reversed' }, { where: { sale_id: sale.id } })
    await KassaRegisterModel.update(  { status: 'cancelled' }, { where: { sale_id: sale.id } })

    await sale.update({ status: 'cancelled' })
    res.json(sale)
  }

  // ── Cash report ───────────────────────────────────────────────
  getCashReport = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = {}
    // Kun chegarasi mahalliy vaqtda — ilgari `new Date('2026-08-06')`
    // UTC yarim tuni deb o'qilib, filtr soat 05:00 dan boshlanardi va
    // tongdagi savdolar tushib qolardi.
    const dr = dateRange(Op, date_from, date_to)
    if (dr) where.date = dr

    const txns = await CashTransactionModel.findAll({
      where,
      order: [['date', 'DESC']],
      include: [{ model: ClientModel, as: 'client', attributes: ['id', 'name'], required: false }],
    })

    const summary    = { income: 0, expense: 0, sale: 0, refund: 0, debt_payment: 0, net: 0 }
    const summaryUSD = { income: 0, expense: 0, sale: 0, refund: 0, debt_payment: 0, net: 0 }

    txns.forEach(t => {
      const amt    = Number(t.amount)
      const amtUSD = Number(t.amount_usd) || 0
      if (t.type in summary) {
        summary[t.type]    += amt
        summaryUSD[t.type] += amtUSD
      }
      if (['income', 'sale', 'debt_payment'].includes(t.type)) {
        summary.net    += amt
        summaryUSD.net += amtUSD
      } else if (['expense', 'refund'].includes(t.type)) {
        summary.net    -= amt
        summaryUSD.net -= amtUSD
      }
    })

    res.json({ transactions: txns, summary, summaryUSD })
  }

  // ── Product report (inventory by batch) ──────────────────────
  getProductReport = async (req, res) => {
    const { search } = req.query
    const where = {}
    if (search) where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { code: { [Op.like]: `%${search}%` } },
    ]

    const products = await ProductModel.findAll({
      where,
      order: [['name', 'ASC']],
      attributes: ['id', 'code', 'name', 'qty', 'retail_price', 'wholesale_price', 'unit'],
    })

    res.json(products)
  }

  // ── Debt payment ──────────────────────────────────────────────
  payDebt = async (req, res) => {
    const { client_id, amount, payment_type = 'Naqd', description, exchange_rate } = req.body
    if (!client_id || !(Number(amount) > 0)) throw new HttpException(400, "client_id va musbat amount kerak")

    const client = await ClientModel.findByPk(client_id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')

    const paidAmount   = Number(amount)
    const rate         = Number(exchange_rate) || 0
    const safePayType  = ['Naqd', 'Karta', "O'tkazma"].includes(payment_type) ? payment_type : 'Naqd'
    const cashierId    = req.currentUser?.id ?? null
    const cashierName  = req.currentUser?.fullname ?? req.currentUser?.username ?? null
    const now          = new Date()

    await client.update({ balance: Number(client.balance) + paidAmount })

    await CashTransactionModel.create({
      date:           now,
      type:           'debt_payment',
      amount:         paidAmount,
      payment_type:   safePayType,
      client_id,
      description:    description || `${client.name} — qarz to'lovi`,
      cashier_id:     cashierId,
      exchange_rate:  rate,
      amount_usd:     rate > 0 ? +(paidAmount / rate).toFixed(4) : 0,
    })

    await KassaRegisterModel.create({
      date:          now,
      sale_id:       null,
      doc_number:    null,
      warehouse:     'Asosiy ombor',
      payment_type:  safePayType,
      price_type:    'chakana',
      total_sum:     0,
      paid_sum:      paidAmount,
      debt_sum:      0,
      discount:      0,
      item_count:    0,
      client_id,
      client_name:   client.name,
      cashier_id:    cashierId,
      cashier_name:  cashierName,
      status:        'completed',
      exchange_rate: rate,
      total_usd:     rate > 0 ? +(paidAmount / rate).toFixed(4) : 0,
    })

    res.json({ client, message: 'Qarz qayd etildi' })
  }

  // ── Cash entry (income / expense) ────────────────────────────
  cashEntry = async (req, res) => {
    const { type, amount, payment_type = 'Naqd', description, exchange_rate } = req.body
    if (!['income', 'expense'].includes(type)) throw new HttpException(400, "type: 'income' yoki 'expense' bo'lishi kerak")
    if (!amount || Number(amount) <= 0) throw new HttpException(400, 'Summa 0 dan katta bo\'lishi kerak')

    const rate = Number(exchange_rate) || 0
    await CashTransactionModel.create({
      date:           new Date(),
      type,
      amount:         Number(amount),
      payment_type:   ['Naqd', 'Karta', "O'tkazma"].includes(payment_type) ? payment_type : 'Naqd',
      description:    description || (type === 'income' ? 'Kassa kirimi' : 'Kassa chiqimi'),
      cashier_id:     req.currentUser?.id ?? null,
      exchange_rate:  rate,
      amount_usd:     rate > 0 ? +(Number(amount) / rate).toFixed(4) : 0,
    })

    res.json({ message: 'Saqlandi' })
  }

  // ── FIFO helper — returns [{batchId, qty, costPrice}] ────────
  async _applyFIFO(productId, qtyToSell) {
    const batches = await PurchaseItemModel.findAll({
      where: { product_id: productId },
      include: [{
        model:      PurchaseModel,
        as:         'purchase',
        where:      { status: 'confirmed' },
        attributes: ['id', 'date'],
      }],
      order: [[{ model: PurchaseModel, as: 'purchase' }, 'date', 'ASC'], ['id', 'ASC']],
    })

    let remaining  = Number(qtyToSell)
    const deductions = []

    for (const batch of batches) {
      const available = Number(batch.unit_qty) - Number(batch.sold_qty)
      if (available <= 0) continue
      const deduct = Math.min(available, remaining)
      await batch.update({ sold_qty: Number(batch.sold_qty) + deduct })
      deductions.push({ batchId: batch.id, qty: deduct, costPrice: Number(batch.cost_price) || 0 })
      remaining -= deduct
      if (remaining <= 0) break
    }

    return deductions  // [{batchId, qty, costPrice}, ...]
  }
}

module.exports = new SaleController()
