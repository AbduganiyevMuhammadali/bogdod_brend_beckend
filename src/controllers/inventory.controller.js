const { Op } = require('sequelize');
const InventoryModel     = require('../models/inventory.model');
const InventoryItemModel = require('../models/inventory_item.model');
const ProductModel       = require('../models/product.model');
const PurchaseItemModel  = require('../models/purchase_item.model');
const PurchaseModel      = require('../models/purchase.model');
const sequelize          = require('../db/db-sequelize');
const HttpException      = require('../utils/HttpException.utils');
const BaseController     = require('./BaseController');
const stockGuard         = require('../utils/stockGuard.utils');
const { barcodeVariants } = require('../utils/barcode.utils');

// Mahsulotning joriy tannarxi — FIFO bo'yicha eng eski ochiq partiyadan.
// Farq summasini hisoblashda ishlatiladi.
async function currentCost(productId, transaction) {
  const batch = await PurchaseItemModel.findOne({
    where: { product_id: productId, stock_qty: { [Op.gt]: 0 } },
    order: [['id', 'ASC']],
    transaction,
  });
  return Number(batch?.cost_price) || 0;
}

// Shtrix-kod bo'yicha mahsulotni topadi.
//
// `barcodes` — JSON massiv (masalan ["123","456"]), shuning uchun aniq
// moslikni SQL o'zi topa olmaydi: LIKE bilan nomzodlarni olib, keyin
// massiv ichida haqiqatan bor-yo'qligini tekshiramiz.
//
// Ilgari bu yerda `limit: 5` bor edi — kod bir necha tovarda substring
// sifatida uchrasa, keraklisi shu 5 tadan tashqarida qolib, tovar
// "bazada yo'q" deb hisoblanardi va ortiqcha ro'yxatiga tushardi.
// Shtrix-kod bo'yicha BARCHA mos tovarlarni topadi.
// Bir kod bir necha tovarga berilgan bo'lsa (razmerlar chalkashgani kabi),
// skanerlash doim birinchisiga tushadi va qolganlari "topilmadi" bo'lib
// qoladi — shuning uchun bunday holatni aniqlab, ogohlantiramiz.
async function findAllProductsByBarcode(code) {
  const found = new Map();
  for (const variant of barcodeVariants(code)) {
    const rows = await ProductModel.findAll({
      where: { barcodes: { [Op.like]: `%${variant}%` } },
      limit: 50,
    });
    rows.forEach(p => {
      if (Array.isArray(p.barcodes) &&
          p.barcodes.some(b => String(b).trim() === variant)) {
        found.set(p.id, p);
      }
    });
  }
  return [...found.values()];
}

async function findProductByBarcode(code) {
  for (const variant of barcodeVariants(code)) {
    // Avval eng aniq shakl: JSON element sifatida to'liq moslik
    const exact = await ProductModel.findAll({
      where: { barcodes: { [Op.like]: `%"${variant}"%` } },
      limit: 50,
    });
    const hit = exact.find(p => Array.isArray(p.barcodes) && p.barcodes.includes(variant));
    if (hit) return hit;

    // Kod bo'sh joy bilan yozilgan bo'lishi mumkin — kengroq qidirib,
    // massiv ichini qat'iy tekshiramiz
    const loose = await ProductModel.findAll({
      where: { barcodes: { [Op.like]: `%${variant}%` } },
      limit: 50,
    });
    const hit2 = loose.find(p =>
      Array.isArray(p.barcodes) &&
      p.barcodes.some(b => String(b).trim() === variant)
    );
    if (hit2) return hit2;
  }
  return null;
}

// Ko'p mahsulotning tannarxini bitta so'rov bilan oladi.
//
// currentCost() ni ro'yxat ustida aylantirsak, 2000 tovarli omborda 2000 ta
// so'rov ketadi va inventarizatsiya ochilishi daqiqalab cho'ziladi. Bu yerda
// har mahsulot uchun eng kichik id'li ochiq partiya bitta guruhlangan
// so'rovda topiladi.
async function costMap(productIds, transaction) {
  const map = new Map();
  if (!productIds.length) return map;

  // IN(...) ro'yxati juda uzayib ketmasligi uchun bo'lib so'raymiz
  const CHUNK = 1000;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const ids = productIds.slice(i, i + CHUNK);

    // Eng eski ochiq partiyaning id'si (mahsulot kesimida)
    const firsts = await PurchaseItemModel.findAll({
      attributes: [
        'product_id',
        [sequelize.fn('MIN', sequelize.col('id')), 'first_id'],
      ],
      where: { product_id: { [Op.in]: ids }, stock_qty: { [Op.gt]: 0 } },
      group: ['product_id'],
      raw: true,
      transaction,
    });
    if (!firsts.length) continue;

    const rows = await PurchaseItemModel.findAll({
      attributes: ['id', 'product_id', 'cost_price'],
      where: { id: { [Op.in]: firsts.map(f => f.first_id) } },
      raw: true,
      transaction,
    });
    rows.forEach(r => map.set(r.product_id, Number(r.cost_price) || 0));
  }
  return map;
}

class InventoryController extends BaseController {

  getAll = async (req, res) => {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const rows = await InventoryModel.findAll({
      where,
      include: [{ model: InventoryItemModel, as: 'items', attributes: ['id'] }],
      order: [['id', 'DESC']],
      limit: 100,
    });
    res.json(rows);
  };

  getById = async (req, res) => {
    const doc = await InventoryModel.findOne({
      where: { id: req.params.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    res.json(doc);
  };

  /**
   * GET /api/v1/inventories/:id/tahlil
   *
   * OMBOR TAHLILI — "nega bunchalik tovar topilmadi?" degan savolga javob.
   *
   * Sanoqda "topilmadi" bo'lgan tovarlarni SABABLARGA ajratadi:
   *   • shtrix-kodi yo'q      — skanerlab bo'lmaydi, hech qachon topilmaydi
   *   • dublikat kodli        — skaner faqat birinchisini topadi
   *   • sanoq davomida sotilgan — javonda yo'q edi, normal holat
   *   • qolgani               — shunchaki skanerlanmagan
   *
   * Bazaga hech narsa yozmaydi.
   */
  tahlil = async (req, res) => {
    const doc = await InventoryModel.findByPk(req.params.id);
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');

    const q = (sql, repl = []) =>
      sequelize.query(sql, { replacements: repl, type: sequelize.QueryTypes.SELECT });

    // ── 1. Ombor holati ──────────────────────────────────────────
    //
    // Sanoq varaqasi FAQAT `active=1 AND is_folder=0 AND qty>0` ga
    // ochiladi — shuning uchun Mahsulotlar bo'limidagi umumiy son
    // bilan farq qilishi normal. Buni foydalanuvchiga ko'rsatamiz.
    const [ombor] = await q(`
      SELECT
        COUNT(*) jami,
        SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END) papka,
        SUM(CASE WHEN is_folder = 0 AND active = 0 THEN 1 ELSE 0 END) nofaol,
        SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty > 0 THEN 1 ELSE 0 END) qoldigi_bor,
        SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty = 0 THEN 1 ELSE 0 END) qoldigi_nol,
        SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty < 0 THEN 1 ELSE 0 END) manfiy,
        SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty > 0 THEN qty ELSE 0 END) jami_dona
      FROM \`product\``);

    // ── 2. Sanoq satrlari ────────────────────────────────────────
    const [sanoq] = await q(`
      SELECT COUNT(*) satr,
        SUM(CASE WHEN counted_qty > 0 THEN 1 ELSE 0 END) topildi,
        SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN 1 ELSE 0 END) topilmadi,
        SUM(CASE WHEN expected_qty = 0 AND counted_qty > 0 THEN 1 ELSE 0 END) ortiqcha,
        SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN expected_qty ELSE 0 END) topilmadi_dona
      FROM \`inventory_item\` WHERE inventory_id = ?`, [doc.id]);

    // ── 3. Sabablar ──────────────────────────────────────────────
    const YOQ = "(p.barcodes IS NULL OR p.barcodes = '' OR p.barcodes = '[]')";
    const TOPILMADI = "i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0";

    const [kodsiz] = await q(`
      SELECT COUNT(*) n, COALESCE(SUM(i.expected_qty), 0) dona
      FROM \`inventory_item\` i JOIN \`product\` p ON p.id = i.product_id
      WHERE ${TOPILMADI} AND ${YOQ}`, [doc.id]);

    // Dublikat kodli tovarlar — skaner faqat birinchisini topadi,
    // qolganlari hech qachon skanerlanmaydi
    const [dublikat] = await q(`
      SELECT COUNT(*) n, COALESCE(SUM(i.expected_qty), 0) dona
      FROM \`inventory_item\` i JOIN \`product\` p ON p.id = i.product_id
      WHERE ${TOPILMADI} AND p.barcodes IN (
        SELECT barcodes FROM (
          SELECT barcodes FROM \`product\`
          WHERE is_folder = 0 AND active = 1
            AND barcodes IS NOT NULL AND barcodes <> '' AND barcodes <> '[]'
          GROUP BY barcodes HAVING COUNT(*) > 1
        ) x
      )`, [doc.id]);

    // Sanoq ochilgandan keyin sotilganlar — javonda yo'q edi
    let sotilgan = { n: 0, dona: 0 };
    const boshlanish = doc.created_at || doc.createdAt;
    if (boshlanish) {
      const [r] = await q(`
        SELECT COUNT(DISTINCT i.product_id) n, COALESCE(SUM(si.qty), 0) dona
        FROM \`inventory_item\` i
        JOIN \`sale_item\` si ON si.product_id = i.product_id
        JOIN \`sale\` s ON s.id = si.sale_id
          AND (s.status IS NULL OR s.status <> 'cancelled') AND s.date >= ?
        WHERE ${TOPILMADI}`, [boshlanish, doc.id]);
      sotilgan = r;
    }

    // ── 4. Ro'yxatlar — foydalanuvchi ko'rib chiqishi uchun ───────
    const kodsizRoyxat = await q(`
      SELECT i.product_name nomi, i.expected_qty qoldiq, p.id product_id
      FROM \`inventory_item\` i JOIN \`product\` p ON p.id = i.product_id
      WHERE ${TOPILMADI} AND ${YOQ}
      ORDER BY i.expected_qty DESC, i.product_name ASC LIMIT 300`, [doc.id]);

    const dublikatRoyxat = await q(`
      SELECT p.barcodes kod, COUNT(*) soni, SUM(p.qty) dona,
             GROUP_CONCAT(p.name ORDER BY p.id SEPARATOR ' • ') nomlar
      FROM \`product\` p
      WHERE p.is_folder = 0 AND p.active = 1
        AND p.barcodes IS NOT NULL AND p.barcodes <> '' AND p.barcodes <> '[]'
      GROUP BY p.barcodes HAVING soni > 1
      ORDER BY soni DESC, dona DESC LIMIT 100`);

    // Skanerlanmaganlar — texnik sabab yo'q, shunchaki sanalmagan
    const skanerlanmagan = Math.max(0,
      Number(sanoq.topilmadi) - Number(kodsiz.n) - Number(dublikat.n));

    res.json({
      hujjat: {
        id: doc.id,
        doc_number: doc.doc_number,
        status: doc.status,
        ochilgan: boshlanish,
        yakunlangan: doc.finished_at,
      },
      ombor: {
        jami:        Number(ombor.jami)        || 0,
        papka:       Number(ombor.papka)       || 0,
        nofaol:      Number(ombor.nofaol)      || 0,
        qoldigi_bor: Number(ombor.qoldigi_bor) || 0,
        qoldigi_nol: Number(ombor.qoldigi_nol) || 0,
        manfiy:      Number(ombor.manfiy)      || 0,
        jami_dona:   Number(ombor.jami_dona)   || 0,
      },
      sanoq: {
        satr:           Number(sanoq.satr)           || 0,
        topildi:        Number(sanoq.topildi)        || 0,
        topilmadi:      Number(sanoq.topilmadi)      || 0,
        ortiqcha:       Number(sanoq.ortiqcha)       || 0,
        topilmadi_dona: Number(sanoq.topilmadi_dona) || 0,
      },
      sabablar: {
        kodsiz:         { n: Number(kodsiz.n)   || 0, dona: Number(kodsiz.dona)   || 0 },
        dublikat:       { n: Number(dublikat.n) || 0, dona: Number(dublikat.dona) || 0 },
        sotilgan:       { n: Number(sotilgan.n) || 0, dona: Number(sotilgan.dona) || 0 },
        skanerlanmagan: { n: skanerlanmagan },
      },
      kodsiz_royxat:   kodsizRoyxat,
      dublikat_royxat: dublikatRoyxat,
    })
  }

  // Yangi sanoq varaqasi: ombordagi barcha faol mahsulot uchun satr ochiladi.
  // Shunda "topilmadi" ro'yxati boshidanoq to'liq bo'ladi va skanerlash
  // uni bo'shatib boradi — rasmda ko'rsatilgan jarayon shunday.
  create = async (req, res) => {
    const { warehouse = 'Asosiy ombor', comment = null, only_in_stock = true } = req.body;

    const where = { active: true, is_folder: false };
    if (only_in_stock) where.qty = { [Op.gt]: 0 };

    // Faqat kerakli ustunlar — 2000+ tovarda butun satrni tortish ortiqcha
    const products = await ProductModel.findAll({
      where,
      attributes: ['id', 'name', 'barcodes', 'qty'],
      order: [['name', 'ASC']],
    });
    if (!products.length) throw new HttpException(400, 'Omborda mahsulot topilmadi');

    // Barcha tannarxlar bitta so'rovda — har mahsulot uchun alohida emas
    const costs = await costMap(products.map(p => p.id), null);

    // Skanerlashda tovar `product_id` bo'yicha topiladi, shuning uchun
    // hujjatdagi `barcode` faqat ko'rsatish uchun. Bir nechta kod bo'lsa
    // birinchisini yozamiz — qolganlari bilan skanerlansa ham topiladi.

    let doc;
    await sequelize.transaction(async (t) => {
      const maxDoc = await InventoryModel.max('doc_number', { transaction: t });
      doc = await InventoryModel.create({
        doc_number: (Number(maxDoc) || 0) + 1,
        date: new Date(),
        warehouse,
        comment,
        status: 'draft',
        created_by: req.currentUser?.id ?? null,
      }, { transaction: t });

      const rows = products.map(p => ({
        inventory_id: doc.id,
        product_id:   p.id,
        product_name: p.name,
        barcode:      (p.barcodes || [])[0] || null,
        expected_qty: Number(p.qty) || 0,
        counted_qty:  0,
        cost_price:   costs.get(p.id) || 0,
      }));

      // Bir necha ming satrni bitta INSERT ga tiqmaymiz — MySQL
      // max_allowed_packet chegarasiga urilmaslik uchun bo'lib yozamiz
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await InventoryItemModel.bulkCreate(rows.slice(i, i + CHUNK), { transaction: t });
      }
    });

    const full = await InventoryModel.findOne({
      where: { id: doc.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    res.status(201).json(full);
  };

  // Shtrix-kod skanerlandi. Frontend har skanda shuni chaqiradi va
  // javobdagi `holat` ga qarab tegishli ovozni chaladi.
  scan = async (req, res) => {
    const { barcode, qty = 1 } = req.body;
    if (!barcode) throw new HttpException(400, 'Shtrix-kod yuborilmadi');

    const doc = await InventoryModel.findOne({ where: { id: req.params.id } });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status !== 'draft') throw new HttpException(400, 'Hujjat yakunlangan');

    const code = String(barcode).trim();
    const step = Number(qty) || 1;

    // ── Tovarni topish tartibi ───────────────────────────────────────
    //
    // Muhim: avval BAZADAN mahsulotni aniqlaymiz, keyin hujjatdan uning
    // satrini qidiramiz. Ilgari teskarisi edi — faqat `barcode` ustuni
    // bo'yicha qidirilardi va hujjatga tovarning faqat BIRINCHI
    // shtrix-kodi yozilgani uchun (barcodes[0]) ikkinchi/uchinchi kod
    // skanerlanganda satr topilmasdi. Natijada mavjud tovar "ortiqcha"
    // bo'lib qolardi.

    // 1) Shtrix-kod bo'yicha bazadagi mahsulotni aniqlaymiz.
    //
    // Bir kod bir necha tovarga berilgan bo'lishi mumkin (masalan razmerlar
    // chalkashib, 4XL/5XL/6XL ga bir xil yorliq bosilgan). Bunda skanerlash
    // doim BIRINCHISIGA tushadi: u "ortiqcha" bo'ladi, qolganlari esa
    // "topilmadi" bo'lib qoladi. Buni jimgina o'tkazib yubormaymiz —
    // kassirga aytamiz.
    const matches = await findAllProductsByBarcode(code);
    const product = matches[0] || null;
    const chalkash = matches.length > 1
      ? matches.map(p => ({ id: p.id, name: p.name }))
      : null;

    let item = null;

    if (product) {
      // 2) Shu mahsulotning hujjatdagi satri — qaysi kod bilan
      //    kiritilganidan qat'i nazar
      item = await InventoryItemModel.findOne({
        where: { inventory_id: doc.id, product_id: product.id },
      });

      if (!item) {
        // Hujjat ochilgandan keyin qo'shilgan yoki qoldig'i 0 bo'lgan tovar
        item = await InventoryItemModel.create({
          inventory_id: doc.id,
          product_id:   product.id,
          product_name: product.name,
          barcode:      code,
          expected_qty: Number(product.qty) || 0,
          counted_qty:  0,
          cost_price:   await currentCost(product.id),
          is_extra:     Number(product.qty) <= 0,
        });
      }
    } else {
      // 3) Bazada topilmadi — hujjatdagi "noma'lum tovar" satrini
      //    shtrix-kod bo'yicha qidiramiz (qayta urilgan bo'lishi mumkin)
      item = await InventoryItemModel.findOne({
        where: { inventory_id: doc.id, barcode: code },
      });

      if (!item) {
        // Bazada umuman yo'q — ortiqcha tovar sifatida qayd etamiz
        item = await InventoryItemModel.create({
          inventory_id: doc.id,
          product_id:   null,
          product_name: `Noma'lum tovar (${code})`,
          barcode:      code,
          expected_qty: 0,
          counted_qty:  0,
          cost_price:   0,
          is_extra:     true,
        });
      }
    }

    const oldCounted = Number(item.counted_qty) || 0;
    const expected   = Number(item.expected_qty) || 0;

    // ── Sanoqni oshirish qoidasi ─────────────────────────────────────
    //
    // Tovar hisobdagi miqdorgacha to'lgan bo'lsa, yana urilganda sanoq
    // OSHMAYDI — faqat ogohlantiramiz. Aks holda sanoqchi bir tovarni
    // ikkinchi marta urib yuborsa (ro'yxatni tekshirayotganda oson
    // bo'ladi), u "ortiqcha" ga tushib qolardi va topildi/ortiqcha
    // raqamlari buzilardi.
    //
    // Haqiqiy ortiqchani ham yozib olish kerak, shuning uchun bazada
    // yo'q tovar (product_id yo'q) yoki hisobda umuman qoldig'i
    // bo'lmagan tovar (expected = 0) uchun sanoq oshaveradi.
    const tolgan  = item.product_id && expected > 0 && oldCounted >= expected;
    const newCounted = tolgan ? oldCounted : oldCounted + step;

    // `is_extra` — faqat bazada yo'q yoki hisobda qoldig'i bo'lmagan tovar
    // uchun. Ilgari bu bayroq bir marta qo'yilgach hech qachon olinmasdi:
    // qoldig'i bor tovar ham "ortiqcha" ro'yxatida qolib ketardi.
    const shouldBeExtra = !item.product_id || expected <= 0;

    const patch = { counted_qty: newCounted, scanned_at: new Date() };
    if (Boolean(item.is_extra) !== shouldBeExtra) patch.is_extra = shouldBeExtra;
    await item.update(patch);

    // Frontend shu qiymatga qarab ovoz tanlaydi.
    //
    //   takror   — allaqachon to'liq sanalgan, sanoq oshmadi
    //   ortiqcha — hisobda yo'q tovar sanaldi (haqiqiy ortiqcha)
    //   topildi  — normal sanoq (2 donadan ikkinchisi ham shu yerda)
    let holat = 'topildi';
    if (!item.product_id)            holat = 'notanish';   // bazada yo'q
    else if (tolgan)                 holat = 'takror';     // to'lgan, oshmadi
    else if (newCounted > expected)  holat = 'ortiqcha';   // hisobdagidan ko'p


    res.json({
      ok: true,
      holat,
      takroriy: oldCounted > 0,
      // Bir kod bir necha tovarga berilgan bo'lsa — kassir buni bilishi
      // kerak, aks holda "ortiqcha"/"topilmadi" sababi tushunarsiz qoladi
      chalkash,
      item: {
        id: item.id,
        product_id:   item.product_id,
        product_name: item.product_name,
        barcode:      item.barcode,
        expected_qty: expected,
        counted_qty:  newCounted,
        is_extra:     item.is_extra,
      },
    });
  };

  // Hujjatdagi "ortiqcha" satrlarni qayta tekshirish va birlashtirish.
  //
  // Eski xato tufayli bir tovar hujjatda ikki marta paydo bo'lgan bo'lishi
  // mumkin: biri hujjat ochilganda (expected_qty bilan), ikkinchisi
  // skanerlaganda "ortiqcha" sifatida (expected_qty = 0). Bu metod
  // shundaylarni topib, sanoqni asosiy satrga qo'shadi va dublikatni
  // o'chiradi. Skanerlangan miqdor yo'qolmaydi.
  //
  // POST /inventories/:id/repair
  repair = async (req, res) => {
    const doc = await InventoryModel.findOne({ where: { id: req.params.id } });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status !== 'draft') throw new HttpException(400, 'Faqat ochiq hujjatni tuzatish mumkin');

    const items = await InventoryItemModel.findAll({
      where: { inventory_id: doc.id }, order: [['id', 'ASC']],
    });

    let birlashtirildi = 0;   // dublikat satrlar asosiysiga qo'shildi
    let boglandi       = 0;   // "noma'lum" satr bazadagi tovarga ulandi
    let bayroq         = 0;   // is_extra to'g'rilandi
    let oshgan         = 0;   // qayta urilib oshib ketgan sanoq to'g'rilandi

    await sequelize.transaction(async (t) => {
      // 1) product_id bo'yicha guruhlash — bir tovarga bir nechta satr
      const byProduct = new Map();
      for (const it of items) {
        if (!it.product_id) continue;
        if (!byProduct.has(it.product_id)) byProduct.set(it.product_id, []);
        byProduct.get(it.product_id).push(it);
      }

      for (const [, list] of byProduct) {
        if (list.length < 2) continue;
        // Asosiy satr — expected_qty si bor bo'lgani (hujjat ochilgandagi)
        const main = list.find(i => Number(i.expected_qty) > 0) || list[0];
        const dups = list.filter(i => i.id !== main.id);

        let add = 0;
        for (const d of dups) {
          add += Number(d.counted_qty) || 0;
          await d.destroy({ transaction: t });
          birlashtirildi++;
        }
        if (add) {
          await main.update(
            { counted_qty: (Number(main.counted_qty) || 0) + add },
            { transaction: t }
          );
        }
      }

      // 2) "Noma'lum tovar" satrlarini shtrix-kod bo'yicha bazaga ulaymiz
      const unknown = await InventoryItemModel.findAll({
        where: { inventory_id: doc.id, product_id: null }, transaction: t,
      });
      for (const u of unknown) {
        if (!u.barcode) continue;
        const p = await findProductByBarcode(String(u.barcode).trim());
        if (!p) continue;

        // Shu tovarning asosiy satri bormi
        const main = await InventoryItemModel.findOne({
          where: { inventory_id: doc.id, product_id: p.id }, transaction: t,
        });
        if (main) {
          await main.update(
            { counted_qty: (Number(main.counted_qty) || 0) + (Number(u.counted_qty) || 0) },
            { transaction: t }
          );
          await u.destroy({ transaction: t });
          birlashtirildi++;
        } else {
          await u.update({
            product_id:   p.id,
            product_name: p.name,
            expected_qty: Number(p.qty) || 0,
            is_extra:     Number(p.qty) <= 0,
          }, { transaction: t });
          boglandi++;
        }
      }

      // 3) is_extra bayrog'ini haqiqiy holatga moslaymiz
      const fresh = await InventoryItemModel.findAll({
        where: { inventory_id: doc.id }, transaction: t,
      });
      for (const it of fresh) {
        const should = !it.product_id || Number(it.expected_qty) <= 0;
        if (Boolean(it.is_extra) !== should) {
          await it.update({ is_extra: should }, { transaction: t });
          bayroq++;
        }
      }

      // 4) Bazadagi tovar hisobdagidan ko'p sanalgan bo'lsa — qayta
      //    urilgani uchun oshib ketgan. Uni hisobdagi miqdorga
      //    qaytaramiz: tovar omborda bor, ortiqcha emas.
      //
      //    Haqiqiy ortiqchaga (expected = 0 yoki bazada yo'q tovar)
      //    tegilmaydi — u rostdan hisobda yo'q.
      for (const it of fresh) {
        if (!it.product_id) continue;
        const exp = Number(it.expected_qty) || 0;
        if (exp > 0 && Number(it.counted_qty) > exp) {
          await it.update({ counted_qty: exp }, { transaction: t });
          oshgan++;
        }
      }
    });

    const full = await InventoryModel.findOne({
      where: { id: doc.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });

    res.json({
      ok: true,
      birlashtirildi,
      boglandi,
      bayroq_tuzatildi: bayroq,
      oshgan_tuzatildi: oshgan,
      xabar: `${birlashtirildi} ta dublikat birlashtirildi, ` +
             `${boglandi} ta tovar bazaga ulandi, ` +
             `${oshgan} ta oshib ketgan sanoq to'g'rilandi`,
      doc: full,
    });
  };

  // Satrni qo'lda tuzatish (skanerda xato bo'lsa)
  updateItem = async (req, res) => {
    const item = await InventoryItemModel.findOne({ where: { id: req.params.itemId } });
    if (!item) throw new HttpException(404, 'Satr topilmadi');

    const doc = await InventoryModel.findOne({ where: { id: item.inventory_id } });
    if (doc?.status !== 'draft') throw new HttpException(400, 'Hujjat yakunlangan');

    const { counted_qty } = req.body;
    if (counted_qty !== undefined) {
      await item.update({ counted_qty: Math.max(0, Number(counted_qty) || 0) });
    }
    res.json(item);
  };

  deleteItem = async (req, res) => {
    const item = await InventoryItemModel.findOne({ where: { id: req.params.itemId } });
    if (!item) throw new HttpException(404, 'Satr topilmadi');
    const doc = await InventoryModel.findOne({ where: { id: item.inventory_id } });
    if (doc?.status !== 'draft') throw new HttpException(400, 'Hujjat yakunlangan');
    await item.destroy();
    res.json({ ok: true });
  };

  // Yakunlash: sanalgan miqdor mahsulot qoldig'iga yoziladi.
  // Farq bo'lgan satrlar uchun FIFO partiyalari ham to'g'rilanadi,
  // aks holda keyingi sotuvlarda tannarx noto'g'ri hisoblanadi.
  finish = async (req, res) => {
    const doc = await InventoryModel.findOne({
      where: { id: req.params.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status !== 'draft') throw new HttpException(400, 'Hujjat allaqachon yakunlangan');

    // ── HIMOYA: tugallanmagan sanoq butun omborni nolga tushirmasin ──
    //
    // Brauzerdagi ogohlantirishga tayanib bo'lmaydi: so'rov to'g'ridan-to'g'ri
    // ham yuborilishi mumkin. Shuning uchun tekshiruv shu yerda — serverda.
    //
    // Skanerlanmagan (counted_qty = 0, lekin hisobda qoldig'i bor) tovarlar
    // yakunlashda 0 ga tushadi. Ular ko'p bo'lsa — bu sanoq emas, xato.
    const willZero = doc.items.filter(i =>
      i.product_id &&
      Number(i.counted_qty) === 0 &&
      Number(i.expected_qty) > 0
    ).length;

    const scanned = doc.items.filter(i => Number(i.counted_qty) > 0).length;

    // `force` faqat foydalanuvchi ogohlantirishni ko'rib, ataylab
    // tasdiqlaganda yuboriladi
    if (willZero > 0 && req.body?.force !== true) {
      // Xabar matn bo'lishi kerak (error middleware uni tarjima qiladi),
      // qo'shimcha ma'lumot `data` orqali beriladi
      throw new HttpException(
        409,
        `Sanoq tugallanmagan: ${willZero} ta tovarning qoldig'i 0 ga tushadi. ` +
        `Skanerlangan: ${scanned} ta.`,
        { code: 'SANOQ_TUGALLANMAGAN', nolga_tushadi: willZero, skanerlangan: scanned }
      );
    }

    // Yakunlashdan OLDIN qoldiqlarni nusxalab qo'yamiz — noto'g'ri
    // chiqsa bitta buyruq bilan qaytariladi
    let snapshotId = null;
    try {
      snapshotId = await stockGuard.takeSnapshot({
        label:  `Inventarizatsiya #${doc.doc_number} yakunlanishidan oldin`,
        reason: `nolga tushadi: ${willZero}, skanerlangan: ${scanned}`,
        user:   req.currentUser,
      });
    } catch (e) {
      // Snapshot olinmasa ham yakunlash to'xtamasin, lekin logga tushsin
      console.log('Snapshot olinmadi:', e.message);
    }

    let totalExpected = 0, totalCounted = 0, totalDiffSum = 0;
    // Sanoq davomida sotilgan tovarlar — javobda kassirga ko'rsatiladi
    let sanoqDavomidaSotildi = 0;

    await sequelize.transaction(async (t) => {
      // Mahsulotlar va partiyalarni oldindan bitta so'rovda olamiz.
      // Ilgari har satr uchun 2 ta so'rov ketardi — 2000 satrli hujjatda
      // 4000 so'rov bo'lib, yakunlash tranzaksiyasi juda uzoq ochiq turardi.
      const itemProductIds = [...new Set(
        doc.items.map(i => i.product_id).filter(Boolean)
      )];

      const productList = itemProductIds.length
        ? await ProductModel.findAll({
            where: { id: { [Op.in]: itemProductIds } }, transaction: t,
          })
        : [];
      const productById = new Map(productList.map(p => [p.id, p]));

      // ── SANOQ DAVOMIDA SOTILGAN TOVARLAR ─────────────────────────
      //
      // Sanoq bir necha soat, ba'zan bir necha kun davom etadi va shu
      // vaqtda do'kon ishlashda davom etadi. Kassir tovarni sanab
      // qo'yadi, keyin o'sha tovar sotiladi.
      //
      // Agar buni hisobga olmasak, yakunlashda qoldiq SANALGAN
      // miqdorga tenglashtiriladi va sotilgan tovar qoldiqqa qayta
      // qo'shilib qoladi — yo'q tovar bor bo'lib ko'rinadi.
      //
      // Shuning uchun: yangi qoldiq = sanalgan − (sanoq boshlangandan
      // keyin sotilgan). `rollback` metodi ham xuddi shu mantiqda
      // ishlaydi.
      const boshlanish = doc.created_at || doc.createdAt;
      let sotilgan = new Map();
      if (boshlanish && itemProductIds.length) {
        const SaleItemModel = require('../models/sale_item.model');
        const SaleModel     = require('../models/sale.model');
        const rows = await SaleItemModel.findAll({
          attributes: [
            'product_id',
            [sequelize.fn('SUM', sequelize.col('SaleItemModel.qty')), 'q'],
          ],
          where: { product_id: { [Op.in]: itemProductIds } },
          include: [{
            model: SaleModel,
            as: 'sale',
            attributes: [],
            required: true,
            where: {
              date: { [Op.gte]: boshlanish },
              status: { [Op.or]: [{ [Op.is]: null }, { [Op.ne]: 'cancelled' }] },
            },
          }],
          group: ['product_id'],
          raw: true,
          transaction: t,
        }).catch(() => []);
        sotilgan = new Map(rows.map(r => [r.product_id, Number(r.q) || 0]));
        for (const v of sotilgan.values()) sanoqDavomidaSotildi += v;
      }

      const allBatches = itemProductIds.length
        ? await PurchaseItemModel.findAll({
            where: { product_id: { [Op.in]: itemProductIds } },
            order: [['id', 'ASC']], transaction: t,
          })
        : [];
      const batchesByProduct = new Map();
      for (const b of allBatches) {
        if (!batchesByProduct.has(b.product_id)) batchesByProduct.set(b.product_id, []);
        batchesByProduct.get(b.product_id).push(b);
      }

      // Mahsulot qoldiqlarini oxirida bitta so'rovda yozamiz
      const qtyUpdates = [];

      for (const item of doc.items) {
        const expected = Number(item.expected_qty) || 0;
        const counted  = Number(item.counted_qty)  || 0;
        const diff     = counted - expected;

        totalExpected += expected;
        totalCounted  += counted;
        totalDiffSum  += diff * (Number(item.cost_price) || 0);

        // diff === 0 bo'lsa ham partiyalarni tekshiramiz: mahsulot qoldig'i
        // to'g'ri, lekin partiyalar yig'indisi undan farq qilishi mumkin
        if (!item.product_id) continue;

        const product = productById.get(item.product_id);
        if (!product) continue;

        // Sanoqdan keyin sotilgani ayiriladi — aks holda sotilgan tovar
        // omborga qaytib qo'shilardi
        const keyinSotilgan = sotilgan.get(product.id) || 0;
        const yangiQoldiq   = Math.max(0, counted - keyinSotilgan);

        qtyUpdates.push({ id: product.id, qty: yangiQoldiq });

        // FIFO partiyalarini sanalgan miqdorga tenglashtiramiz.
        //
        // Partiyalardagi umumiy qoldiq mahsulot qoldig'idan farq qilishi
        // mumkin (eski nomuvofiqliklar sababli), shuning uchun diff dan
        // emas, partiyalar yig'indisidan kelib chiqamiz — aks holda
        // inventarizatsiyadan keyin ham nomuvofiqlik saqlanib qoladi.
        const batches = batchesByProduct.get(product.id) || [];

        const batchTotal = batches.reduce((a, b) => a + (Number(b.stock_qty) || 0), 0);

        // Partiyalar ham YANGI qoldiqqa tenglashadi (sotilgani ayirilgan),
        // aks holda partiyalar yig'indisi mahsulot qoldig'idan farq qilib
        // qolardi va keyingi FIFO hisoblari buzilardi.
        if (batchTotal > yangiQoldiq) {
          // Ortiqcha qoldiqni eng eski partiyalardan yechamiz
          let toRemove = batchTotal - yangiQoldiq;
          for (const b of batches) {
            if (toRemove <= 0) break;
            const have = Number(b.stock_qty) || 0;
            if (have <= 0) continue;
            const take = Math.min(have, toRemove);
            await b.update({ stock_qty: have - take }, { transaction: t });
            toRemove -= take;
          }
        } else if (batchTotal < yangiQoldiq) {
          const add = yangiQoldiq - batchTotal;
          if (batches.length) {
            // Yetishmaganini oxirgi (eng yangi) partiyaga qo'shamiz —
            // tannarx eng so'nggi kelgan narxga yaqin bo'ladi
            const last = batches[batches.length - 1];
            await last.update(
              { stock_qty: (Number(last.stock_qty) || 0) + add },
              { transaction: t }
            );
          } else {
            // Partiya umuman yo'q (masalan skanerda topilgan yangi tovar) —
            // FIFO ishlashi uchun bittasini ochamiz
            const maxDoc = await PurchaseModel.max('doc_number', { transaction: t });
            const purchase = await PurchaseModel.create({
              doc_number: (Number(maxDoc) || 0) + 1,
              date: new Date(),
              comment: `Inventarizatsiya #${doc.doc_number} — ortiqcha`,
              status: 'confirmed',
              total_sum: add * (Number(item.cost_price) || 0),
              created_by: req.currentUser?.id ?? null,
            }, { transaction: t });

            await PurchaseItemModel.create({
              purchase_id:  purchase.id,
              product_id:   product.id,
              product_name: product.name,
              barcode:      item.barcode,
              pkg_qty:      add,
              unit_qty:     add,
              units_per_pkg: 1,
              stock_qty:    add,
              sold_qty:     0,
              pkg_price:    Number(item.cost_price) || 0,
              unit_price:   Number(item.cost_price) || 0,
              cost_price:   Number(item.cost_price) || 0,
              total_sum:    add * (Number(item.cost_price) || 0),
              total_cost_sum: add * (Number(item.cost_price) || 0),
              retail_price_sum: Number(product.retail_price) || 0,
            }, { transaction: t });
          }
        }
      }

      // Sanalgan qoldiqlarni yozamiz — har mahsulot uchun alohida UPDATE
      // o'rniga CASE bilan bo'lakma-bo'lak
      const CHUNK = 500;
      for (let i = 0; i < qtyUpdates.length; i += CHUNK) {
        const part  = qtyUpdates.slice(i, i + CHUNK);
        const cases = part.map(u => `WHEN ${Number(u.id)} THEN ${Number(u.qty)}`).join(' ');
        const ids   = part.map(u => Number(u.id)).join(',');
        await sequelize.query(
          `UPDATE \`product\` SET \`qty\` = CASE \`id\` ${cases} END WHERE \`id\` IN (${ids})`,
          { transaction: t }
        );
      }

      await doc.update({
        status: 'finished',
        finished_at: new Date(),
        total_expected: totalExpected,
        total_counted:  totalCounted,
        total_diff_sum: totalDiffSum,
      }, { transaction: t });
    });

    // Eski snapshot'lar cheksiz to'planmasin
    stockGuard.pruneSnapshots(30).catch(() => {});

    const full = await InventoryModel.findOne({
      where: { id: doc.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    // snapshot_id — kerak bo'lsa shu nuqtaga qaytish uchun
    res.json({ ...full.toJSON(), snapshot_id: snapshotId,
               sanoq_davomida_sotildi: sanoqDavomidaSotildi,
               nolga_tushdi: willZero });
  };

  // Yakunlashni QAYTARISH (rollback).
  //
  // Sanoq tugallanmagan holda "Yakunlash" bosilsa, skanerlanmagan
  // tovarlarning qoldig'i 0 ga tushib qoladi. Bu metod ularni hujjat
  // ochilgandagi holatga qaytaradi.
  //
  // Qaytarish mumkin, chunki hujjat ochilganda har tovarning o'sha
  // paytdagi qoldig'i `inventory_item.expected_qty` ga yozilgan va
  // yakunlash uni O'ZGARTIRMAYDI — faqat o'qiydi.
  //
  // DIQQAT: hujjat o'chirilsa `inventory_item` ham o'chadi va qaytarish
  // imkoni yo'qoladi. Shuning uchun o'chirish emas, shu metod ishlatiladi.
  rollback = async (req, res) => {
    const doc = await InventoryModel.findOne({
      where: { id: req.params.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status !== 'finished') {
      throw new HttpException(400, 'Faqat yakunlangan hujjatni qaytarish mumkin');
    }

    const real = doc.items.filter(i => i.product_id);
    if (!real.length) throw new HttpException(400, 'Qaytariladigan satr topilmadi');

    const ids = [...new Set(real.map(i => i.product_id))];

    // Yakunlashdan KEYIN sotilgan tovarlar. Ularni hisobga olmasak,
    // sotilgan tovar qoldiqqa qayta qo'shilib, yo'q narsa bor bo'lib
    // ko'rinadi.
    let soldAfter = new Map();
    if (doc.finished_at) {
      const SaleItemModel = require('../models/sale_item.model');
      const SaleModel     = require('../models/sale.model');
      const sold = await SaleItemModel.findAll({
        attributes: [
          'product_id',
          [sequelize.fn('SUM', sequelize.col('SaleItemModel.qty')), 'q'],
        ],
        where: { product_id: { [Op.in]: ids } },
        include: [{
          model: SaleModel,
          as: 'sale',
          attributes: [],
          required: true,
          where: {
            date: { [Op.gte]: doc.finished_at },
            status: { [Op.or]: [{ [Op.is]: null }, { [Op.ne]: 'cancelled' }] },
          },
        }],
        group: ['product_id'],
        raw: true,
      }).catch(() => []);
      soldAfter = new Map(sold.map(r => [r.product_id, Number(r.q) || 0]));
    }

    const products = await ProductModel.findAll({ where: { id: { [Op.in]: ids } } });
    const byId = new Map(products.map(p => [p.id, p]));

    // Qaytariladigan qiymat = hujjat ochilgandagi qoldiq − keyin sotilgani
    const restore = [];
    for (const it of real) {
      const p = byId.get(it.product_id);
      if (!p) continue;
      const back = (Number(it.expected_qty) || 0) - (soldAfter.get(p.id) || 0);
      if (Number(p.qty) !== back) restore.push({ id: p.id, qty: back });
    }

    let fixedBatches = 0;

    await sequelize.transaction(async (t) => {
      // 1. Mahsulot qoldiqlari
      const CHUNK = 500;
      for (let i = 0; i < restore.length; i += CHUNK) {
        const part  = restore.slice(i, i + CHUNK);
        const cases = part.map(r => `WHEN ${Number(r.id)} THEN ${Number(r.qty)}`).join(' ');
        const idList = part.map(r => Number(r.id)).join(',');
        await sequelize.query(
          `UPDATE \`product\` SET \`qty\` = CASE \`id\` ${cases} END WHERE \`id\` IN (${idList})`,
          { transaction: t }
        );
      }

      // 2. Yakunlash ochgan "ortiqcha" kirim hujjatlarini o'chiramiz
      const extras = await PurchaseModel.findAll({
        where: { comment: { [Op.like]: `Inventarizatsiya #${doc.doc_number} — ortiqcha%` } },
        transaction: t,
      });
      if (extras.length) {
        const pids = extras.map(p => p.id);
        await PurchaseItemModel.destroy({ where: { purchase_id: { [Op.in]: pids } }, transaction: t });
        await PurchaseModel.destroy({ where: { id: { [Op.in]: pids } }, transaction: t });
      }

      // 3. FIFO partiyalarini qoldiqqa moslaymiz — aks holda sotuvda
      //    tannarx topilmaydi
      const allBatches = await PurchaseItemModel.findAll({
        where: { product_id: { [Op.in]: restore.map(r => r.id) } },
        order: [['id', 'ASC']], transaction: t,
      });
      const byProduct = new Map();
      for (const b of allBatches) {
        if (!byProduct.has(b.product_id)) byProduct.set(b.product_id, []);
        byProduct.get(b.product_id).push(b);
      }

      for (const r of restore) {
        const batches = byProduct.get(r.id) || [];
        if (!batches.length) continue;
        const total = batches.reduce((a, b) => a + (Number(b.stock_qty) || 0), 0);
        if (total === r.qty) continue;

        let need = r.qty;
        for (const b of batches) {
          // Partiyaga sig'adigan maksimal qoldiq: kelgan − sotilgan
          const cap  = Math.max(0, (Number(b.unit_qty) || 0) - (Number(b.sold_qty) || 0));
          const give = Math.min(cap, Math.max(0, need));
          if (Number(b.stock_qty) !== give) {
            await b.update({ stock_qty: give }, { transaction: t });
            fixedBatches++;
          }
          need -= give;
        }
        // Sig'im yetmasa — oxirgi partiyaga qo'shamiz
        if (need > 0) {
          const last = batches[batches.length - 1];
          await last.update(
            { stock_qty: (Number(last.stock_qty) || 0) + need }, { transaction: t }
          );
          fixedBatches++;
        }
      }

      // 4. Hujjat qayta ochiladi — sanoqni davom ettirish mumkin
      await doc.update({
        status: 'draft',
        finished_at: null,
        total_counted: 0,
        total_diff_sum: 0,
      }, { transaction: t });
    });

    const soldTotal = [...soldAfter.values()].reduce((a, b) => a + b, 0);

    res.json({
      ok: true,
      qaytarildi:     restore.length,
      partiyalar:     fixedBatches,
      keyin_sotilgan: soldTotal,
      xabar: `${restore.length} ta tovar qoldig'i qaytarildi` +
             (soldTotal ? `, keyin sotilgan ${soldTotal} dona hisobga olindi` : ''),
    });
  };

  cancel = async (req, res) => {
    const doc = await InventoryModel.findOne({ where: { id: req.params.id } });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status === 'finished') {
      throw new HttpException(400, 'Yakunlangan hujjatni bekor qilib bo\'lmaydi');
    }
    await doc.update({ status: 'cancelled' });
    res.json({ ok: true });
  };

  delete = async (req, res) => {
    const doc = await InventoryModel.findOne({ where: { id: req.params.id } });
    if (!doc) throw new HttpException(404, 'Hujjat topilmadi');
    if (doc.status === 'finished') {
      throw new HttpException(400, 'Yakunlangan hujjatni o\'chirib bo\'lmaydi');
    }
    await InventoryItemModel.destroy({ where: { inventory_id: doc.id } });
    await doc.destroy();
    res.json({ ok: true });
  };
}

module.exports = new InventoryController();
