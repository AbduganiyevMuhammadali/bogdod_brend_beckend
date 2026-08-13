const ProductModel = require('../models/product.model');
const HttpException = require('../utils/HttpException.utils');
const { Op } = require('sequelize');
const BaseController = require('./BaseController');
const { barcodeVariants } = require('../utils/barcode.utils');

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

  // Bir necha ming tovarda ro'yxat hech qachon to'liq tortilmaydi: sahifa
  // bo'yicha beriladi. Frontend kerak bo'lsa keyingi sahifani so'raydi.
  //
  // `limit=0` endi "hammasi" degani emas — bunday so'rov 2000+ satrni
  // JSON'ga aylantirib, brauzerni qotirardi. Uning o'rniga MAX_LIMIT
  // ishlaydi, ya'ni eski chaqiruvlar ham xavfsiz sahifalanadi.
  getAll = async (req, res) => {
    const { search, category, active, page = 1 } = req.query;

    const MAX_LIMIT = 500;
    const rawLimit  = Number(req.query.limit);
    // limit=0 / 'all' / noto'g'ri qiymat → standart sahifa hajmi
    const limit  = rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 100;
    const offset = Math.max(0, (Number(page) || 1) - 1) * limit;

    const where = {};

    if (search) {
      const q = String(search).trim();
      // Prefiks qidiruv (`q%`) indeksdan foydalanadi — `%q%` esa yo'q va
      // har harfda butun jadvalni skanerlaydi. Nom bo'yicha shuning uchun
      // prefiksdan boshlaymiz; kod va shtrix-kod baribir aniq/prefiks
      // qidiriladi, bu skaner uchun ham to'g'ri xulq.
      //
      // So'z o'rtasidan qidirish kerak bo'lgan holat uchun (masalan
      // "adidas krossovka" dagi "krossovka") nom bo'yicha `%q%` ham
      // qoldirilgan, lekin u faqat prefiks hech narsa topmaganda emas —
      // OR sifatida ishlaydi va indeks qisman yordam beradi.
      where[Op.or] = [
        { name:         { [Op.like]: `${q}%` } },
        { name:         { [Op.like]: `% ${q}%` } },  // so'z boshidan
        { general_name: { [Op.like]: `${q}%` } },
        { code:         { [Op.like]: `${q}%` } },
        { brand:        { [Op.like]: `${q}%` } },
        // Shtrix-kod: skaner boshidagi nolni tushirib yuborgan bo'lishi
        // mumkin, shuning uchun barcha shakllar bo'yicha qidiramiz
        ...barcodeVariants(q).map(v => ({ barcodes: { [Op.like]: `%"${v}%` } })),
      ];
    }
    if (category && category !== 'all') where.category = category;
    if (active !== undefined) where.active = active === 'true';

    // Sotuv sahifasi odatda faqat qoldig'i bor tovarni ko'rsatadi. Bu
    // filtr serverda bo'lishi shart: brauzerda filtrlansa sahifadagi
    // 100 tadan bir nechtasi qolib, ro'yxat "kam" bo'lib ko'rinardi.
    if (req.query.in_stock === 'true' || req.query.in_stock === '1') {
      where.qty = { [Op.gt]: 0 };
    }

    // Kam zaxira filtri serverda bajariladi — brauzerda filtrlansa faqat
    // yuklangan sahifadagi tovarlar tekshirilib, qolgani e'tibordan chetda
    // qolardi.
    if (req.query.low_stock === 'true' || req.query.low_stock === '1') {
      const { literal } = require('sequelize');
      where.is_folder = false;
      where[Op.and] = literal('`ProductModel`.`qty` <= `ProductModel`.`min_qty`');
    }

    // findAndCountAll ikkita so'rov yuboradi va COUNT og'ir qism. Faqat
    // birinchi sahifada sanaymiz — keyingi sahifalarda jami o'zgarmaydi,
    // frontend uni birinchi javobdan eslab qoladi.
    const wantCount = offset === 0;

    const rows = await ProductModel.findAll({
      where,
      order: [['name', 'ASC']],
      limit,
      offset,
    });

    const total = wantCount
      ? await ProductModel.count({ where })
      : undefined;

    res.json({
      total,
      page: Number(page) || 1,
      limit,
      // Yana sahifa bormi — frontend "yana yuklash" ni shunga qarab qiladi
      has_more: rows.length === limit,
      data: rows,
    });
  };

  getById = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));
    res.json(product);
  };

  // Shtrix-kod bo'yicha aniq qidiruv (sotuv/kirim skaneri uchun)
  // Shtrix-kod bo'yicha aniq qidiruv (sotuv/kirim skaneri uchun).
  //
  // Skaner `0` bilan boshlanadigan EAN-13 ni UPC-A deb hisoblab, boshidagi
  // nolni tushirib yuborishi mumkin — yorliqda 13 xona, dasturga 12 xona
  // keladi. Shuning uchun bir necha shaklni sinab ko'ramiz
  // (barcodeVariants), aks holda tovar "topilmadi" bo'lib qolardi.
  getByBarcode = async (req, res) => {
    const raw = String(req.params.code || '').trim();

    for (const code of barcodeVariants(raw)) {
      // JSON massiv ichida element sifatida (qo'shtirnoq bilan) mos
      // kelishini tekshiramiz — shunda barcode boshqasining substringi
      // bo'lganda noto'g'ri mahsulot topilmaydi.
      const candidates = await ProductModel.findAll({
        where: { barcodes: { [Op.like]: `%"${code}"%` } },
        limit: 20,
      });
      const product = candidates.find(
        p => Array.isArray(p.barcodes) && p.barcodes.includes(code)
      );
      if (product) return res.json(product);
    }

    throw new HttpException(404, req.mf('data not found'));
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
            // Model (artikul, masalan "112") va razmer alohida narsalar.
            // Model kiritilgan bo'lsa saqlanadi va nom boshida turadi;
            // razmer nom oxiriga qo'shiladi, chunki har razmer alohida
            // mahsulot bo'lib yaratiladi va ular bir-biridan shu bilan
            // farqlanadi. Model bo'sh bo'lsa — razmer uning o'rnini oladi.
            model: (it.model || '').toString().trim() || s.size,
            name: [
              it.model, it.brand, it.general_name || it.name, it.color, s.size,
            ].map(v => (v || '').toString().trim()).filter(Boolean).join(' '),
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

      // Band kodlarni bitta so'rov bilan olamiz. Ilgari har yangi kod uchun
      // alohida SELECT ketardi — 500 ta tovar kiritilganda 500 ta ortiqcha
      // so'rov bo'lib, tezkor kiritish daqiqalab cho'zilardi.
      const takenRows = await ProductModel.findAll({
        attributes: ['code'],
        where: { code: { [Op.like]: 'PRD-%' } },
        paranoid: false,
        raw: true,
        transaction: t,
      });
      const taken = new Set(takenRows.map(r => r.code));

      const toCreate = [];
      for (const e of expanded) {
        const data = this._pick(e.data);
        data.name = (data.name || data.general_name || '').toString().trim();
        if (!data.general_name) data.general_name = data.name;

        // Kod bo'sh bo'lsa yasaymiz; band bo'lsa keyingisiga o'tamiz
        if (!data.code) {
          let code;
          do {
            code = `PRD-${String(++counter).padStart(5, '0')}`;
          } while (taken.has(code));
          data.code = code;
        }
        taken.add(data.code);   // shu partiya ichida ham takrorlanmasin

        if (e.barcodes) data.barcodes = e.barcodes;
        data.qty = 0;   // qoldiq kirim hujjati orqali qo'shiladi

        toCreate.push({ data, qty: e.qty, cost: Number(e.data.cost_price) || 0 });
      }

      // bitta INSERT. MySQL da bulkCreate ketma-ket auto-increment
      // id'larni qaytgan instansiyalarga yozib beradi — quyida kirim
      // hujjati satrlari uchun aynan shu id'lar kerak.
      const rows = await ProductModel.bulkCreate(
        toCreate.map(c => c.data),
        { transaction: t }
      );

      created = rows.map((p, i) => ({
        product: p,
        qty:     toCreate[i].qty,
        cost:    toCreate[i].cost,
      }));

      // id yozilmagan bo'lsa keyingi qadamlar (kirim hujjati, FIFO)
      // jimgina buzilardi — yarim yozilgan holat qolmasligi uchun
      // tranzaksiyani shu yerda to'xtatamiz.
      if (created.some(c => !c.product.id)) {
        throw new HttpException(500, 'Mahsulot id\'lari olinmadi — kiritish bekor qilindi');
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

        // Qoldiqni yozish. Har mahsulot uchun alohida UPDATE o'rniga
        // bir nechta CASE bilan bitta so'rov — 500 ta tovarda sezilarli.
        const ids  = withQty.map(c => c.product.id);
        const cases = withQty
          .map(c => `WHEN ${Number(c.product.id)} THEN ${Number(c.qty)}`)
          .join(' ');
        await sequelize.query(
          `UPDATE \`product\` SET \`qty\` = CASE \`id\` ${cases} END
            WHERE \`id\` IN (${ids.map(Number).join(',')})`,
          { transaction: t }
        );
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

  // Mahsulotni o'chirish.
  //
  // Ilgari bu `force: true` bilan mahsulotni butunlay o'chirib yuborardi —
  // qoldig'i bor, sotuv tarixi bor tovar ham yo'q bo'lardi va hisobotlar
  // buzilardi. Endi:
  //   • qoldig'i bor bo'lsa           → o'chirilmaydi
  //   • sotuv/kirim tarixi bor bo'lsa → butunlay emas, "arxivga" olinadi
  //     (paranoid delete: satr bazada qoladi, hisobot buzilmaydi)
  //   • tarixi yo'q bo'lsa            → butunlay o'chiriladi
  delete = async (req, res) => {
    const product = await ProductModel.findOne({ where: { id: req.params.id } });
    if (!product) throw new HttpException(404, req.mf('data not found'));

    const qty = Number(product.qty) || 0;
    if (qty > 0 && req.query.force !== 'true') {
      throw new HttpException(
        409,
        `"${product.name}" da ${qty} dona qoldiq bor. ` +
        `Avval qoldiqni nolga tushiring yoki tovarni faolsiz qiling.`,
        { code: 'QOLDIQ_BOR', qty }
      );
    }

    // Tarixi bormi — sotuv yoki kirim satrlari
    const SaleItemModel     = require('../models/sale_item.model');
    const PurchaseItemModel = require('../models/purchase_item.model');
    const [sold, bought] = await Promise.all([
      SaleItemModel.count({ where: { product_id: product.id } }).catch(() => 0),
      PurchaseItemModel.count({ where: { product_id: product.id } }).catch(() => 0),
    ]);

    if (sold > 0 || bought > 0) {
      // Tarixi bor — faqat arxivga olamiz (paranoid). Shunda eski
      // hisobotlarda tovar nomi ko'rinib turadi.
      await product.destroy();
      return res.json({
        message: 'Mahsulot arxivga olindi (sotuv/kirim tarixi saqlanadi)',
        arxiv: true,
        sotuvlar: sold,
        kirimlar: bought,
      });
    }

    // Tarixi yo'q — butunlay o'chirish xavfsiz
    await product.destroy({ force: true });
    res.json({ message: req.mf('data has been deleted') });
  };

  uploadPhoto = async (req, res) => {
    if (!req.file) throw new HttpException(400, 'Rasm yuklanmadi');
    res.json({ url: `/uploads/${req.file.filename}` });
  };

  // Kategoriyalar va har birida nechta tovar borligi.
  //
  // Sanoq ham shu yerda qaytadi — aks holda frontend har kategoriya
  // yonidagi raqamni ko'rsatish uchun butun ro'yxatni yuklashga majbur
  // bo'lardi. `?with_counts=1` bo'lmasa eski shakl (oddiy massiv)
  // qaytadi, shunda bu endpointning boshqa chaqiruvchilari buzilmaydi.
  getCategories = async (req, res) => {
    const { fn, col } = require('sequelize');

    const rows = await ProductModel.findAll({
      attributes: [
        'category',
        [fn('COUNT', col('id')), 'n'],
      ],
      where: { category: { [Op.ne]: null } },
      group: ['category'],
      order: [['category', 'ASC']],
      raw: true,
    });

    if (req.query.with_counts) {
      return res.json(rows.map(r => ({
        category: r.category,
        count:    Number(r.n) || 0,
      })));
    }
    res.json(rows.map(r => r.category));
  };

  // Bazada mavjud brendlar — tezkor kiritishda taklif sifatida ishlatiladi.
  // Shunda boshqa kompyuterda kiritilgan brend ham taklifga tushadi.
  // Ko'p ishlatilgani oldinda turadi.
  getBrands = async (req, res) => {
    const rows = await ProductModel.findAll({
      attributes: [
        'brand',
        [ProductModel.sequelize.fn('COUNT', ProductModel.sequelize.col('id')), 'n'],
      ],
      where: { brand: { [Op.ne]: null, [Op.ne]: '' } },
      group: ['brand'],
      order: [[ProductModel.sequelize.literal('n'), 'DESC']],
      limit: 100,
      raw: true,
    });
    res.json(rows.map(r => r.brand).filter(Boolean));
  };

  // Mahsulotlar sahifasi tepasidagi ko'rsatkichlar.
  //
  // Ilgari bu qiymatlar brauzerda butun ro'yxat ustidan hisoblanardi —
  // ya'ni ko'rsatkich to'g'ri chiqishi uchun 2000+ satrni yuklash kerak
  // edi. Endi bitta agregat so'rov bilan bazada hisoblanadi va sahifa
  // nechta tovar yuklanganidan qat'i nazar to'g'ri ko'rsatadi.
  getStats = async (req, res) => {
    const { literal, fn, col } = require('sequelize');
    const { category, active } = req.query;

    const where = { is_folder: false };
    if (category && category !== 'all') where.category = category;
    if (active !== undefined) where.active = active === 'true';

    const [row] = await ProductModel.findAll({
      where,
      attributes: [
        [fn('COUNT', col('id')), 'total'],
        [fn('COUNT', fn('DISTINCT', col('category'))), 'cats'],
        [fn('SUM', literal('CASE WHEN `qty` <= `min_qty` THEN 1 ELSE 0 END')), 'low_stock'],
        // Ombordagi tovarning sotuv narxidagi qiymati
        [fn('SUM', literal('`qty` * `retail_price`')), 'stock_value'],
      ],
      raw: true,
    });

    res.json({
      total:       Number(row?.total)       || 0,
      cats:        Number(row?.cats)        || 0,
      lowStock:    Number(row?.low_stock)   || 0,
      stockValue:  Number(row?.stock_value) || 0,
    });
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
