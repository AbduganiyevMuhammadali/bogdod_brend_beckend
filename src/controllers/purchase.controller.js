const { Op } = require('sequelize');
const sequelize            = require('../db/db-sequelize');
const PurchaseModel        = require('../models/purchase.model');
const PurchaseItemModel    = require('../models/purchase_item.model');
const ProductModel         = require('../models/product.model');
const SaleItemModel        = require('../models/sale_item.model');
const SupplierModel        = require('../models/supplier.model');
const HttpException        = require('../utils/HttpException.utils');
const BaseController       = require('./BaseController');

class PurchaseController extends BaseController {

  getAll = async (req, res) => {
    const { search, status, warehouse, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status    && status    !== 'all') where.status    = status;
    if (warehouse && warehouse !== 'all') where.warehouse = warehouse;
    if (search) {
      where[Op.or] = [
        { supplier:   { [Op.like]: `%${search}%` } },
        { doc_number: { [Op.like]: `%${search}%` } },
      ];
    }
    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await PurchaseModel.findAndCountAll({
      where,
      order:  [['date', 'DESC'], ['id', 'DESC']],
      limit:  Number(limit),
      offset,
      include: [
        { model: PurchaseItemModel, as: 'items', attributes: ['id'] },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
      ],
    });
    res.json({ total: count, page: Number(page), data: rows });
  };

  getById = async (req, res) => {
    const purchase = await PurchaseModel.findOne({
      where:   { id: req.params.id },
      include: [
        { model: PurchaseItemModel, as: 'items' },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
      ],
    });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    res.json(purchase);
  };

  getNextDocNumber = async (req, res) => {
    const max = await PurchaseModel.max('doc_number');
    res.json({ doc_number: (Number(max) || 0) + 1 });
  };

  create = async (req, res) => {
    const { items = [], ...header } = req.body;
    if (!header.date) header.date = new Date();

    if (!header.doc_number) {
      const max = await PurchaseModel.max('doc_number');
      header.doc_number = (Number(max) || 0) + 1;
    }

    header.created_by = req.currentUser?.id ?? null;
    header.status     = header.status || 'draft';

    const { total_sum, total_usd } = this._calcTotals(items, header.exchange_rate);
    header.total_sum = total_sum;
    header.total_usd = total_usd;

    // supplier_id dan supplier nomini sinxronlashtirish
    if (header.supplier_id) {
      const sup = await SupplierModel.findByPk(header.supplier_id);
      if (sup) header.supplier = sup.name;
    }

    let purchase;
    await sequelize.transaction(async (t) => {
      purchase = await PurchaseModel.create(header, { transaction: t });
      if (items.length) {
        const rows = items.map(item => ({ ...item, purchase_id: purchase.id }));
        await PurchaseItemModel.bulkCreate(rows, { transaction: t });
      }
      if (header.status === 'confirmed') {
        await this._applyStock(items, header.exchange_rate, t);
        await this._applyPurchasePayment(purchase, total_sum, t);
      }
    });

    const result = await PurchaseModel.findOne({
      where:   { id: purchase.id },
      include: [
        { model: PurchaseItemModel, as: 'items' },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
      ],
    });
    res.status(201).json(result);
  };

  update = async (req, res) => {
    const purchase = await PurchaseModel.findOne({ where: { id: req.params.id } });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    if (purchase.status === 'confirmed') throw new HttpException(400, 'Tasdiqlangan hujjatni tahrirlab bo\'lmaydi');

    const { items = [], ...header } = req.body;
    const { total_sum, total_usd } = this._calcTotals(items, header.exchange_rate ?? purchase.exchange_rate);
    header.total_sum = total_sum;
    header.total_usd = total_usd;

    if (header.supplier_id) {
      const sup = await SupplierModel.findByPk(header.supplier_id);
      if (sup) header.supplier = sup.name;
    }

    let result;
    await sequelize.transaction(async (t) => {
      await purchase.update(header, { transaction: t });
      await PurchaseItemModel.destroy({ where: { purchase_id: purchase.id }, transaction: t });
      if (items.length) {
        await PurchaseItemModel.bulkCreate(
          items.map(item => ({ ...item, purchase_id: purchase.id })),
          { transaction: t }
        );
      }
      if (header.status === 'confirmed') {
        await this._applyStock(items, header.exchange_rate ?? purchase.exchange_rate, t);
        await this._applyPurchasePayment(purchase, total_sum, t);
      }
    });

    result = await PurchaseModel.findOne({
      where:   { id: purchase.id },
      include: [
        { model: PurchaseItemModel, as: 'items' },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
      ],
    });
    res.json(result);
  };

  confirm = async (req, res) => {
    const purchase = await PurchaseModel.findOne({
      where:   { id: req.params.id },
      include: [{ model: PurchaseItemModel, as: 'items' }],
    });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    if (purchase.status !== 'draft') throw new HttpException(400, 'Faqat qoralama hujjatni tasdiqlash mumkin');

    await sequelize.transaction(async (t) => {
      await this._applyStock(purchase.items, purchase.exchange_rate, t);
      await this._applyPurchasePayment(purchase, Number(purchase.total_sum), t);
      await purchase.update({ status: 'confirmed' }, { transaction: t });
    });

    const result = await PurchaseModel.findOne({
      where:   { id: purchase.id },
      include: [
        { model: PurchaseItemModel, as: 'items' },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
      ],
    });
    res.json(result);
  };

  cancel = async (req, res) => {
    const purchase = await PurchaseModel.findOne({
      where:   { id: req.params.id },
      include: [{ model: PurchaseItemModel, as: 'items' }],
    });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    if (purchase.status === 'cancelled') throw new HttpException(400, 'Allaqachon bekor qilingan');

    await sequelize.transaction(async (t) => {
      if (purchase.status === 'confirmed') {
        await this._reverseStock(purchase.items, t);
        await this._reversePurchasePayment(purchase, t);
      }
      await purchase.update({ status: 'cancelled' }, { transaction: t });
    });

    res.json(purchase);
  };

  delete = async (req, res) => {
    const purchase = await PurchaseModel.findOne({ where: { id: req.params.id } });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    if (purchase.status === 'confirmed') throw new HttpException(400, 'Tasdiqlangan hujjatni o\'chirib bo\'lmaydi');
    await PurchaseItemModel.destroy({ where: { purchase_id: purchase.id } });
    await purchase.destroy({ force: true });
    res.json({ message: req.mf('data has been deleted') });
  };

  getFifoPrices = async (req, res) => {
    const batches = await PurchaseItemModel.findAll({
      include: [{
        model:      PurchaseModel,
        as:         'purchase',
        where:      { status: 'confirmed' },
        attributes: ['id', 'date'],
      }],
      where: sequelize.literal(
        '(`PurchaseItemModel`.`unit_qty` - `PurchaseItemModel`.`sold_qty`) > 0'
      ),
      order: [
        [{ model: PurchaseModel, as: 'purchase' }, 'date', 'ASC'],
        ['id', 'ASC'],
      ],
      attributes: ['product_id', 'retail_price_sum', 'wholesale_price_sum', 'cost_price'],
    });

    const result = {};
    for (const b of batches) {
      if (!b.product_id || result[b.product_id]) continue;
      result[b.product_id] = {
        product_id:      b.product_id,
        retail_price:    Number(b.retail_price_sum)    || 0,
        wholesale_price: Number(b.wholesale_price_sum) || 0,
        cost_price:      Number(b.cost_price)          || 0,
      };
    }
    res.json(Object.values(result));
  };

  getBatches = async (req, res) => {
    const { search, product_id } = req.query;
    const itemWhere = {};
    if (product_id) itemWhere.product_id = product_id;

    const rows = await PurchaseItemModel.findAll({
      where: itemWhere,
      include: [
        {
          model:      PurchaseModel,
          as:         'purchase',
          where:      { status: 'confirmed' },
          attributes: ['id', 'doc_number', 'date', 'supplier'],
        },
        {
          model:      ProductModel,
          as:         'product',
          attributes: ['id', 'code', 'name', 'unit'],
          required:   false,
        },
      ],
      order: [
        [{ model: PurchaseModel, as: 'purchase' }, 'date', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const result = [];
    for (const b of rows) {
      const productName = b.product?.name || b.product_name || '';
      const productCode = b.product?.code || '';
      const productUnit = b.product?.unit || 'Dona';

      if (search) {
        const q = search.toLowerCase();
        if (!productName.toLowerCase().includes(q) && !productCode.toLowerCase().includes(q)) continue;
      }

      const soldSum  = await SaleItemModel.sum('total_sum', { where: { purchase_item_id: b.id } }) || 0;
      const unitQty  = Number(b.unit_qty)   || 0;
      const soldQty  = Number(b.sold_qty)   || 0;
      const costPrice = Number(b.cost_price) || 0;

      result.push({
        id:            b.id,
        product_id:    b.product_id,
        product_name:  productName,
        product_code:  productCode,
        product_unit:  productUnit,
        purchase_id:   b.purchase_id,
        purchase_doc:  b.purchase?.doc_number,
        purchase_date: b.purchase?.date,
        supplier:      b.purchase?.supplier || '',
        cost_price:    costPrice,
        unit_qty:      unitQty,
        sold_qty:      soldQty,
        remaining:     Math.max(0, unitQty - soldQty),
        sold_sum:      Number(soldSum),
        total_cost:    costPrice * unitQty,
      });
    }
    res.json(result);
  };

  // ── Private helpers ─────────────────────────────────────────────

  _calcTotals(items, exchangeRate) {
    const rate = Number(exchangeRate) || 11000;
    let total_sum = 0;
    items.forEach(item => { total_sum += Number(item.total_sum) || 0; });
    return { total_sum, total_usd: rate > 0 ? total_sum / rate : 0 };
  }

  // Kirim tasdiqlananda — har doim supplier.balance kamaytir (biz qarzdor bo'lamiz)
  // To'lov turi muhim emas, kassaga hech narsa yozilmaydi.
  // Haqiqiy to'lov faqat Yetkazuvchilar sahifasidan amalga oshiriladi.
  async _applyPurchasePayment(purchase, totalSum, transaction) {
    if (!purchase.supplier_id) return;
    const supplier = await SupplierModel.findByPk(purchase.supplier_id, { transaction });
    if (!supplier) return;
    await supplier.update(
      { balance: Number(supplier.balance) - totalSum },
      { transaction }
    );
  }

  // Bekor qilganda — supplier qarzini qaytarish
  async _reversePurchasePayment(purchase, transaction) {
    if (!purchase.supplier_id) return;
    const supplier = await SupplierModel.findByPk(purchase.supplier_id, { transaction });
    if (!supplier) return;
    await supplier.update(
      { balance: Number(supplier.balance) + Number(purchase.total_sum) },
      { transaction }
    );
  }

  async _applyStock(items, exchangeRate, transaction) {
    const rate = Number(exchangeRate) || 11000;
    for (const item of items) {
      if (!item.product_id) continue;
      const product = await ProductModel.findOne({ where: { id: item.product_id }, transaction });
      if (!product) continue;
      const addQty    = Number(item.unit_qty)   || 0;
      const costPrice = Number(item.cost_price) || Number(item.unit_price) || 0;

      const retailMarkup    = Number(item.retail_markup_pct)    || 0;
      const wholesaleMarkup = Number(item.wholesale_markup_pct) || 0;

      const newRetail = Number(item.retail_price_sum)
        || (costPrice > 0 && retailMarkup > 0    ? +(costPrice * (1 + retailMarkup    / 100)).toFixed(2) : 0)
        || costPrice || 0;

      const newWholesale = Number(item.wholesale_price_sum)
        || (costPrice > 0 && wholesaleMarkup > 0 ? +(costPrice * (1 + wholesaleMarkup / 100)).toFixed(2) : 0)
        || costPrice || 0;

      const updates = { qty: Number(product.qty) + addQty };
      if (newRetail    > 0) updates.retail_price    = newRetail;
      if (newWholesale > 0) updates.wholesale_price = newWholesale;
      if (Number(item.retail_price_usd)    > 0) updates.retail_price_usd    = Number(item.retail_price_usd);
      if (Number(item.wholesale_price_usd) > 0) updates.wholesale_price_usd = Number(item.wholesale_price_usd);

      await product.update(updates, { transaction });
    }
  }

  async _reverseStock(items, transaction) {
    for (const item of items) {
      if (!item.product_id) continue;
      const product = await ProductModel.findOne({ where: { id: item.product_id }, transaction });
      if (!product) continue;
      const subQty = Number(item.unit_qty) || 0;
      await product.update(
        { qty: Math.max(0, Number(product.qty) - subQty) },
        { transaction }
      );
    }
  }
}

module.exports = new PurchaseController();
