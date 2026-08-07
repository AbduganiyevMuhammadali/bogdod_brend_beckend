const ProductModel = require('../models/product.model');
const HttpException = require('../utils/HttpException.utils');
const { Op } = require('sequelize');
const BaseController = require('./BaseController');

const ALLOWED_FIELDS = [
  'code', 'name', 'general_name', 'unit', 'brand', 'model', 'country',
  'category', 'color', 'extra_name1', 'extra_name2', 'extra_name3',
  'barcodes', 'photo', 'wholesale_price', 'wholesale_price_usd',
  'retail_price', 'retail_price_usd', 'currency', 'qty', 'min_qty',
  'is_folder', 'active',
];

// Keyingi bo'sh PRD-kodni topadi.
//
// count() ga tayanib bo'lmaydi: mahsulot o'chirilganda (paranoid: true)
// u sanalmaydi, lekin kodi bazada qoladi — natijada "code must be unique"
// xatosi chiqadi. Shuning uchun mavjud eng katta raqamdan davom etamiz va
// band kodni uchratsak keyingisiga o'tamiz.
async function nextProductCode(transaction = null) {
  const last = await ProductModel.findOne({
    where: { code: { [Op.like]: 'PRD-%' } },
    order: [['code', 'DESC']],
    paranoid: false,
    transaction,
  });
  let n = last ? (parseInt(String(last.code).replace('PRD-', ''), 10) || 0) : 0;

  let code;
  do {
    code = `PRD-${String(++n).padStart(5, '0')}`;
  } while (await ProductModel.findOne({ where: { code }, paranoid: false, transaction }));
  return code;
}

class ProductController extends BaseController {

  getAll = async (req, res) => {
    // limit=0 (yoki 'all') — hammasini qaytar. Mahsulotlar sahifasi butun
    // ro'yxatni bir marta oladi: do'konda bir necha ming tovar bo'lsa ham
    // qidiruv/filtr brauzerda darhol ishlashi kerak.
    const { search, category, active, page = 1 } = req.query;
    const rawLimit = req.query.limit;
    const noLimit  = rawLimit === '0' || rawLimit === 'all';
    const limit    = noLimit ? null : (Number(rawLimit) > 0 ? Number(rawLimit) : 200);
    const where = {};

    if (search) {
      where[Op.or] = [
        { name:         { [Op.like]: `%${search}%` } },
        { general_name: { [Op.like]: `%${search}%` } },
        { code:         { [Op.like]: `%${search}%` } },
        { brand:        { [Op.like]: `%${search}%` } },
        { barcodes:     { [Op.like]: `%${search}%` } },
      ];
    }
    if (category && category !== 'all') where.category = category;
    if (active !== undefined) where.active = active === 'true';

    const { count, rows } = await ProductModel.findAndCountAll({
      where,
      order: [['name', 'ASC']],
      ...(noLimit ? {} : { limit, offset: (Number(page) - 1) * limit }),
    });

    res.json({ total: count, page: Number(page), data: rows });
  };

  getById = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));
    res.json(product);
  };

  // Shtrix-kod bo'yicha aniq qidiruv (sotuv/kirim skaneri uchun)
  getByBarcode = async (req, res) => {
    const code = req.params.code;
    // JSON massiv ichida element sifatida (qo'shtirnoq bilan) mos kelishini tekshiramiz —
    // shunda barcode boshqasining substringi bo'lganda noto'g'ri mahsulot topilmaydi.
    const candidates = await ProductModel.findAll({
      where: { barcodes: { [Op.like]: `%"${code}"%` } },
      limit: 5,
    });
    const product = candidates.find(p => Array.isArray(p.barcodes) && p.barcodes.includes(code));
    if (!product) throw new HttpException(404, req.mf('data not found'));
    res.json(product);
  };

  create = async (req, res) => {
    const data = this._pick(req.body);

    if (!data.name) throw new HttpException(400, 'Mahsulot nomi kiritilishi shart');

    if (!data.code) data.code = await nextProductCode();

    const product = await ProductModel.create(data);
    res.status(201).json(product);
  };

  // Do'konni tizimga o'tkazishda ishlatiladi: bir necha o'nlab mahsulotni
  // bitta so'rovda yaratadi va ular uchun bitta "boshlang'ich qoldiq" kirim
  // hujjatini ochadi. Kirim hujjati shart — FIFO tannarx shu orqali
  // shakllanadi, aks holda foyda hisoboti tannarxsiz qoladi.
  //
  // Kutilayotgan tana:
  //   { items: [{ ...mahsulot maydonlari, cost_price, qty }], supplier_id? }
  // Har bir element ixtiyoriy ravishda `sizes: [{ size, qty, barcode }]`
  // berishi mumkin — bunda har razmer alohida mahsulot bo'lib yaratiladi.
  bulkCreate = async (req, res) => {
    const { items = [], supplier_id = null, doc_date = null } = req.body;
    if (!Array.isArray(items) || !items.length) {
      throw new HttpException(400, 'Mahsulotlar ro\'yxati bo\'sh');
    }

    // Razmerli qatorlarni alohida mahsulotlarga yoyamiz
    const expanded = [];
    items.forEach((it, idx) => {
      const sizes = Array.isArray(it.sizes) ? it.sizes.filter(s => s && s.size) : [];
      if (!sizes.length) {
        expanded.push({ src: idx, data: it, qty: Number(it.qty) || 0, barcodes: it.barcodes });
        return;
      }
      sizes.forEach(s => {
        expanded.push({
          src: idx,
          data: {
            ...it,
            model: s.size,                       // razmer `model` maydonida saqlanadi
            name: [it.brand, it.general_name || it.name, s.size, it.color]
              .map(v => (v || '').toString().trim()).filter(Boolean).join(' '),
          },
          qty: Number(s.qty) || 0,
          barcodes: s.barcode ? [s.barcode] : [],
        });
      });
    });

    // Kiritishdan oldin tekshiramiz — yarim yozilgan holat qolmasligi uchun
    const xatolar = [];
    expanded.forEach((e, i) => {
      const nm = (e.data.name || e.data.general_name || '').toString().trim();
      if (!nm) xatolar.push(`${e.src + 1}-qator: nomi bo'sh`);
      if (Number(e.data.retail_price) < 0) xatolar.push(`${e.src + 1}-qator: sotuv narxi manfiy`);
      if (Number(e.data.cost_price) < 0)   xatolar.push(`${e.src + 1}-qator: tannarx manfiy`);
    });
    if (xatolar.length) throw new HttpException(400, xatolar.join('; '));

    const sequelize = ProductModel.sequelize;
    const PurchaseModel     = require('../models/purchase.model');
    const PurchaseItemModel = require('../models/purchase_item.model');

    let created = [];
    let purchaseId = null;

    await sequelize.transaction(async (t) => {
      // Kod count() dan yasalsa, o'chirilgan mahsulotlar sanalmaydi
      // (paranoid: true), lekin ularning kodi bazada qoladi — natijada
      // takroriy kod chiqadi. Shuning uchun mavjud eng katta PRD-raqamdan
      // davom ettiramiz, o'chirilganlarni ham hisobga olib.
      const lastCoded = await ProductModel.findOne({
        where: { code: { [Op.like]: 'PRD-%' } },
        order: [['code', 'DESC']],
        paranoid: false,
        transaction: t,
      });
      let counter = lastCoded
        ? (parseInt(String(lastCoded.code).replace('PRD-', ''), 10) || 0)
        : 0;

      for (const e of expanded) {
        const data = this._pick(e.data);
        data.name = (data.name || data.general_name || '').toString().trim();
        if (!data.general_name) data.general_name = data.name;

        // Kod bo'sh bo'lsa yasaymiz; band bo'lsa keyingisiga o'tamiz
        if (!data.code) {
          let code;
          do {
            code = `PRD-${String(++counter).padStart(5, '0')}`;
          } while (await ProductModel.findOne({
            where: { code }, paranoid: false, transaction: t,
          }));
          data.code = code;
        }
        if (e.barcodes) data.barcodes = e.barcodes;
        data.qty = 0;   // qoldiq kirim hujjati orqali qo'shiladi

        const p = await ProductModel.create(data, { transaction: t });
        created.push({ product: p, qty: e.qty, cost: Number(e.data.cost_price) || 0 });
      }

      // Qoldiqli mahsulotlar uchun bitta kirim hujjati
      const withQty = created.filter(c => c.qty > 0);
      if (withQty.length) {
        const maxDoc = await PurchaseModel.max('doc_number', { transaction: t });
        const total  = withQty.reduce((a, c) => a + c.qty * c.cost, 0);

        const purchase = await PurchaseModel.create({
          doc_number: (Number(maxDoc) || 0) + 1,
          date: doc_date || new Date(),
          supplier_id,
          comment: 'Boshlang\'ich qoldiq',
          status: 'confirmed',
          total_sum: total,
          created_by: req.currentUser?.id ?? null,
        }, { transaction: t });
        purchaseId = purchase.id;

        await PurchaseItemModel.bulkCreate(
          withQty.map(c => ({
            purchase_id:    purchase.id,
            product_id:     c.product.id,
            product_name:   c.product.name,
            barcode:        (c.product.barcodes || [])[0] || null,
            pkg_qty:        c.qty,
            unit_qty:       c.qty,
            units_per_pkg:  1,
            stock_qty:      c.qty,       // FIFO uchun mavjud qoldiq
            sold_qty:       0,
            pkg_price:      c.cost,
            unit_price:     c.cost,
            cost_price:     c.cost,
            total_sum:      c.qty * c.cost,
            total_cost_sum: c.qty * c.cost,
            retail_price_sum: Number(c.product.retail_price) || 0,
          })),
          { transaction: t }
        );

        for (const c of withQty) {
          await c.product.update({ qty: c.qty }, { transaction: t });
        }
      }
    });

    res.status(201).json({
      ok: true,
      yaratildi: created.length,
      kirim_hujjati: purchaseId,
      mahsulotlar: created.map(c => ({ id: c.product.id, name: c.product.name })),
    });
  };

  update = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));

    const data = this._pick(req.body);
    await product.update(data);
    res.json(product);
  };

  // Partial update (e.g. toggle active, update qty)
  patch = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));
    const data = this._pick(req.body);
    await product.update(data);
    res.json(product);
  };

  delete = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));
    try {
      await product.destroy({ force: true });
    } catch {
      await product.destroy();
    }
    res.json({ message: req.mf('data has been deleted') });
  };

  uploadPhoto = async (req, res) => {
    if (!req.file) throw new HttpException(400, 'Rasm yuklanmadi');
    res.json({ url: `/uploads/${req.file.filename}` });
  };

  // Get distinct categories from DB
  getCategories = async (req, res) => {
    const rows = await ProductModel.findAll({
      attributes: ['category'],
      group: ['category'],
      where: { category: { [Op.ne]: null } },
    });
    res.json(rows.map(r => r.category));
  };

  // Kam qolgan tovarlar soni (sidebar badge uchun)
  getLowStockCount = async (req, res) => {
    const { literal } = require('sequelize');
    const count = await ProductModel.count({
      where: {
        active: true,
        is_folder: false,
        min_qty: { [Op.gt]: 0 },
        [Op.and]: literal('`ProductModel`.`qty` <= `ProductModel`.`min_qty`'),
      },
    });
    res.json({ count });
  };

  _pick(body) {
    const out = {};
    ALLOWED_FIELDS.forEach(f => {
      if (body[f] !== undefined) out[f] = body[f];
    });
    return out;
  }
}

module.exports = new ProductController();
