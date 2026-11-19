const { Op } = require('sequelize')
const sequelize             = require('../db/db-sequelize')
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
const { requireBranchId }   = require('../utils/branchContext')
const { syncClientDebt, r2 } = require('../utils/clientDebt.utils')

// Kassaga haqiqatan pul tushiradigan to'lov turlari. "Qarz" bu yerda yo'q —
// u pul emas, mijoz hisobidagi yozuv.
const PUL_TURLARI = ['Naqd', 'Karta', "O'tkazma"]
const safePay = (v, fallback = 'Naqd') => PUL_TURLARI.includes(v) ? v : fallback

/**
 * PUL QOIDALARI (naqd tushum va nasiya) — bitta joyda:
 *
 *   sale.paid_sum   — sotuv paytida kassaga tushgan pul (naqd/karta/o'tkazma)
 *   sale.debt_sum   — qarzga yozilgan qism (qaytarishlarda kamayadi)
 *   sale.debt_paid  — shu qarzdan keyin to'langani (clientDebt.utils taqsimlaydi)
 *   client.balance  — Σ qarz to'lovlari − Σ ochiq sotuvlar debt_sum (manfiy = qarzdor)
 *
 *   cash_transaction — kassadagi HAR BIR pul harakati:
 *     sale (paid_sum), debt_payment, refund (qaytarish), income/expense
 *   kassa_register   — sotuv hujjatlari registri (hisobotlar shundan):
 *     bitta sotuv = bitta satr; qarz to'lovi = sale_id NULL satr
 *
 * Har amal (sotuv, bekor, qaytarish, qarz to'lovi) BITTA tranzaksiyada:
 * yarim yozilgan holat qolmaydi.
 */
class SaleController {

  // ── List ──────────────────────────────────────────────────────
  getAll = async (req, res) => {
    const { search, status, client_id, date_from, date_to, page = 1, limit = 50 } = req.query
    const where = {}
    if (status    && status !== 'all') where.status    = status
    if (client_id && client_id !== 'all') where.client_id = client_id
    // Kun chegarasi mahalliy vaqtda — dateRange.utils.js ga qarang
    const dr = dateRange(Op, date_from, date_to)
    if (dr) where.date = dr
    // Qidiruv: mijoz nomi, hujjat raqami, TOVAR NOMI va SHTRIX-KOD.
    //
    // Qaytarishlarda kassir odatda tovarni qo'lida ushlab turadi va uning
    // yorlig'ini skanerlaydi — shuning uchun shtrix-kod bo'yicha o'sha
    // tovar sotilgan hujjatni topa olish kerak.
    let aniqSaleIds = []
    if (search) {
      const q = String(search).trim()
      const kodlar = barcodeVariants(q)

      let productIds = []
      if (/^\d{6,}$/.test(q)) {
        const prods = await ProductModel.findAll({
          attributes: ['id', 'barcodes'],
          where: { [Op.or]: kodlar.map(k => ({ barcodes: { [Op.like]: `%${k}%` } })) },
          raw: true,
          limit: 50,
        }).catch(() => [])
        productIds = prods.filter(p => {
          let list = []
          try { list = JSON.parse(p.barcodes) || [] } catch { /* buzuq */ }
          return (list || []).some(b => kodlar.includes(String(b).trim()))
        }).map(p => p.id)
      }

      const items = await SaleItemModel.findAll({
        attributes: ['sale_id', 'barcode', 'product_id'],
        where: {
          [Op.or]: [
            { product_name: { [Op.like]: `%${q}%` } },
            ...kodlar.map(k => ({ barcode: k })),
            ...(productIds.length ? [{ product_id: { [Op.in]: productIds } }] : []),
          ],
        },
        raw: true,
        limit: 500,
      }).catch(() => [])

      const aniq = new Set()
      const saleIdsByItem = []
      for (const i of items) {
        if (!i.sale_id) continue
        if (!saleIdsByItem.includes(i.sale_id)) saleIdsByItem.push(i.sale_id)
        if (i.barcode && kodlar.includes(String(i.barcode).trim())) aniq.add(i.sale_id)
      }
      aniqSaleIds = [...aniq]

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
      // `items` JOIN'i count ni satr soniga ko'paytirmasin (7 sotuv → 11 chiqardi)
      distinct: true,
    })

    let data = rows
    if (aniqSaleIds.length) {
      const aniqSet = new Set(aniqSaleIds)
      data = [...rows].sort((a, b) => {
        const av = aniqSet.has(a.id) ? 0 : 1
        const bv = aniqSet.has(b.id) ? 0 : 1
        return av - bv
      })
    }

    res.json({
      total: count,
      page: Number(page),
      data,
      matched_query: search ? String(search).trim() : null,
      exact_ids: aniqSaleIds,
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

    const kassa = await KassaRegisterModel.findOne({
      where:      { sale_id: sale.id },
      attributes: ['cashier_id', 'cashier_name'],
    })
    // Shu sotuv bo'yicha naqd qaytarilgan pul
    const refunded = await CashTransactionModel.sum('amount', {
      where: { type: 'refund', reference_id: sale.id, branch_id: requireBranchId() },
    })

    const result = sale.toJSON()
    result.cashier_name   = kassa?.cashier_name ?? null
    result.cashier_id     = kassa?.cashier_id   ?? null
    result.debt_remaining = r2(Math.max(0, r2(result.debt_sum) - r2(result.debt_paid)))
    result.refunded_sum   = r2(refunded)

    res.json(result)
  }

  getNextDocNumber = async (req, res) => {
    res.json({ doc_number: await this._nextDocNumber() })
  }

  // Hujjat raqami FILIAL ichida ketma-ket (har filialning o'z chek raqami)
  async _nextDocNumber(transaction = null) {
    const max = await SaleModel.max('doc_number', {
      where: { branch_id: requireBranchId() }, transaction,
    })
    return (Number(max) || 0) + 1
  }

  // ── Complete sale (main POS action) ──────────────────────────
  complete = async (req, res) => {
    const branchId = requireBranchId()
    const body = req.body || {}

    // ── 1. Kirish ma'lumotlarini tekshirish (bazaga yozishdan OLDIN) ──
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpException(400, 'Savat bo\'sh')

    // Hisob uchun kelgan, modelda bo'lmagan maydonlar — o'qib olamiz.
    // (Ilgari ular tekshiruvdan OLDIN o'chirilib yuborilardi: "qoldiq yetmasa
    // ham sot" tasdig'i va aralash to'lovdagi karta/o'tkazma turi yo'qolardi.)
    const allowNegative = body.allow_negative === true
    const prepayType    = safePay(body.prepay_type)

    const items = body.items.map((i, idx) => {
      const qty   = Number(i.qty)
      const price = Number(i.price)
      if (!Number.isFinite(qty) || qty <= 0)    throw new HttpException(400, `${idx + 1}-satr: miqdor noto'g'ri`)
      if (!Number.isFinite(price) || price < 0) throw new HttpException(400, `${idx + 1}-satr: narx noto'g'ri`)
      return {
        product_id:   i.product_id ? Number(i.product_id) : null,
        barcode:      i.barcode ? String(i.barcode).trim() : null,
        product_name: String(i.product_name || i.name || '').trim(),
        qty, price,
        // Satr summasi SERVERDA hisoblanadi — frontend qiymatiga ishonilmaydi
        total_sum:    r2(qty * price),
        price_type:   ['chakana', 'ulgurji'].includes(i.price_type) ? i.price_type : null,
      }
    })

    const totalSum  = r2(items.reduce((s, i) => s + i.total_sum, 0))
    // Chegirma 0 dan kam va jamidan ko'p bo'lmasin (aks holda manfiy to'lov chiqardi)
    const discount  = r2(Math.min(Math.max(0, Number(body.discount) || 0), totalSum))
    const netSum    = r2(totalSum - discount)
    const rate      = Number(body.exchange_rate) || 0
    const toUSD     = v => rate > 0 ? +(v / rate).toFixed(4) : 0
    const priceType = ['chakana', 'ulgurji'].includes(body.price_type) ? body.price_type : 'chakana'
    const warehouse = body.warehouse || 'Asosiy ombor'
    const date      = body.date && !isNaN(new Date(body.date)) ? new Date(body.date) : new Date()

    let paymentType = [...PUL_TURLARI, 'Qarz'].includes(body.payment_type) ? body.payment_type : 'Naqd'

    // Mijoz — bo'lsa, shu filialda mavjud bo'lishi shart
    const clientId = body.client_id ? Number(body.client_id) : null
    let client = null
    if (clientId) {
      client = await ClientModel.findByPk(clientId)
      if (!client) throw new HttpException(400, 'Mijoz topilmadi')
    }

    // ARALASH TO'LOV: "Qarz" turida `paid_sum` — hozir to'langan pul,
    // qolgani qarz. Qarz MIJOZSIZ bo'lmaydi: kimdan undirish noma'lum.
    let paidSum, debtSum
    if (paymentType === 'Qarz') {
      if (!client) throw new HttpException(400, 'Qarzga sotish uchun mijoz tanlanishi shart')
      paidSum = r2(Math.max(0, Math.min(netSum, Number(body.paid_sum) || 0)))
      debtSum = r2(netSum - paidSum)
      // Hammasini hozir to'lagan bo'lsa — bu qarz emas, oddiy sotuv
      if (debtSum <= 0) { paymentType = prepayType; debtSum = 0; paidSum = netSum }
    } else {
      paidSum = netSum
      debtSum = 0
    }
    // Qarz muddati — faqat qarzli sotuvda
    const dueDate = debtSum > 0 && body.due_date && /^\d{4}-\d{2}-\d{2}/.test(String(body.due_date))
      ? String(body.due_date).slice(0, 10) : null

    // Kassaga pul qanday tushdi (naqd/karta/o'tkazma). Aralash to'lovda
    // sotuv turi "Qarz", lekin oldindan to'langan pul `prepay_type` bilan keladi.
    const cashPayType = paymentType === 'Qarz' ? prepayType : paymentType

    const cashierId   = req.currentUser?.id ?? null
    const cashierName = req.currentUser?.fullname ?? req.currentUser?.username ?? null

    // ── 2. Mahsulotlar va QOLDIQ TEKSHIRUVI — hali hech narsa yozilmagan ──
    const idlar   = [...new Set(items.map(i => i.product_id).filter(Boolean))]
    const mavjud  = idlar.length
      ? await ProductModel.findAll({ where: { id: { [Op.in]: idlar } }, attributes: ['id', 'name', 'qty'] })
      : []
    const prodById = new Map(mavjud.map(p => [p.id, p]))
    for (const it of items) {
      if (it.product_id && !prodById.has(it.product_id)) {
        // Boshqa filial tovari yoki o'chirilgan — bu filialda sotib bo'lmaydi
        throw new HttpException(400, `"${it.product_name || '#' + it.product_id}" bu filialda topilmadi`)
      }
      if (!it.product_name && it.product_id) it.product_name = prodById.get(it.product_id).name
      if (!it.product_name) throw new HttpException(400, 'Tovar nomi bo\'sh')
    }

    // Omborda yo'q tovarni sotish qoldiqni MANFIYGA tushiradi va FIFO
    // tannarxni buzadi. Kassir ataylab tasdiqlasa (`allow_negative`) o'tadi.
    if (!allowNegative && idlar.length) {
      const talab = new Map()
      for (const i of items) if (i.product_id) talab.set(i.product_id, (talab.get(i.product_id) || 0) + i.qty)
      const yetmaydi = []
      for (const [id, kerak] of talab) {
        const bor = Number(prodById.get(id)?.qty) || 0
        if (kerak > bor) yetmaydi.push({ nomi: prodById.get(id)?.name || `#${id}`, bor, kerak })
      }
      if (yetmaydi.length) {
        const matn = yetmaydi.map(y => `"${y.nomi}": omborda ${y.bor} ta, so'ralgan ${y.kerak} ta`).join('; ')
        throw new HttpException(409, `Qoldiq yetarli emas — ${matn}`, { code: 'QOLDIQ_YETMAYDI', tovarlar: yetmaydi })
      }
    }

    // Chegirma butun chekka beriladi, foyda esa har mahsulot bo'yicha —
    // chegirmani satrlar orasida summasiga proporsional taqsimlaymiz.
    const discountRatio = totalSum > 0 ? Math.min(discount / totalSum, 1) : 0

    // ── 3. Yozish — hammasi BITTA tranzaksiyada ──────────────────
    const saleId = await sequelize.transaction(async (t) => {
      const docNumber = Number(body.doc_number) > 0 ? Number(body.doc_number) : await this._nextDocNumber(t)

      const sale = await SaleModel.create({
        doc_number:    docNumber,
        date,
        warehouse,
        client_id:     clientId,
        payment_type:  paymentType,
        price_type:    priceType,
        total_sum:     totalSum,
        discount,
        paid_sum:      paidSum,
        debt_sum:      debtSum,
        debt_paid:     0,
        due_date:      dueDate,
        cashier_id:    cashierId,
        status:        'completed',
        comment:       body.comment ? String(body.comment).slice(0, 2000) : null,
        exchange_rate: rate,
        total_usd:     toUSD(totalSum),
        discount_usd:  toUSD(discount),
        paid_usd:      toUSD(paidSum),
        debt_usd:      toUSD(debtSum),
      }, { transaction: t })

      // Satrlar: FIFO yechish + sale_item + product_register
      for (const item of items) {
        let deductions = []   // [{batchId, qty, costPrice}]
        if (item.product_id) {
          deductions = await this._applyFIFO(item.product_id, item.qty, t)
          const product = await ProductModel.findByPk(item.product_id, { transaction: t })
          if (product) {
            // Clamp yo'q: qoldiq manfiyga tushishi mumkin (allow_negative) —
            // bekor qilishda to'liq qaytadi, fantom zaxira paydo bo'lmaydi
            await product.update({ qty: r2(Number(product.qty) - item.qty) }, { transaction: t })
          }
        }

        const totalQty  = deductions.reduce((s, d) => s + d.qty, 0)
        const totalCost = deductions.reduce((s, d) => s + d.qty * d.costPrice, 0)
        const avgCost   = totalQty > 0 ? totalCost / totalQty : 0

        const created = await SaleItemModel.create({
          sale_id:          sale.id,
          product_id:       item.product_id,
          purchase_item_id: deductions.find(d => d.batchId)?.batchId ?? null,
          barcode:          item.barcode,
          product_name:     item.product_name,
          qty:              item.qty,
          price:            item.price,
          price_usd:        rate > 0 ? +(item.price / rate).toFixed(4) : 0,
          cost_price:       avgCost,
          total_sum:        item.total_sum,
          total_usd:        rate > 0 ? +(item.total_sum / rate).toFixed(4) : 0,
          price_type:       item.price_type || priceType,
        }, { transaction: t })

        // Chegirmadan keyingi haqiqiy narx — foyda hisoboti shu ustundan
        const netPrice = +(item.price * (1 - discountRatio)).toFixed(4)
        const regBase = {
          date, sale_id: sale.id, doc_number: docNumber, warehouse,
          product_id:   item.product_id,
          product_name: item.product_name,
          barcode:      item.barcode,
          price:        netPrice,
          price_type:   item.price_type || priceType,
          cashier_id:   cashierId,
          cashier_name: cashierName,
          status:       'active',
        }
        if (deductions.length) {
          // Har partiya ulushi alohida satr — aniq tannarx. Partiya
          // topilmagan qoldiq (oversell) ham yoziladi (batchId null), aks
          // holda sotilgan tovar hisobotdan tushib qolardi.
          for (const d of deductions) {
            await ProductRegisterModel.create({
              ...regBase,
              purchase_item_id: d.batchId,
              qty:        d.qty,
              cost_price: d.costPrice,
              total_sum:  r2(netPrice * d.qty),
            }, { transaction: t })
          }
        } else {
          await ProductRegisterModel.create({
            ...regBase,
            purchase_item_id: null,
            qty:        item.qty,
            cost_price: 0,
            total_sum:  r2(item.total_sum * (1 - discountRatio)),
          }, { transaction: t })
        }
      }

      // Kassa registri — bitta sotuv = bitta satr
      await KassaRegisterModel.create({
        date, sale_id: sale.id, doc_number: docNumber, warehouse,
        payment_type:  paymentType,
        price_type:    priceType,
        total_sum:     totalSum,
        paid_sum:      paidSum,
        debt_sum:      debtSum,
        discount,
        item_count:    items.length,
        client_id:     clientId,
        client_name:   client?.name ?? null,
        cashier_id:    cashierId,
        cashier_name:  cashierName,
        status:        'completed',
        exchange_rate: rate,
        total_usd:     toUSD(totalSum),
      }, { transaction: t })

      // Kassaga tushgan pul
      if (paidSum > 0) {
        await CashTransactionModel.create({
          date,
          type:           'sale',
          amount:         paidSum,
          payment_type:   cashPayType,
          reference_id:   sale.id,
          reference_type: debtSum > 0 ? 'sale_prepay' : 'sale',
          client_id:      clientId,
          description:    `Sotuv #${docNumber}`,
          cashier_id:     cashierId,
          exchange_rate:  rate,
          amount_usd:     toUSD(paidSum),
        }, { transaction: t })
      }

      // Nasiya: mijoz balansi va qarz taqsimoti yagona qoida bo'yicha.
      // Mijozda kredit (ortiqcha to'lov) bo'lsa, u shu qarzga avtomatik
      // qo'llanadi — qarzdorlar ro'yxati balans bilan mos bo'ladi.
      if (client && debtSum > 0) await syncClientDebt(client.id, { transaction: t })

      return sale.id
    })

    const result = await SaleModel.findOne({
      where:   { id: saleId },
      include: [
        { model: ClientModel,   as: 'client' },
        { model: SaleItemModel, as: 'items'  },
      ],
    })
    res.status(201).json(result)
  }

  // ── Cancel (butun hujjatni bekor qilish) ──────────────────────
  cancel = async (req, res) => {
    const cashierId = req.currentUser?.id ?? null
    let clientId = null

    const sale = await sequelize.transaction(async (t) => {
      const sale = await SaleModel.findOne({
        where:   { id: req.params.id },
        include: [{ model: SaleItemModel, as: 'items' }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      })
      if (!sale) throw new HttpException(404, 'Topilmadi')
      if (sale.status === 'cancelled') throw new HttpException(400, 'Allaqachon bekor')
      clientId = sale.client_id

      // 1) Ombor: faqat hali QAYTARILMAGAN miqdor qaytadi. Ilgari to'liq
      //    `qty` qaytarilib, qisman qaytarilgan tovar ikki marta omborga
      //    tushardi (fantom zaxira).
      for (const item of sale.items) {
        if (!item.product_id) continue
        const qolgan = r2(Number(item.qty) - (Number(item.returned_qty) || 0))
        if (qolgan <= 0) continue
        const product = await ProductModel.findByPk(item.product_id, { transaction: t })
        if (product) await product.update({ qty: r2(Number(product.qty) + qolgan) }, { transaction: t })
      }

      // 2) FIFO partiyalari — faol register satrlaridan (qaytarilganlari
      //    allaqachon 'reversed')
      const regRows = await ProductRegisterModel.findAll({
        where: { sale_id: sale.id, status: 'active' },
        attributes: ['purchase_item_id', 'qty'],
        transaction: t,
      })
      for (const reg of regRows) {
        if (!reg.purchase_item_id) continue
        const batch = await PurchaseItemModel.findByPk(reg.purchase_item_id, { transaction: t })
        if (batch) {
          await batch.update({
            sold_qty:  Math.max(0, r2(Number(batch.sold_qty) - Number(reg.qty))),
            stock_qty: r2(Number(batch.stock_qty) + Number(reg.qty)),
          }, { transaction: t })
        }
      }

      // 3) PUL: qaytarilmagan qismning qiymati mijozga qaytadi —
      //    avval to'lanmagan qarz kechiriladi, keyin kassadan naqd.
      const netSum = r2(Number(sale.total_sum) - Number(sale.discount))
      const V      = r2(Math.max(0, netSum - (Number(sale.returned_sum) || 0)))
      if (V > 0) {
        await this._qaytarishPuli(sale, V, {
          transaction: t, cashierId,
          description: `Bekor qilish: sotuv #${sale.doc_number}`,
        })
      }

      // 4) Registrlar
      await ProductRegisterModel.update({ status: 'reversed' },  { where: { sale_id: sale.id }, transaction: t })
      await KassaRegisterModel.update(  { status: 'cancelled' }, { where: { sale_id: sale.id }, transaction: t })
      await sale.update({ status: 'cancelled', returned_sum: netSum }, { transaction: t })

      // 5) Nasiya: bekor qilingan sotuv balansdan chiqadi (to'langan qismi
      //    mijozda kredit bo'lib qoladi)
      if (sale.client_id) await syncClientDebt(sale.client_id, { transaction: t })
      return sale
    })

    res.json(sale)
  }

  /**
   * POST /api/v1/sales/:id/return-items — tanlangan tovarlarni qisman qaytarish.
   * Tana: { items: [{ sale_item_id, qty }], comment? }
   *
   * Chegirma nisbatan taqsimlanadi: mijozga haqiqatda to'lagan puli qaytadi.
   * Pul qoidasi `_qaytarishPuli` da.
   */
  returnItems = async (req, res) => {
    const { items = [], comment } = req.body || {}
    if (!Array.isArray(items) || !items.length) {
      throw new HttpException(400, 'Qaytariladigan tovar tanlanmagan')
    }
    const cashierId = req.currentUser?.id ?? null

    let jamiSumma = 0, jamiDona = 0, pul = null
    const saleId = await sequelize.transaction(async (t) => {
      const sale = await SaleModel.findOne({
        where:   { id: req.params.id },
        include: [{ model: SaleItemModel, as: 'items' }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      })
      if (!sale) throw new HttpException(404, 'Sotuv topilmadi')
      if (sale.status === 'cancelled') throw new HttpException(400, 'Sotuv bekor qilingan')

      const byId = new Map(sale.items.map(i => [i.id, i]))
      const totalSum = Number(sale.total_sum) || 0
      const discount = Number(sale.discount)  || 0
      const koef = totalSum > 0 ? Math.max(0, 1 - discount / totalSum) : 1

      // ── Tekshiruv ────────────────────────────────────────────────
      const rejalar = []
      const korildi = new Set()
      for (const it of items) {
        const satr = byId.get(Number(it.sale_item_id))
        if (!satr) throw new HttpException(400, 'Sotuvda bunday tovar yo\'q')
        if (korildi.has(satr.id)) throw new HttpException(400, `"${satr.product_name}" ikki marta ko'rsatilgan`)
        korildi.add(satr.id)

        const qty = Number(it.qty)
        if (!(qty > 0)) throw new HttpException(400, `"${satr.product_name}" uchun miqdor noto'g'ri`)
        const qolgan = r2(Number(satr.qty) - (Number(satr.returned_qty) || 0))
        if (qty > qolgan + 1e-9) {
          throw new HttpException(400, `"${satr.product_name}": ${qolgan} dona qaytarish mumkin (${qty} so'ralgan)`)
        }
        const gross = r2(Number(satr.price) * qty)      // chegirmasiz
        const summa = r2(gross * koef)                   // chegirmadan keyin
        rejalar.push({ satr, qty, gross, summa })
      }

      jamiSumma = r2(rejalar.reduce((a, r) => a + r.summa, 0))
      const jamiGross = r2(rejalar.reduce((a, r) => a + r.gross, 0))

      for (const r of rejalar) {
        jamiDona += r.qty

        // 1) Omborga qaytaramiz
        if (r.satr.product_id) {
          const product = await ProductModel.findByPk(r.satr.product_id, { transaction: t })
          if (product) await product.update({ qty: r2(Number(product.qty) + r.qty) }, { transaction: t })
        }

        // 2) FIFO partiyalari — eng oxirgi yechilgandan boshlab qaytaramiz
        const regs = await ProductRegisterModel.findAll({
          where: { sale_id: sale.id, product_id: r.satr.product_id, status: 'active' },
          order: [['id', 'DESC']],
          transaction: t,
        })
        let qaytarish = r.qty
        for (const reg of regs) {
          if (qaytarish <= 0) break
          const bor = Number(reg.qty) || 0
          if (bor <= 0) continue
          const olish = Math.min(bor, qaytarish)

          if (reg.purchase_item_id) {
            const batch = await PurchaseItemModel.findByPk(reg.purchase_item_id, { transaction: t })
            if (batch) {
              await batch.update({
                sold_qty:  Math.max(0, r2(Number(batch.sold_qty) - olish)),
                stock_qty: r2(Number(batch.stock_qty) + olish),
              }, { transaction: t })
            }
          }
          const yangiQty = r2(bor - olish)
          await reg.update({
            qty: yangiQty,
            total_sum: r2(Number(reg.total_sum) * (bor > 0 ? yangiQty / bor : 0)),
            ...(yangiQty <= 0 ? { status: 'reversed' } : {}),
          }, { transaction: t })
          qaytarish = r2(qaytarish - olish)
        }

        // 3) Satrda qaytarilgan miqdor
        await r.satr.update(
          { returned_qty: r2((Number(r.satr.returned_qty) || 0) + r.qty) },
          { transaction: t })
      }

      // 4) PUL — avval to'lanmagan qarz, keyin kassadan naqd, qolgani kredit
      pul = await this._qaytarishPuli(sale, jamiSumma, {
        transaction: t, cashierId,
        description: comment || `Qaytarish: sotuv #${sale.doc_number}`,
      })
      const qarzKamaydi = r2(pul.fromDebt + pul.creditRest)

      // 5) Kassa registri — hisobotlar shu satrdan o'qiydi, shuning uchun
      //    qaytarilgan qism ayriladi (ilgari qaytarish hisobotlarga
      //    umuman tushmasdi va kunlik "to'langan" oshib ko'rinardi)
      const kassa = await KassaRegisterModel.findOne({ where: { sale_id: sale.id }, transaction: t })
      if (kassa) {
        await kassa.update({
          total_sum: r2(Number(kassa.total_sum) - jamiGross),
          discount:  r2(Math.max(0, Number(kassa.discount) - (jamiGross - jamiSumma))),
          paid_sum:  r2(Math.max(0, Number(kassa.paid_sum) - pul.fromCash)),
          debt_sum:  r2(Math.max(0, Number(kassa.debt_sum) - qarzKamaydi)),
        }, { transaction: t })
      }

      // 6) Sotuv hujjati
      const patch = {
        returned_sum: r2((Number(sale.returned_sum) || 0) + jamiSumma),
        debt_sum:     r2(Math.max(0, Number(sale.debt_sum) - qarzKamaydi)),
      }
      // Hamma tovar qaytarilgan bo'lsa — sotuv bekor deb belgilanadi
      const qoldi = sale.items.reduce((a, i) => {
        const r = rejalar.find(x => x.satr.id === i.id)
        return a + (Number(i.qty) - (Number(i.returned_qty) || 0) - (r ? r.qty : 0))
      }, 0)
      if (qoldi <= 1e-9) {
        patch.status = 'cancelled'
        await KassaRegisterModel.update({ status: 'cancelled' }, { where: { sale_id: sale.id }, transaction: t })
        await ProductRegisterModel.update({ status: 'reversed' }, { where: { sale_id: sale.id }, transaction: t })
      }
      await sale.update(patch, { transaction: t })

      // 7) Nasiya
      if (sale.client_id) await syncClientDebt(sale.client_id, { transaction: t })
      return sale.id
    })

    const yangilangan = await SaleModel.findOne({
      where: { id: saleId },
      include: [{ model: SaleItemModel, as: 'items' }],
    })

    res.json({
      ok: true,
      qaytarildi: jamiDona,
      summa: jamiSumma,
      naqd_qaytarildi: pul.fromCash,      // kassadan chiqqan pul
      qarzdan_ayrildi: pul.fromDebt,      // mijoz qarzi kamaydi
      kreditga_yozildi: pul.creditRest,   // mijoz oldin to'lagan — kredit bo'ldi
      toliq_bekor: yangilangan.status === 'cancelled',
      sale: yangilangan,
    })
  }

  /**
   * Qaytarilgan tovar qiymati `V` ni mijozga qaytarish tartibi:
   *   1) to'lanmagan qarz (debt_sum − debt_paid) kechiriladi      → fromDebt
   *   2) sotuv paytida kassaga tushgan, hali qaytarilmagan pul    → fromCash
   *      (cash_transaction 'refund' yoziladi, kassa qoldig'i kamayadi)
   *   3) qolgani — mijoz keyin qarz to'lovi bilan to'lagan pul —
   *      kredit bo'lib mijoz balansida qoladi                      → creditRest
   *
   * Mijozsiz sotuvda hamma pul naqd qaytadi.
   */
  async _qaytarishPuli(sale, V, { transaction: t, cashierId, description }) {
    const debtSum  = r2(sale.debt_sum)
    const debtPaid = r2(sale.debt_paid)
    const paidSum  = r2(sale.paid_sum)

    const unpaid   = Math.max(0, r2(debtSum - debtPaid))
    const fromDebt = r2(Math.min(V, unpaid))
    const rest     = r2(V - fromDebt)

    const refunded = r2(await CashTransactionModel.sum('amount', {
      where: { type: 'refund', reference_id: sale.id, branch_id: requireBranchId() },
      transaction: t,
    }))
    const cashPool = Math.max(0, r2(paidSum - refunded))
    let fromCash   = r2(Math.min(rest, cashPool))
    let creditRest = r2(rest - fromCash)
    if (!sale.client_id && creditRest > 0) { fromCash = r2(fromCash + creditRest); creditRest = 0 }

    if (fromCash > 0) {
      // Pul qanday olingan bo'lsa shunday qaytariladi (karta → karta)
      const saleTxn = await CashTransactionModel.findOne({
        where: { type: 'sale', reference_id: sale.id }, transaction: t,
      })
      const payType = saleTxn?.payment_type || safePay(sale.payment_type)
      const rate = Number(sale.exchange_rate) || 0
      await CashTransactionModel.create({
        date:           new Date(),
        type:           'refund',
        amount:         fromCash,
        payment_type:   payType,
        reference_id:   sale.id,
        reference_type: 'sale_return',
        client_id:      sale.client_id ?? null,
        description,
        cashier_id:     cashierId,
        exchange_rate:  rate,
        amount_usd:     rate > 0 ? +(fromCash / rate).toFixed(4) : 0,
      }, { transaction: t })
    }

    return { fromDebt, fromCash, creditRest }
  }

  // ── Cash report ───────────────────────────────────────────────
  getCashReport = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = {}
    const dr = dateRange(Op, date_from, date_to)
    if (dr) where.date = dr

    const txns = await CashTransactionModel.findAll({
      where,
      order: [['date', 'DESC'], ['id', 'DESC']],
      include: [{ model: ClientModel, as: 'client', attributes: ['id', 'name'], required: false }],
    })

    const summary    = { income: 0, expense: 0, sale: 0, refund: 0, debt_payment: 0, opening: 0, net: 0 }
    const summaryUSD = { income: 0, expense: 0, sale: 0, refund: 0, debt_payment: 0, opening: 0, net: 0 }
    // To'lov turi bo'yicha sof tushum — kassada haqiqatan qancha naqd,
    // qancha karta/o'tkazma yig'ilganini ko'rsatadi
    const byPayType = {}

    txns.forEach(t => {
      const amt    = Number(t.amount) || 0
      const amtUSD = Number(t.amount_usd) || 0
      if (t.type in summary) {
        summary[t.type]    += amt
        summaryUSD[t.type] += amtUSD
      }
      const sign = ['income', 'sale', 'debt_payment', 'opening'].includes(t.type) ? 1
                 : ['expense', 'refund'].includes(t.type) ? -1 : 0
      summary.net    += sign * amt
      summaryUSD.net += sign * amtUSD
      const pt = t.payment_type || 'Naqd'
      byPayType[pt] = r2((byPayType[pt] || 0) + sign * amt)
    })
    for (const k of Object.keys(summary))    summary[k]    = r2(summary[k])
    for (const k of Object.keys(summaryUSD)) summaryUSD[k] = r2(summaryUSD[k])

    res.json({ transactions: txns, summary, summaryUSD, byPayType })
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
  /**
   * POST /api/v1/sales/pay-debt
   * Tana: { client_id, amount, payment_type?, description?, exchange_rate?, allow_credit? }
   *
   * Qarzdan KO'P to'lov — faqat `allow_credit: true` bilan (ortig'i mijoz
   * kreditiga yoziladi). Aks holda 409 — kassir xato raqam yozib
   * yubormasin (100 000 o'rniga 1 000 000).
   */
  payDebt = async (req, res) => {
    const { client_id, amount, payment_type = 'Naqd', description, exchange_rate, allow_credit } = req.body || {}
    const paidAmount = r2(amount)
    if (!client_id || !Number.isFinite(paidAmount) || paidAmount <= 0) {
      throw new HttpException(400, 'client_id va musbat amount kerak')
    }

    const client = await ClientModel.findByPk(client_id)
    if (!client) throw new HttpException(404, 'Mijoz topilmadi')

    // Joriy haqiqiy qarz (sinxronlab olamiz — eski nomuvofiqlik bo'lsa tuzaladi)
    const oldin = await syncClientDebt(client.id)
    if (paidAmount > oldin.qarz + 0.005 && allow_credit !== true) {
      throw new HttpException(409,
        `To'lov qarzdan ko'p. Joriy qarz: ${oldin.qarz.toLocaleString('uz-UZ')} so'm. ` +
        `Ortig'ini mijoz kreditiga yozish uchun tasdiqlang.`,
        { code: 'QARZDAN_KOP', qarz: oldin.qarz, ortiqcha: r2(paidAmount - oldin.qarz) })
    }

    const rate         = Number(exchange_rate) || 0
    const safePayType  = safePay(payment_type)
    const cashierId    = req.currentUser?.id ?? null
    const cashierName  = req.currentUser?.fullname ?? req.currentUser?.username ?? null
    const now          = new Date()

    const natija = await sequelize.transaction(async (t) => {
      await CashTransactionModel.create({
        date:           now,
        type:           'debt_payment',
        amount:         paidAmount,
        payment_type:   safePayType,
        client_id:      client.id,
        // Qarzdor kartochkasi to'lovlarni shu bo'yicha ham topa oladi
        reference_id:   client.id,
        reference_type: 'client_debt',
        description:    description || `${client.name} — qarz to'lovi`,
        cashier_id:     cashierId,
        exchange_rate:  rate,
        amount_usd:     rate > 0 ? +(paidAmount / rate).toFixed(4) : 0,
      }, { transaction: t })

      // Kassa registrida ham ko'rinsin — kunlik tushumga kiradi, lekin
      // savdo (total_sum) hisoblanmaydi
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
        client_id:     client.id,
        client_name:   client.name,
        cashier_id:    cashierId,
        cashier_name:  cashierName,
        status:        'completed',
        exchange_rate: rate,
        total_usd:     rate > 0 ? +(paidAmount / rate).toFixed(4) : 0,
      }, { transaction: t })

      // To'lov eng eski qarzdan boshlab sotuvlarga taqsimlanadi, balans yangilanadi
      return syncClientDebt(client.id, { transaction: t })
    })

    const fresh = await ClientModel.findByPk(client.id)
    res.json({
      client:  fresh,
      balance: natija.balance,
      qarz:    natija.qarz,
      kredit:  natija.kredit,
      message: natija.qarz > 0
        ? `Qabul qilindi. Qolgan qarz: ${natija.qarz.toLocaleString('uz-UZ')} so'm`
        : (natija.kredit > 0
            ? `Qarz to'liq yopildi. Mijoz krediti: ${natija.kredit.toLocaleString('uz-UZ')} so'm`
            : 'Qarz to\'liq yopildi'),
    })
  }

  // ── Cash entry (income / expense) ────────────────────────────
  cashEntry = async (req, res) => {
    const { type, amount, payment_type = 'Naqd', description, exchange_rate } = req.body || {}
    if (!['income', 'expense'].includes(type)) throw new HttpException(400, "type: 'income' yoki 'expense' bo'lishi kerak")
    const amt = r2(amount)
    if (!Number.isFinite(amt) || amt <= 0) throw new HttpException(400, 'Summa 0 dan katta bo\'lishi kerak')

    const rate = Number(exchange_rate) || 0
    const txn = await CashTransactionModel.create({
      date:           new Date(),
      type,
      amount:         amt,
      payment_type:   safePay(payment_type),
      reference_type: type === 'income' ? 'manual_income' : 'manual_expense',
      description:    (description && String(description).trim().slice(0, 500)) ||
                      (type === 'income' ? 'Kassa kirimi' : 'Kassa chiqimi'),
      cashier_id:     req.currentUser?.id ?? null,
      exchange_rate:  rate,
      amount_usd:     rate > 0 ? +(amt / rate).toFixed(4) : 0,
    })

    res.json({ message: 'Saqlandi', id: txn.id })
  }

  // ── FIFO helper — returns [{batchId, qty, costPrice}] ────────
  //
  // Partiyalar eng eskisidan yechiladi. `sold_qty` oshadi, `stock_qty`
  // kamayadi — ikkalasi ham: inventarizatsiya `stock_qty` ga qaraydi,
  // ilgari sotuv unga tegmagani uchun har sotuvdan keyin "partiya
  // nomuvofiqligi" paydo bo'lardi.
  //
  // Partiya yetmasa (oversell yoki kirimsiz tovar) qoldiq ham qaytariladi:
  // batchId = null, tannarx — eng so'nggi partiyaniki (yo'q bo'lsa 0).
  async _applyFIFO(productId, qtyToSell, transaction = null) {
    const batches = await PurchaseItemModel.findAll({
      where: { product_id: productId },
      include: [{
        model:      PurchaseModel,
        as:         'purchase',
        where:      { status: 'confirmed' },
        attributes: ['id', 'date'],
      }],
      order: [[{ model: PurchaseModel, as: 'purchase' }, 'date', 'ASC'], ['id', 'ASC']],
      transaction,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    })

    let remaining  = r2(qtyToSell)
    const deductions = []

    for (const batch of batches) {
      if (remaining <= 0) break
      const available = r2(Number(batch.unit_qty) - Number(batch.sold_qty))
      if (available <= 0) continue
      const deduct = Math.min(available, remaining)
      await batch.update({
        sold_qty:  r2(Number(batch.sold_qty) + deduct),
        stock_qty: Math.max(0, r2(Number(batch.stock_qty) - deduct)),
      }, { transaction })
      deductions.push({ batchId: batch.id, qty: deduct, costPrice: Number(batch.cost_price) || 0 })
      remaining = r2(remaining - deduct)
    }

    if (remaining > 0) {
      const last = batches.length ? batches[batches.length - 1] : null
      deductions.push({ batchId: null, qty: remaining, costPrice: Number(last?.cost_price) || 0 })
    }

    return deductions
  }
}

module.exports = new SaleController()
