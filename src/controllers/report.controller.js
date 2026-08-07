const { Op, fn, col, literal } = require('sequelize')
const sequelize              = require('../db/db-sequelize')
const ProductRegisterModel   = require('../models/product_register.model')
const KassaRegisterModel     = require('../models/kassa_register.model')
const SaleModel              = require('../models/sale.model')
const SaleItemModel          = require('../models/sale_item.model')
const ClientModel            = require('../models/client.model')
const ProductModel           = require('../models/product.model')
const SupplierModel          = require('../models/supplier.model')
const PurchaseModel          = require('../models/purchase.model')
const CashTransactionModel   = require('../models/cash_transaction.model')
const { dateRange, dayRange: dayRangeUtil } = require('../utils/dateRange.utils')

// Kun chegaralari mahalliy vaqtda hisoblanadi — dateRange.utils.js ga qarang
function dayRange(dateStr) {
  return dayRangeUtil(Op, dateStr || new Date())
}

function range(from, to) {
  return dateRange(Op, from, to) || {}
}

class ReportController {

  // ── Overview ─── today / week / month summary ─────────────────
  getOverview = async (req, res) => {
    const now   = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const weekAgo  = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0,0,0,0)
    const monthAgo = new Date(now); monthAgo.setDate(1); monthAgo.setHours(0,0,0,0)

    async function stats(dateWhere) {
      // Faqat haqiqiy savdolar (sale_id mavjud)
      const [saleRows, debtRows] = await Promise.all([
        KassaRegisterModel.findAll({
          where: { status: 'completed', date: dateWhere, sale_id: { [Op.not]: null } },
          attributes: [
            [fn('COUNT', col('id')),          'sales_count'],
            [fn('SUM',   col('total_sum')),   'revenue'],
            [fn('SUM',   col('paid_sum')),    'paid'],
            [fn('SUM',   col('debt_sum')),    'debt'],
            [fn('SUM',   col('item_count')),  'items'],
          ],
          raw: true,
        }),
        // Qarz to'lovlari (sale_id null — payDebt orqali tushganlar)
        KassaRegisterModel.findAll({
          where: { status: 'completed', date: dateWhere, sale_id: null },
          attributes: [[fn('SUM', col('paid_sum')), 'total']],
          raw: true,
        }),
      ])
      const r             = saleRows[0] || {}
      const debt_payments = Number(debtRows[0]?.total) || 0
      const sale_paid     = Number(r.paid) || 0
      return {
        sales_count:   Number(r.sales_count) || 0,
        revenue:       Number(r.revenue)     || 0,
        paid:          sale_paid,
        debt:          Number(r.debt)        || 0,
        items:         Number(r.items)       || 0,
        debt_payments,                           // bugun qabul qilingan qarz to'lovlari
        income:        sale_paid + debt_payments, // kassaga kirgan jami pul
      }
    }

    const [today_stats, week_stats, month_stats] = await Promise.all([
      stats({ [Op.gte]: today }),
      stats({ [Op.gte]: weekAgo }),
      stats({ [Op.gte]: monthAgo }),
    ])

    // Today's sales per hour (lokal UZT vaqt bo'yicha)
    const UZT = '+05:00'
    const hourly = await KassaRegisterModel.findAll({
      where: { status: 'completed', date: { [Op.gte]: today } },
      attributes: [
        [fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', UZT)), 'hour'],
        [fn('SUM', col('total_sum')), 'revenue'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: [fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', UZT))],
      order: [[fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', UZT)), 'ASC']],
      raw: true,
    })

    res.json({ today: today_stats, week: week_stats, month: month_stats, hourly })
  }

  // ── Today's sales list ────────────────────────────────────────
  getTodaySales = async (req, res) => {
    const { date } = req.query
    const today = date ? new Date(date) : new Date()
    today.setHours(0, 0, 0, 0)
    const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999)

    const sales = await SaleModel.findAll({
      where:   { status: 'completed', date: { [Op.between]: [today, todayEnd] } },
      order:   [['date', 'DESC']],
      include: [
        { model: ClientModel,   as: 'client',  attributes: ['id', 'name'], required: false },
        { model: SaleItemModel, as: 'items',   attributes: ['id', 'product_name', 'qty', 'price', 'total_sum'] },
      ],
    })
    res.json(sales)
  }

  // ── Product sales report ──────────────────────────────────────
  getProductSales = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = { status: 'active' }
    if (date_from || date_to) where.date = range(date_from, date_to)

    const rows = await ProductRegisterModel.findAll({
      where,
      attributes: [
        'product_id',
        'product_name',
        'warehouse',
        [fn('SUM',   col('qty')),       'total_qty'],
        [fn('SUM',   col('total_sum')), 'total_sum'],
        [fn('COUNT', col('id')),        'sales_count'],
        [fn('AVG',   col('price')),     'avg_price'],
      ],
      group:  ['product_id', 'product_name', 'warehouse'],
      order:  [[fn('SUM', col('total_sum')), 'DESC']],
      raw: true,
    })

    const result = rows.map(r => ({
      product_id:  r.product_id,
      product_name: r.product_name,
      warehouse:   r.warehouse,
      total_qty:   Number(r.total_qty)   || 0,
      total_sum:   Number(r.total_sum)   || 0,
      sales_count: Number(r.sales_count) || 0,
      avg_price:   Math.round(Number(r.avg_price) || 0),
    }))

    res.json(result)
  }

  // ── Client report ─────────────────────────────────────────────
  getClientReport = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = { status: 'completed' }
    if (date_from || date_to) where.date = range(date_from, date_to)

    // Sales per client from kassa_register
    const rows = await KassaRegisterModel.findAll({
      where,
      attributes: [
        'client_id',
        'client_name',
        [fn('COUNT', col('id')),          'sales_count'],
        [fn('SUM',   col('total_sum')),   'total_sum'],
        [fn('SUM',   col('paid_sum')),    'paid_sum'],
        [fn('SUM',   col('debt_sum')),    'debt_sum'],
      ],
      group:  ['client_id', 'client_name'],
      order:  [[fn('SUM', col('total_sum')), 'DESC']],
      raw: true,
    })

    // Current balances from client table
    const clientIds = rows.filter(r => r.client_id).map(r => r.client_id)
    let balanceMap = {}
    if (clientIds.length) {
      const clients = await ClientModel.findAll({
        where: { id: { [Op.in]: clientIds } },
        attributes: ['id', 'balance', 'phone', 'code'],
        raw: true,
      })
      clients.forEach(c => { balanceMap[c.id] = c })
    }

    const result = rows.map(r => {
      const cli = balanceMap[r.client_id] || {}
      return {
        client_id:   r.client_id,
        client_name: r.client_name || '— Noma\'lum —',
        client_code: cli.code  || '',
        phone:       cli.phone || '',
        sales_count: Number(r.sales_count) || 0,
        total_sum:   Number(r.total_sum)   || 0,
        paid_sum:    Number(r.paid_sum)    || 0,
        debt_sum:    Number(r.debt_sum)    || 0,
        balance:     Number(cli.balance)   || 0,
      }
    })

    res.json(result)
  }

  // ── Cashier report ────────────────────────────────────────────
  getCashierReport = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = { status: 'completed' }
    if (date_from || date_to) where.date = range(date_from, date_to)

    const rows = await KassaRegisterModel.findAll({
      where,
      attributes: [
        'cashier_id',
        'cashier_name',
        [fn('COUNT', col('id')),          'sales_count'],
        [fn('SUM',   col('total_sum')),   'total_sum'],
        [fn('SUM',   col('paid_sum')),    'paid_sum'],
        [fn('SUM',   col('debt_sum')),    'debt_sum'],
        [fn('SUM',   col('item_count')),  'items_sold'],
        [fn('SUM',   col('discount')),    'total_discount'],
      ],
      group:  ['cashier_id', 'cashier_name'],
      order:  [[fn('SUM', col('total_sum')), 'DESC']],
      raw: true,
    })

    const result = rows.map(r => ({
      cashier_id:      r.cashier_id,
      cashier_name:    r.cashier_name || 'Noma\'lum',
      sales_count:     Number(r.sales_count)     || 0,
      total_sum:       Number(r.total_sum)       || 0,
      paid_sum:        Number(r.paid_sum)        || 0,
      debt_sum:        Number(r.debt_sum)        || 0,
      items_sold:      Number(r.items_sold)      || 0,
      total_discount:  Number(r.total_discount)  || 0,
    }))

    res.json(result)
  }

  // ── Profit report ─────────────────────────────────────────────
  getProfitReport = async (req, res) => {
    const { date_from, date_to, group_by = 'product' } = req.query
    const where = { status: 'active' }
    if (date_from || date_to) where.date = range(date_from, date_to)

    const totals = await ProductRegisterModel.findAll({
      where,
      attributes: [
        [fn('SUM', col('total_sum')),            'revenue'],
        [fn('SUM', literal('cost_price * qty')), 'cost'],
        [fn('SUM', col('qty')),                  'total_qty'],
      ],
      raw: true,
    })
    const t       = totals[0] || {}
    const revenue = Number(t.revenue) || 0
    const cost    = Number(t.cost)    || 0
    const summary = {
      revenue,
      cost,
      profit:     revenue - cost,
      profit_pct: revenue > 0 ? +((revenue - cost) / revenue * 100).toFixed(1) : 0,
      total_qty:  Number(t.total_qty) || 0,
    }

    let rows = []
    if (group_by === 'date') {
      const raw = await ProductRegisterModel.findAll({
        where,
        attributes: [
          [fn('DATE', col('date')),                'day'],
          [fn('SUM', col('total_sum')),            'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
          [fn('SUM', col('qty')),                  'total_qty'],
          [fn('COUNT', col('id')),                 'sales_count'],
        ],
        group:  [fn('DATE', col('date'))],
        order:  [[fn('DATE', col('date')), 'ASC']],
        raw: true,
      })
      rows = raw.map(r => {
        const rev = Number(r.revenue) || 0
        const cst = Number(r.cost)    || 0
        return {
          day:         r.day,
          revenue:     rev,
          cost:        cst,
          profit:      rev - cst,
          profit_pct:  rev > 0 ? +((rev - cst) / rev * 100).toFixed(1) : 0,
          total_qty:   Number(r.total_qty)   || 0,
          sales_count: Number(r.sales_count) || 0,
        }
      })
    } else {
      const raw = await ProductRegisterModel.findAll({
        where,
        attributes: [
          'product_id',
          'product_name',
          [fn('SUM', col('total_sum')),            'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
          [fn('SUM', col('qty')),                  'total_qty'],
          [fn('COUNT', col('id')),                 'sales_count'],
          [fn('AVG',  col('price')),               'avg_price'],
          [fn('AVG',  col('cost_price')),          'avg_cost'],
        ],
        group:  ['product_id', 'product_name'],
        order:  [[fn('SUM', col('total_sum')), 'DESC']],
        raw: true,
      })
      rows = raw.map(r => {
        const rev = Number(r.revenue) || 0
        const cst = Number(r.cost)    || 0
        return {
          product_id:   r.product_id,
          product_name: r.product_name,
          revenue:      rev,
          cost:         cst,
          profit:       rev - cst,
          profit_pct:   rev > 0 ? +((rev - cst) / rev * 100).toFixed(1) : 0,
          total_qty:    Number(r.total_qty)   || 0,
          sales_count:  Number(r.sales_count) || 0,
          avg_price:    Math.round(Number(r.avg_price) || 0),
          avg_cost:     Math.round(Number(r.avg_cost)  || 0),
        }
      })
    }

    res.json({ summary, rows, group_by })
  }

  // ── Dashboard extra: low-stock, expenses, client debts, supplier debts, period chart ──
  getDashboardExtra = async (req, res) => {
    const { period = 'day' } = req.query
    const now = new Date()

    // Low-stock products (qty <= min_qty, min_qty > 0)
    const lowStock = await ProductModel.findAll({
      where: {
        active: true,
        is_folder: false,
        min_qty: { [Op.gt]: 0 },
        [Op.and]: literal('`ProductModel`.`qty` <= `ProductModel`.`min_qty`'),
      },
      attributes: ['id', 'code', 'name', 'unit', 'qty', 'min_qty'],
      order: [['qty', 'ASC']],
      limit: 20,
      raw: true,
    })

    // Today's supplier payment expenses
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)
    const todayExpenses = await CashTransactionModel.findAll({
      where: {
        type: 'expense',
        reference_type: 'supplier_payment',
        date: { [Op.between]: [todayStart, todayEnd] },
      },
      attributes: ['id', 'date', 'amount', 'payment_type', 'description', 'reference_id'],
      order: [['date', 'DESC']],
      raw: true,
    })
    // Attach supplier names
    const supIds = [...new Set(todayExpenses.map(e => e.reference_id).filter(Boolean))]
    let supNameMap = {}
    if (supIds.length) {
      const sups = await SupplierModel.findAll({ where: { id: { [Op.in]: supIds } }, attributes: ['id', 'name'], raw: true })
      sups.forEach(s => { supNameMap[s.id] = s.name })
    }
    const expenses = todayExpenses.map(e => ({
      ...e,
      supplier_name: supNameMap[e.reference_id] || e.description || '',
    }))
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

    // Client debts (balance < 0)
    const debtClients = await ClientModel.findAll({
      where: { balance: { [Op.lt]: 0 }, active: true },
      attributes: ['id', 'name', 'phone', 'code', 'balance'],
      order: [['balance', 'ASC']],
      limit: 10,
      raw: true,
    })

    // Supplier debts (balance < 0 = we owe them)
    const debtSuppliers = await SupplierModel.findAll({
      where: { balance: { [Op.lt]: 0 }, active: true },
      attributes: ['id', 'name', 'phone', 'code', 'balance'],
      order: [['balance', 'ASC']],
      limit: 10,
      raw: true,
    })

    // Uzbekistan UTC+5 — MySQL HOUR/DATE funksiyalari UTC da ishlaydi,
    // shuning uchun CONVERT_TZ bilan lokal vaqtga o'tkazamiz
    const TZ_OFFSET = '+05:00'

    // Period-based chart: revenue & profit per unit
    let chartLabels = [], chartRevenue = [], chartCost = [], chartProfit = []
    if (period === 'day') {
      // Bugungi soatlar bo'yicha (lokal vaqt)
      const raw = await ProductRegisterModel.findAll({
        where: { status: 'active', date: { [Op.between]: [todayStart, todayEnd] } },
        attributes: [
          [fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'unit'],
          [fn('SUM', col('total_sum')), 'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
        ],
        group: [fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET))],
        order: [[fn('HOUR', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'ASC']],
        raw: true,
      })
      const map = {}
      raw.forEach(r => { map[Number(r.unit)] = r })
      for (let h = 0; h < 24; h++) {
        chartLabels.push(`${String(h).padStart(2,'0')}:00`)
        const rev = Number(map[h]?.revenue) || 0
        const cst = Number(map[h]?.cost)    || 0
        chartRevenue.push(rev)
        chartCost.push(cst)
        chartProfit.push(rev - cst)
      }
    } else if (period === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6); weekAgo.setHours(0,0,0,0)
      const raw = await ProductRegisterModel.findAll({
        where: { status: 'active', date: { [Op.between]: [weekAgo, todayEnd] } },
        attributes: [
          [fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'unit'],
          [fn('SUM', col('total_sum')), 'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
        ],
        group: [fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET))],
        order: [[fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'ASC']],
        raw: true,
      })
      const map = {}
      raw.forEach(r => { map[r.unit] = r })
      const DAY_NAMES = ['Yak','Dush','Sesh','Chor','Pay','Jum','Shan']
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i)
        // Lokal sana string (YYYY-MM-DD)
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        chartLabels.push(DAY_NAMES[d.getDay()])
        const rev = Number(map[key]?.revenue) || 0
        const cst = Number(map[key]?.cost)    || 0
        chartRevenue.push(rev)
        chartCost.push(cst)
        chartProfit.push(rev - cst)
      }
    } else if (period === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const raw = await ProductRegisterModel.findAll({
        where: { status: 'active', date: { [Op.between]: [monthStart, todayEnd] } },
        attributes: [
          [fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'unit'],
          [fn('SUM', col('total_sum')), 'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
        ],
        group: [fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET))],
        order: [[fn('DATE', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'ASC']],
        raw: true,
      })
      raw.forEach(r => {
        chartLabels.push(r.unit?.slice(8,10) + '-kun')
        const rev = Number(r.revenue) || 0
        const cst = Number(r.cost)    || 0
        chartRevenue.push(rev)
        chartCost.push(cst)
        chartProfit.push(rev - cst)
      })
    } else if (period === 'year') {
      const yearStart = new Date(now.getFullYear(), 0, 1)
      const MONTH_NAMES = ['Yan','Fev','Mar','Apr','May','Iyn','Iyl','Avg','Sen','Okt','Noy','Dek']
      const raw = await ProductRegisterModel.findAll({
        where: { status: 'active', date: { [Op.between]: [yearStart, todayEnd] } },
        attributes: [
          [fn('MONTH', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'unit'],
          [fn('SUM', col('total_sum')), 'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
        ],
        group: [fn('MONTH', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET))],
        order: [[fn('MONTH', fn('CONVERT_TZ', col('date'), '+00:00', TZ_OFFSET)), 'ASC']],
        raw: true,
      })
      const map = {}
      raw.forEach(r => { map[Number(r.unit)] = r })
      for (let m = 1; m <= 12; m++) {
        chartLabels.push(MONTH_NAMES[m-1])
        const rev = Number(map[m]?.revenue) || 0
        const cst = Number(map[m]?.cost)    || 0
        chartRevenue.push(rev)
        chartCost.push(cst)
        chartProfit.push(rev - cst)
      }
    }

    // Top-7 tovarlar (bugun sotilganlar bo'yicha)
    const topProducts = await ProductRegisterModel.findAll({
      where: { status: 'active', date: { [Op.between]: [todayStart, todayEnd] } },
      attributes: [
        'product_name',
        [fn('SUM', col('total_sum')), 'revenue'],
        [fn('SUM', col('qty')),       'qty'],
        [fn('SUM', literal('cost_price * qty')), 'cost'],
      ],
      group: ['product_name'],
      order: [[fn('SUM', col('total_sum')), 'DESC']],
      limit: 7,
      raw: true,
    })

    // To'lov turlari taqsimoti (bugun, kassa_register)
    const payRows = await KassaRegisterModel.findAll({
      where: { status: 'completed', date: { [Op.between]: [todayStart, todayEnd] }, sale_id: { [Op.not]: null } },
      attributes: [
        'payment_type',
        [fn('SUM', col('paid_sum')), 'total'],
        [fn('COUNT', col('id')),    'count'],
      ],
      group: ['payment_type'],
      raw: true,
    })

    // ── Qo'shimcha analitika bloklari ─────────────────────────────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1)
    const yesterdayEnd   = new Date(todayStart); yesterdayEnd.setMilliseconds(-1)

    // 1) O'rtacha chek (AOV) — bugun vs kecha
    const aovWhere = { status: 'completed', sale_id: { [Op.not]: null } }
    const [aovToday, aovYesterday] = await Promise.all([
      KassaRegisterModel.findAll({
        where: { ...aovWhere, date: { [Op.between]: [todayStart, todayEnd] } },
        attributes: [[fn('SUM', col('total_sum')), 'revenue'], [fn('COUNT', col('id')), 'cnt']],
        raw: true,
      }),
      KassaRegisterModel.findAll({
        where: { ...aovWhere, date: { [Op.between]: [yesterdayStart, yesterdayEnd] } },
        attributes: [[fn('SUM', col('total_sum')), 'revenue'], [fn('COUNT', col('id')), 'cnt']],
        raw: true,
      }),
    ])
    const tCnt = Number(aovToday[0]?.cnt) || 0
    const yCnt = Number(aovYesterday[0]?.cnt) || 0
    const aovTodayVal = tCnt > 0 ? (Number(aovToday[0]?.revenue) || 0) / tCnt : 0
    const aovYestVal  = yCnt > 0 ? (Number(aovYesterday[0]?.revenue) || 0) / yCnt : 0
    const averageOrderValue = {
      amount: Math.round(aovTodayVal),
      trend:  aovYestVal > 0 ? +(((aovTodayVal - aovYestVal) / aovYestVal) * 100).toFixed(1) : 0,
    }

    // 2) Sof foyda — yalpi foyda (product_register) minus xarajatlar (cash_transaction)
    async function grossProfit(fromDate) {
      const rows = await ProductRegisterModel.findAll({
        where: { status: 'active', date: { [Op.between]: [fromDate, todayEnd] } },
        attributes: [
          [fn('SUM', col('total_sum')),            'revenue'],
          [fn('SUM', literal('cost_price * qty')), 'cost'],
        ],
        raw: true,
      })
      const rev = Number(rows[0]?.revenue) || 0
      return { revenue: rev, profit: rev - (Number(rows[0]?.cost) || 0) }
    }
    async function expensesSum(fromDate) {
      const s = await CashTransactionModel.sum('amount', {
        where: { type: 'expense', date: { [Op.between]: [fromDate, todayEnd] } },
      })
      return Number(s) || 0
    }
    const [gpToday, gpMonth, expToday, expMonth] = await Promise.all([
      grossProfit(todayStart), grossProfit(monthStart),
      expensesSum(todayStart), expensesSum(monthStart),
    ])
    const netMonthProfit = gpMonth.profit - expMonth
    const netProfit = {
      today:            Math.round(gpToday.profit - expToday),
      month:            Math.round(netMonthProfit),
      marginPercentage: gpMonth.revenue > 0 ? +((netMonthProfit / gpMonth.revenue) * 100).toFixed(1) : 0,
    }

    // 3) Qaytarishlar tahlili (shu oy) — bekor qilingan savdolar
    const [returnRows, topReturnedRaw] = await Promise.all([
      KassaRegisterModel.findAll({
        where: { status: 'cancelled', sale_id: { [Op.not]: null }, date: { [Op.between]: [monthStart, todayEnd] } },
        attributes: [[fn('SUM', col('total_sum')), 'total'], [fn('COUNT', col('id')), 'cnt']],
        raw: true,
      }),
      ProductRegisterModel.findAll({
        where: { status: 'reversed', date: { [Op.between]: [monthStart, todayEnd] } },
        attributes: [
          'product_name',
          [fn('SUM', col('qty')),       'qty'],
          [fn('SUM', col('total_sum')), 'total'],
        ],
        group: ['product_name'],
        order: [[fn('SUM', col('total_sum')), 'DESC']],
        limit: 5,
        raw: true,
      }),
    ])
    const returnsAnalytics = {
      totalReturnedAmount: Number(returnRows[0]?.total) || 0,
      returnedCount:       Number(returnRows[0]?.cnt)   || 0,
      topReturnedProducts: topReturnedRaw.map(r => ({
        name:  r.product_name,
        qty:   Number(r.qty)   || 0,
        total: Number(r.total) || 0,
      })),
    }

    // 4) Top kategoriyalar (shu oy) — product_register → product.category
    const catSalesRaw = await ProductRegisterModel.findAll({
      where: { status: 'active', date: { [Op.between]: [monthStart, todayEnd] }, product_id: { [Op.not]: null } },
      attributes: [
        'product_id',
        [fn('SUM', col('qty')),       'qty'],
        [fn('SUM', col('total_sum')), 'revenue'],
      ],
      group: ['product_id'],
      raw: true,
    })
    const catProdIds = catSalesRaw.map(r => r.product_id)
    let catMap = {}
    if (catProdIds.length) {
      const prods = await ProductModel.findAll({
        where: { id: { [Op.in]: catProdIds } },
        attributes: ['id', 'category'],
        raw: true,
      })
      prods.forEach(p => { catMap[p.id] = p.category })
    }
    const catAgg = {}
    catSalesRaw.forEach(r => {
      const cat = catMap[r.product_id] || 'Boshqa'
      if (!catAgg[cat]) catAgg[cat] = { categoryName: cat, salesCount: 0, totalRevenue: 0 }
      catAgg[cat].salesCount   += Number(r.qty)     || 0
      catAgg[cat].totalRevenue += Number(r.revenue) || 0
    })
    const catTotalRevenue = Object.values(catAgg).reduce((s, c) => s + c.totalRevenue, 0)
    const topCategories = Object.values(catAgg)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 8)
      .map((c, i) => ({
        categoryId:      i + 1,
        categoryName:    c.categoryName,
        salesCount:      Math.round(c.salesCount),
        totalRevenue:    c.totalRevenue,
        sharePercentage: catTotalRevenue > 0 ? +((c.totalRevenue / catTotalRevenue) * 100).toFixed(1) : 0,
      }))

    // 5) Mijozlar faolligi (shu oy)
    const [newClients, activeRows] = await Promise.all([
      ClientModel.count({ where: { active: true, createdAt: { [Op.gte]: monthStart } } }),
      KassaRegisterModel.findAll({
        where: {
          status: 'completed', sale_id: { [Op.not]: null },
          client_id: { [Op.not]: null },
          date: { [Op.between]: [monthStart, todayEnd] },
        },
        attributes: ['client_id'],
        group: ['client_id'],
        raw: true,
      }),
    ])
    const activeClientIds = activeRows.map(r => r.client_id)
    let returningCount = 0
    if (activeClientIds.length) {
      returningCount = await ClientModel.count({
        where: { id: { [Op.in]: activeClientIds }, createdAt: { [Op.lt]: monthStart } },
      })
    }
    const customerAnalytics = {
      newCustomersCount:       newClients,
      returningCustomersCount: returningCount,
      activeCustomers:         activeClientIds.length,
    }

    // Top kassirlar (bugun)
    const cashierRows = await KassaRegisterModel.findAll({
      where: { status: 'completed', date: { [Op.between]: [todayStart, todayEnd] }, sale_id: { [Op.not]: null } },
      attributes: [
        'cashier_id',
        'cashier_name',
        [fn('COUNT', col('id')),          'sales_count'],
        [fn('SUM',   col('total_sum')),   'total_sum'],
        [fn('SUM',   col('paid_sum')),    'paid_sum'],
        [fn('SUM',   col('item_count')),  'items'],
      ],
      group: ['cashier_id', 'cashier_name'],
      order: [[fn('SUM', col('total_sum')), 'DESC']],
      limit: 5,
      raw: true,
    })

    res.json({
      lowStock,
      expenses,
      totalExpenses,
      debtClients,
      debtSuppliers,
      topProducts: topProducts.map(r => ({
        name:    r.product_name,
        revenue: Number(r.revenue) || 0,
        qty:     Number(r.qty)     || 0,
        profit:  (Number(r.revenue) || 0) - (Number(r.cost) || 0),
      })),
      payTypes: payRows.map(r => ({
        type:  r.payment_type,
        total: Number(r.total) || 0,
        count: Number(r.count) || 0,
      })),
      cashiers: cashierRows.map(r => ({
        id:          r.cashier_id,
        name:        r.cashier_name || 'Noma\'lum',
        sales_count: Number(r.sales_count) || 0,
        total_sum:   Number(r.total_sum)   || 0,
        paid_sum:    Number(r.paid_sum)    || 0,
        items:       Number(r.items)       || 0,
      })),
      chart: { labels: chartLabels, revenue: chartRevenue, cost: chartCost, profit: chartProfit, period },
      averageOrderValue,
      netProfit,
      returnsAnalytics,
      topCategories,
      customerAnalytics,
    })
  }

  // ── Supplier report ───────────────────────────────────────────
  getSupplierReport = async (req, res) => {
    const { date_from, date_to } = req.query

    const suppliers = await SupplierModel.findAll({
      where: { active: true },
      attributes: ['id', 'name', 'phone', 'code', 'balance'],
      order: [['name', 'ASC']],
      raw: true,
    })

    const result = await Promise.all(suppliers.map(async (s) => {
      const purchaseWhere = { supplier_id: s.id, status: 'confirmed' }
      if (date_from || date_to) {
        purchaseWhere.date = {}
        Object.assign(purchaseWhere.date, dateRange(Op, date_from, date_to) || {})
      }

      const payWhere = { reference_type: 'supplier_payment', reference_id: s.id }
      if (date_from || date_to) {
        payWhere.date = {}
        Object.assign(payWhere.date, dateRange(Op, date_from, date_to) || {})
      }

      const [purchasedSum, purchasedUsd, paidSum] = await Promise.all([
        PurchaseModel.sum('total_sum', { where: purchaseWhere }) || 0,
        PurchaseModel.sum('total_usd', { where: purchaseWhere }) || 0,
        CashTransactionModel.sum('amount', { where: payWhere })  || 0,
      ])

      const totalSum = Number(purchasedSum) || 0
      const totalUsd = Number(purchasedUsd) || 0
      const paid     = Number(paidSum)      || 0
      const debtSum  = totalSum - paid
      const exchRate = totalUsd > 0 && totalSum > 0 ? totalSum / totalUsd : 11000
      const debtUsd  = exchRate > 0 ? debtSum / exchRate : 0

      return {
        id:          s.id,
        name:        s.name,
        phone:       s.phone || '',
        code:        s.code  || '',
        balance:     Number(s.balance) || 0,
        total_sum:   totalSum,
        total_usd:   +totalUsd.toFixed(2),
        paid_sum:    paid,
        debt_sum:    debtSum,
        debt_usd:    +debtUsd.toFixed(2),
        exch_rate:   Math.round(exchRate),
      }
    }))

    const summary = {
      total_sum: result.reduce((s, r) => s + r.total_sum, 0),
      total_usd: +result.reduce((s, r) => s + r.total_usd, 0).toFixed(2),
      paid_sum:  result.reduce((s, r) => s + r.paid_sum,  0),
      debt_sum:  result.reduce((s, r) => s + r.debt_sum,  0),
      debt_usd:  +result.reduce((s, r) => s + r.debt_usd, 0).toFixed(2),
    }

    res.json({ suppliers: result.filter(r => r.total_sum > 0 || r.balance !== 0), summary, all: result })
  }

  // ── Cash register detail ──────────────────────────────────────
  getCashRegister = async (req, res) => {
    const { date_from, date_to } = req.query
    const where = {}
    if (date_from || date_to) where.date = range(date_from, date_to)

    const rows = await KassaRegisterModel.findAll({
      where,
      order: [['date', 'DESC']],
      raw: true,
    })

    const summary = { completed: 0, cancelled: 0, paid: 0, debt: 0, discount: 0 }
    rows.filter(r => r.status === 'completed').forEach(r => {
      summary.completed += Number(r.total_sum) || 0
      summary.paid      += Number(r.paid_sum)  || 0
      summary.debt      += Number(r.debt_sum)  || 0
      summary.discount  += Number(r.discount)  || 0
    })
    rows.filter(r => r.status === 'cancelled').forEach(r => {
      summary.cancelled += Number(r.total_sum) || 0
    })

    res.json({ rows, summary })
  }
}

module.exports = new ReportController()
