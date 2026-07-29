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

class ProductController extends BaseController {

  getAll = async (req, res) => {
    const { search, category, active, page = 1, limit = 200 } = req.query;
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

    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows } = await ProductModel.findAndCountAll({
      where,
      order: [['name', 'ASC']],
      limit:  Number(limit),
      offset,
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

    // auto-generate code if empty
    if (!data.code) {
      const count = await ProductModel.count();
      data.code = `PRD-${String(count + 1).padStart(5, '0')}`;
    }

    const product = await ProductModel.create(data);
    res.status(201).json(product);
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
