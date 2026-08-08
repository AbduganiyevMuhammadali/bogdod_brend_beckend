const { Op } = require('sequelize');
const sequelize            = require('../db/db-sequelize');
const PurchaseModel        = require('../models/purchase.model');
const PurchaseItemModel    = require('../models/purchase_item.model');
const ProductModel         = require('../models/product.model');
const SaleItemModel        = require('../models/sale_item.model');
const ProductRegisterModel = require('../models/product_register.model');
const SupplierModel        = require('../models/supplier.model');
const UserModel            = require('../models/user.model');
const HttpException        = require('../utils/HttpException.utils');
const BaseController       = require('./BaseController');

class PurchaseController extends BaseController {

  getAll = async (req, res) => {
    const { search, status, warehouse, comment, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status    && status    !== 'all') where.status    = status;
    if (warehouse && warehouse !== 'all') where.warehouse = warehouse;
    // Izoh bo'yicha filtr — tezkor kiritish tarixi faqat "Boshlang'ich
    // qoldiq" hujjatlarini so'raydi. Ilgari hamma hujjat yuborilib,
    // brauzerda filtrlanardi: 200+ hujjatda bu sezilarli kechikish berardi.
    if (comment) where.comment = { [Op.like]: `%${comment}%` };
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
      // `items` faqat sanash uchun kerak — butun qatorlarni tortmaymiz
      include: [
        { model: PurchaseItemModel, as: 'items', attributes: ['id'] },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
        { model: UserModel,         as: 'creator', attributes: ['id', 'fullname', 'username'], required: false },
        { model: UserModel,         as: 'printer', attributes: ['id', 'fullname', 'username'], required: false },
      ],
      distinct: true,   // items bilan JOIN'da count to'g'ri chiqishi uchun
    });
    res.json({ total: count, page: Number(page), data: rows });
  };

  getById = async (req, res) => {
    const purchase = await PurchaseModel.findOne({
      where:   { id: req.params.id },
      include: [
        // Mahsulotning joriy modeli/nomi ham keladi — tarixda va yorliqda
        // model ko'rsatish uchun. `product_name` saqlangan paytdagi nom,
        // u eski hujjatlarda modelsiz bo'lishi mumkin.
        {
          model: PurchaseItemModel, as: 'items',
          include: [{
            model: ProductModel, as: 'product', required: false,
            attributes: ['id', 'name', 'model', 'brand', 'general_name', 'color'],
          }],
        },
        { model: SupplierModel,     as: 'supplierRef', attributes: ['id', 'name', 'balance'] },
        { model: UserModel,         as: 'creator', attributes: ['id', 'fullname', 'username'], required: false },
        { model: UserModel,         as: 'printer', attributes: ['id', 'fullname', 'username'], required: false },
      ],
    });
    if (!purchase) throw new HttpException(404, req.mf('data not found'));
    res.json(purchase);
  };

  // Yorliqlar chop etilganini belgilash. Tarixda qaysi hujjatga yorliq
  // bosilgani ko'rinib tursin — aks holda qayta chop etib, ortiqcha
  // yorliq sarflanadi yoki aksincha, chop etilmagani e'tibordan qoladi.
  markLabelsPrinted = async (req, res) => {
    const purchase = await PurchaseModel.findByPk(req.params.id);
    if (!purchase) throw new HttpException(404, req.mf('data not found'));

    // `printed: false` yuborilsa belgi olib tashlanadi — noto'g'ri
    // bosilgan bo'lsa qaytarish uchun
    const printed = req.body?.printed !== false;

    await purchase.update({
      labels_printed_at: printed ? new Date() : null,
      labels_printed_by: printed ? (req.currentUser?.id ?? null) : null,
    });

    const fresh = await PurchaseModel.findOne({
      where: { id: purchase.id },
      include: [
        { model: UserModel, as: 'printer', attributes: ['id', 'fullname', 'username'], required: false },
      ],
    });
    res.json(fresh);
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

  // Tezkor kiritishda tannarx ko'pincha "keyin kiritamiz" deb bo'sh qoldiriladi.
  // Bu yerda saqlangan hujjatning bitta qatoridagi tannarx va sotuv narxini
  // keyinchalik to'g'rilash mumkin. Tannarx FIFO foydasini belgilaydi, shuning
  // uchun shu partiyadan allaqachon sotilgan yozuvlar (product_register,
  // sale_item) ham yangi tannarxga ko'chiriladi — aks holda foyda hisoboti
  // 0 tannarx bilan qolib ketadi.
  updateItemPrices = async (req, res) => {
    const item = await PurchaseItemModel.findOne({
      where:   { id: req.params.itemId, purchase_id: req.params.id },
      include: [{ model: PurchaseModel, as: 'purchase' }],
    });
    if (!item) throw new HttpException(404, req.mf('data not found'));

    const hasCost   = req.body.cost_price       !== undefined && req.body.cost_price       !== null && req.body.cost_price       !== '';
    const hasRetail = req.body.retail_price_sum !== undefined && req.body.retail_price_sum !== null && req.body.retail_price_sum !== '';
    if (!hasCost && !hasRetail) throw new HttpException(400, 'Yangilash uchun narx yuborilmadi');

    const costPrice   = hasCost   ? Number(req.body.cost_price)       : Number(item.cost_price);
    const retailPrice = hasRetail ? Number(req.body.retail_price_sum) : Number(item.retail_price_sum);
    if (hasCost   && (!Number.isFinite(costPrice)   || costPrice   < 0)) throw new HttpException(400, 'Tannarx noto\'g\'ri');
    if (hasRetail && (!Number.isFinite(retailPrice) || retailPrice < 0)) throw new HttpException(400, 'Sotuv narxi noto\'g\'ri');

    const unitQty = Number(item.unit_qty) || 0;

    await sequelize.transaction(async (t) => {
      const itemUpdates = {};
      if (hasCost) {
        itemUpdates.cost_price     = costPrice;
        itemUpdates.unit_price     = costPrice;
        itemUpdates.pkg_price      = costPrice * (Number(item.units_per_pkg) || 1);
        itemUpdates.total_sum      = costPrice * unitQty;
        itemUpdates.total_cost_sum = costPrice * unitQty;
      }
      if (hasRetail) itemUpdates.retail_price_sum = retailPrice;
      await item.update(itemUpdates, { transaction: t });

      // Hujjat jami summasi qatorlar yig'indisidan qayta hisoblanadi
      if (hasCost && item.purchase) {
        const rows = await PurchaseItemModel.findAll({
          where: { purchase_id: item.purchase_id }, transaction: t,
        });
        const total = rows.reduce((a, r) => a + (Number(r.total_sum) || 0), 0);
        const rate  = Number(item.purchase.exchange_rate) || 11000;

        // Yetkazuvchi qarzi hujjat summasidan kelib chiqadi — farqni tuzatamiz
        const diff = total - (Number(item.purchase.total_sum) || 0);
        if (diff !== 0 && item.purchase.status === 'confirmed' && item.purchase.supplier_id) {
          const supplier = await SupplierModel.findByPk(item.purchase.supplier_id, { transaction: t });
          if (supplier) {
            await supplier.update(
              { balance: Number(supplier.balance) - diff },
              { transaction: t }
            );
          }
        }

        await item.purchase.update(
          { total_sum: total, total_usd: rate > 0 ? total / rate : 0 },
          { transaction: t }
        );
      }

      // Mahsulot kartochkasidagi sotuv narxi (tannarx product jadvalida
      // saqlanmaydi — u har doim partiyadan, ya'ni FIFO orqali olinadi)
      if (hasRetail && item.product_id) {
        const product = await ProductModel.findByPk(item.product_id, { transaction: t });
        if (product) await product.update({ retail_price: retailPrice }, { transaction: t });
      }

      // Shu partiyadan sotilgan yozuvlardagi tannarx — foyda hisoboti uchun
      if (hasCost) {
        await ProductRegisterModel.update(
          { cost_price: costPrice },
          { where: { purchase_item_id: item.id, status: 'active' }, transaction: t }
        );
        await SaleItemModel.update(
          { cost_price: costPrice },
          { where: { purchase_item_id: item.id }, transaction: t }
        );
      }
    });

    const fresh = await PurchaseItemModel.findByPk(item.id);
    res.json(fresh);
  };

  // Har mahsulot uchun eng eski ochiq partiyaning narxi (FIFO).
  //
  // Ilgari BARCHA ochiq partiyalar tortib olinib, keraklisi JS da
  // tanlanardi — sotuv sahifasi har qidiruvda shuni chaqirgani uchun
  // mahsulot ko'paygan sari sezilarli kechikish berardi.
  // Endi tanlash SQL da bo'ladi va `ids` berilsa faqat o'sha
  // mahsulotlar uchun hisoblanadi.
  getFifoPrices = async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(v => parseInt(v, 10))
      .filter(Number.isInteger);

    // Har product_id bo'yicha eng eski partiyani tanlaymiz: avval
    // guruhlab minimal (sana, id) ni topamiz, so'ng o'sha qatorni olamiz.
    const rows = await sequelize.query(
      `SELECT pi.product_id,
              pi.retail_price_sum,
              pi.wholesale_price_sum,
              pi.cost_price
         FROM purchase_item pi
         JOIN purchase p ON p.id = pi.purchase_id
         JOIN (
              SELECT pi2.product_id,
                     MIN(CONCAT(DATE_FORMAT(p2.date, '%Y%m%d%H%i%s'),
                                LPAD(pi2.id, 12, '0'))) AS mk
                FROM purchase_item pi2
                JOIN purchase p2 ON p2.id = pi2.purchase_id
               WHERE p2.status = 'confirmed'
                 AND (pi2.unit_qty - pi2.sold_qty) > 0
                 AND pi2.product_id IS NOT NULL
                 ${ids.length ? 'AND pi2.product_id IN (:ids)' : ''}
               GROUP BY pi2.product_id
         ) f ON f.product_id = pi.product_id
            AND CONCAT(DATE_FORMAT(p.date, '%Y%m%d%H%i%s'),
                       LPAD(pi.id, 12, '0')) = f.mk
        WHERE p.status = 'confirmed'
          AND (pi.unit_qty - pi.sold_qty) > 0`,
      {
        replacements: ids.length ? { ids } : {},
        type: sequelize.QueryTypes.SELECT,
      }
    );

    res.json(rows.map(b => ({
      product_id:      b.product_id,
      retail_price:    Number(b.retail_price_sum)    || 0,
      wholesale_price: Number(b.wholesale_price_sum) || 0,
      cost_price:      Number(b.cost_price)          || 0,
    })));
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
