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
    let aniqSaleIds = []
    if (search) {
      const q = String(search).trim()
      const kodlar = barcodeVariants(q)

      // Shtrix-kod bo'yicha MAHSULOTNI topamiz.
      //
      // `sale_item.barcode` ga savatga qo'shilgan paytdagi BIRINCHI kod
      // yoziladi (`barcodes[0]`). Tovarda bir necha kod bo'lsa va mijoz
      // ikkinchisi bilan kelsa, faqat `sale_item.barcode` bo'yicha
      // qidirish uni topmaydi. Shuning uchun avval mahsulotni aniqlab,
      // keyin `product_id` bo'yicha ham qidiramiz.
      let productIds = []
      if (/^\d{6,}$/.test(q)) {
        const prods = await ProductModel.findAll({
          attributes: ['id', 'barcodes'],
          where: { [Op.or]: kodlar.map(k => ({ barcodes: { [Op.like]: `%${k}%` } })) },
          raw: true,
          limit: 50,
        }).catch(() => [])
        // JSON massiv ichida to'liq moslikni tekshiramiz — substring emas
        productIds = prods.filter(p => {
          let list = []
          try { list = JSON.parse(p.barcodes) || [] } catch { /* buzuq */ }
          return (list || []).some(b => kodlar.includes(String(b).trim()))
        }).map(p => p.id)
      }

      // Tovar satrlari bo'yicha mos keladigan sotuvlarni topamiz.
      //
      // `aniq` — skanerlangan kod satrga AYNAN mos kelgan hujjatlar.
      // Ular natijada birinchi turishi kerak: qaytarishda kassir aynan
      // o'sha tovarni qidiryapti, boshqa sotuvlar esa shu mahsulotning
      // eski savdolari va ular pastroqda tursin.
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

    // Skanerlangan kod AYNAN mos kelgan hujjatlarni oldinga chiqaramiz.
    // Qolganlari — shu mahsulotning eski savdolari, ular pastroqda.
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
      // Qidiruv shtrix-kod/tovar bo'yicha mos kelganini frontend biladi —
      // topilgan hujjatni darhol ochib, o'sha tovarni belgilab bera oladi
      matched_query: search ? String(search).trim() : null,
      // Kod aynan mos kelgan hujjatlar — frontend birinchisini avtomatik
      // ochadi, garchi ro'yxatda bir nechta bo'lsa ham
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
    const netSum    = totalSum - discount

    // ARALASH TO'LOV: mijoz savdoning bir qismini darhol to'lab,
    // qolganini qarzga olishi mumkin. Frontend "Qarz" turini yuboradi
    // va `paid_sum` da oldindan to'langan pulni beradi.
    //
    // `paid_sum` kelmasa — eski xatti-harakat: qarzga bo'lsa 0,
    // aks holda to'liq summa.
    let paidSum, debtSum
    if (header.payment_type === 'Qarz') {
      const oldindan = Math.max(0, Math.min(netSum, Number(header.paid_sum) || 0))
      paidSum = oldindan
      debtSum = +(netSum - oldindan).toFixed(2)
    } else {
      paidSum = netSum
      debtSum = 0
    }
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

    // Modelda yo'q maydonlar (faqat hisob uchun kelgan)
    delete header.prepay_type
    delete header.allow_negative

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

    // ── QOLDIQ TEKSHIRUVI ────────────────────────────────────────
    //
    // Omborda yo'q tovarni sotish qoldiqni MANFIYGA tushiradi. Manfiy
    // qoldiq real emas ("-3 dona" bo'lmaydi) va FIFO tannarx hisobini
    // buzadi — keyin foyda hisoboti noto'g'ri chiqadi.
    //
    // Shuning uchun yetmasa to'xtatamiz. Kassir ataylab sotmoqchi
    // bo'lsa (masalan tovar bor, lekin bazaga kirim qilinmagan)
    // `allow_negative: true` yuboradi va o'zi javobgar bo'ladi.
    if (header.allow_negative !== true) {
      const idlar = [...new Set(items.map(i => i.product_id).filter(Boolean))];
      if (idlar.length) {
        const mavjud = await ProductModel.findAll({
          where: { id: { [Op.in]: idlar } },
          attributes: ['id', 'name', 'qty'],
        });
        const qoldiq = new Map(mavjud.map(p => [p.id, Number(p.qty) || 0]));

        // Bir tovar savatda bir necha satrda bo'lishi mumkin — yig'amiz
        const talab = new Map();
        for (const i of items) {
          if (!i.product_id) continue;
          talab.set(i.product_id, (talab.get(i.product_id) || 0) + Number(i.qty));
        }

        const yetmaydi = [];
        for (const [id, kerak] of talab) {
          const bor = qoldiq.get(id);
          if (bor === undefined) continue;
          if (kerak > bor) {
            const p = mavjud.find(x => x.id === id);
            yetmaydi.push({ nomi: p?.name || `#${id}`, bor, kerak });
          }
        }

        if (yetmaydi.length) {
          const matn = yetmaydi
            .map(y => `"${y.nomi}": omborda ${y.bor} ta, so'ralgan ${y.kerak} ta`)
            .join('; ');
          throw new HttpException(409, `Qoldiq yetarli emas — ${matn}`, {
            code: 'QOLDIQ_YETMAYDI',
            tovarlar: yetmaydi,
          });
        }
      }
    }

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
        // Aralash to'lovda tur "Qarz" bo'ladi, lekin oldindan to'langan
        // pul aslida naqd/karta/o'tkazma orqali olinadi — kassa
        // hisobotida to'g'ri ko'rinishi uchun o'sha usulni yozamiz.
        payment_type:   ['Naqd', 'Karta', "O'tkazma"].includes(header.payment_type)
                          ? header.payment_type
                          : (['Naqd', 'Karta', "O'tkazma"].includes(header.prepay_type)
                              ? header.prepay_type : 'Naqd'),
        reference_id:   sale.id,
        reference_type: debtSum > 0 ? 'sale_prepay' : 'sale',
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

  /**
   * POST /api/v1/sales/:id/return-items
   * Tanlangan tovarlarni qisman qaytarish.
   *
   * Tana: { items: [{ sale_item_id, qty }], comment? }
   *
   * Butun hujjatni bekor qilishdan farqi: mijoz bitta tovarni qaytarsa,
   * qolgan tovarlar sotuvda qoladi va hisobotlar buzilmaydi.
   *
   * Chegirma nisbatan taqsimlanadi: chekda 100,000 chegirma bo'lsa,
   * qaytariladigan tovarga to'g'ri keladigan qismi ayriladi — mijozga
   * haqiqatda to'lagan puli qaytadi.
   */
  returnItems = async (req, res) => {
    const { items = [], comment } = req.body
    if (!Array.isArray(items) || !items.length) {
      throw new HttpException(400, 'Qaytariladigan tovar tanlanmagan')
    }

    const sale = await SaleModel.findOne({
      where:   { id: req.params.id },
      include: [{ model: SaleItemModel, as: 'items' }],
    })
    if (!sale) throw new HttpException(404, 'Sotuv topilmadi')
    if (sale.status === 'cancelled') throw new HttpException(400, 'Sotuv bekor qilingan')

    const byId = new Map(sale.items.map(i => [i.id, i]))

    // Chegirma nisbati — sotuv paytidagi kabi
    const totalSum = Number(sale.total_sum) || 0
    const discount = Number(sale.discount)  || 0
    const koef = totalSum > 0 ? Math.max(0, 1 - discount / totalSum) : 1

    // ── Tekshiruv: kiritishdan oldin hammasi to'g'rimi ──────────────
    const rejalar = []
    for (const it of items) {
      const satr = byId.get(Number(it.sale_item_id))
      if (!satr) throw new HttpException(400, 'Sotuvda bunday tovar yo\'q')

      const qty = Number(it.qty)
      if (!(qty > 0)) throw new HttpException(400, `"${satr.product_name}" uchun miqdor noto'g'ri`)

      const sotilgan   = Number(satr.qty) || 0
      const qaytarilgan = Number(satr.returned_qty) || 0
      const qolgan     = sotilgan - qaytarilgan
      if (qty > qolgan) {
        throw new HttpException(400,
          `"${satr.product_name}": ${qolgan} dona qaytarish mumkin (${qty} so'ralgan)`)
      }

      // Chegirmadan keyingi haqiqiy summa
      const summa = +(Number(satr.price) * qty * koef).toFixed(2)
      rejalar.push({ satr, qty, summa })
    }

    const jamiSumma = rejalar.reduce((a, r) => a + r.summa, 0)
    let jamiDona = 0

    await sequelize.transaction(async (t) => {
      for (const r of rejalar) {
        jamiDona += r.qty

        // 1) Omborga qaytaramiz
        if (r.satr.product_id) {
          const product = await ProductModel.findByPk(r.satr.product_id, { transaction: t })
          if (product) {
            await product.update(
              { qty: Number(product.qty) + r.qty }, { transaction: t })
          }
        }

        // 2) FIFO partiyalarini tiklaymiz — eng oxirgi yechilgandan
        //    boshlab qaytaramiz (LIFO tartibida), shunda tannarx
        //    hisobi buzilmaydi
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
                sold_qty:  Math.max(0, Number(batch.sold_qty) - olish),
                stock_qty: Number(batch.stock_qty) + olish,
              }, { transaction: t })
            }
          }

          // Register satrini kamaytiramiz (yoki to'liq bekor qilamiz)
          const yangiQty = bor - olish
          const ulush = bor > 0 ? (yangiQty / bor) : 0
          await reg.update({
            qty: yangiQty,
            total_sum: +(Number(reg.total_sum) * ulush).toFixed(2),
            ...(yangiQty === 0 ? { status: 'reversed' } : {}),
          }, { transaction: t })

          qaytarish -= olish
        }

        // 3) Satrda qaytarilgan miqdorni belgilaymiz
        await r.satr.update(
          { returned_qty: (Number(r.satr.returned_qty) || 0) + r.qty },
          { transaction: t })
      }

      // 4) Pul: qarzga sotilgan bo'lsa qarzdan ayiramiz, aks holda kassadan
      const qarzga = Number(sale.debt_sum) > 0
      if (qarzga && sale.client_id) {
        const client = await ClientModel.findByPk(sale.client_id, { transaction: t })
        if (client) {
          // Qarz kamayadi — balans manfiy bo'lgani uchun ustiga qo'shamiz
          const yangiBalans = Number(client.balance) + jamiSumma
          await client.update({ balance: yangiBalans }, { transaction: t })
        }
        await sale.update({
          debt_sum: Math.max(0, Number(sale.debt_sum) - jamiSumma),
        }, { transaction: t })
      } else {
        // Naqd qaytarish — kassa harakati sifatida yoziladi
        await CashTransactionModel.create({
          date: new Date(),
          type: 'refund',
          amount: jamiSumma,
          payment_type: ['Naqd', 'Karta', "O'tkazma"].includes(sale.payment_type)
            ? sale.payment_type : 'Naqd',
          reference_id: sale.id,
          reference_type: 'sale_return',
          description: comment || `Qaytarish: sotuv #${sale.doc_number}`,
          cashier_id: req.currentUser?.id ?? null,
        }, { transaction: t })
      }

      // 5) Sotuvda qaytarilgan summani yig'ib boramiz
      const yangiReturned = (Number(sale.returned_sum) || 0) + jamiSumma
      const patch = { returned_sum: yangiReturned }

      // Hamma tovar qaytarilgan bo'lsa — sotuvni bekor deb belgilaymiz
      const qoldi = sale.items.reduce((a, i) => {
        const q = Number(i.qty) || 0
        const r = rejalar.find(x => x.satr.id === i.id)
        const qaytdi = (Number(i.returned_qty) || 0) + (r ? r.qty : 0)
        return a + (q - qaytdi)
      }, 0)
      if (qoldi <= 0) {
        patch.status = 'cancelled'
        await KassaRegisterModel.update(
          { status: 'cancelled' }, { where: { sale_id: sale.id }, transaction: t })
      }

      await sale.update(patch, { transaction: t })
    })

    const yangilangan = await SaleModel.findOne({
      where: { id: sale.id },
      include: [{ model: SaleItemModel, as: 'items' }],
    })

    res.json({
      ok: true,
      qaytarildi: jamiDona,
      summa: jamiSumma,
      toliq_bekor: yangilangan.status === 'cancelled',
      sale: yangilangan,
    })
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
