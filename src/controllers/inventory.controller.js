const { Op } = require('sequelize');
const InventoryModel     = require('../models/inventory.model');
const InventoryItemModel = require('../models/inventory_item.model');
const ProductModel       = require('../models/product.model');
const PurchaseItemModel  = require('../models/purchase_item.model');
const PurchaseModel      = require('../models/purchase.model');
const sequelize          = require('../db/db-sequelize');
const HttpException      = require('../utils/HttpException.utils');
const BaseController     = require('./BaseController');

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

  // Yangi sanoq varaqasi: ombordagi barcha faol mahsulot uchun satr ochiladi.
  // Shunda "topilmadi" ro'yxati boshidanoq to'liq bo'ladi va skanerlash
  // uni bo'shatib boradi — rasmda ko'rsatilgan jarayon shunday.
  create = async (req, res) => {
    const { warehouse = 'Asosiy ombor', comment = null, only_in_stock = true } = req.body;

    const where = { active: true, is_folder: false };
    if (only_in_stock) where.qty = { [Op.gt]: 0 };

    const products = await ProductModel.findAll({ where, order: [['name', 'ASC']] });
    if (!products.length) throw new HttpException(400, 'Omborda mahsulot topilmadi');

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

      const rows = [];
      for (const p of products) {
        rows.push({
          inventory_id: doc.id,
          product_id:   p.id,
          product_name: p.name,
          barcode:      (p.barcodes || [])[0] || null,
          expected_qty: Number(p.qty) || 0,
          counted_qty:  0,
          cost_price:   await currentCost(p.id, t),
        });
      }
      await InventoryItemModel.bulkCreate(rows, { transaction: t });
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

    // 1) Hujjatdagi satrlar orasidan qidiramiz
    let item = await InventoryItemModel.findOne({
      where: { inventory_id: doc.id, barcode: code },
    });

    // 2) Topilmasa — bazadagi mahsulotlar orasidan (barcodes JSON ichida)
    if (!item) {
      const product = await ProductModel.findOne({
        where: { barcodes: { [Op.like]: `%${code}%` } },
      });

      if (product) {
        // Hujjatda shu mahsulot satri bormi (boshqa shtrix-kod bilan)
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
    const newCounted = oldCounted + step;
    const expected   = Number(item.expected_qty) || 0;

    await item.update({ counted_qty: newCounted, scanned_at: new Date() });

    // Frontend shu qiymatga qarab ovoz tanlaydi
    let holat = 'topildi';
    if (!item.product_id)            holat = 'notanish';   // bazada yo'q
    else if (newCounted > expected)  holat = 'ortiqcha';   // hisobdan ko'p
    else if (oldCounted > 0)         holat = 'takror';     // qayta urildi

    res.json({
      ok: true,
      holat,
      takroriy: oldCounted > 0,
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

    let totalExpected = 0, totalCounted = 0, totalDiffSum = 0;

    await sequelize.transaction(async (t) => {
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

        const product = await ProductModel.findOne({
          where: { id: item.product_id }, transaction: t,
        });
        if (!product) continue;

        await product.update({ qty: counted }, { transaction: t });

        // FIFO partiyalarini sanalgan miqdorga tenglashtiramiz.
        //
        // Partiyalardagi umumiy qoldiq mahsulot qoldig'idan farq qilishi
        // mumkin (eski nomuvofiqliklar sababli), shuning uchun diff dan
        // emas, partiyalar yig'indisidan kelib chiqamiz — aks holda
        // inventarizatsiyadan keyin ham nomuvofiqlik saqlanib qoladi.
        const batches = await PurchaseItemModel.findAll({
          where: { product_id: product.id },
          order: [['id', 'ASC']], transaction: t,
        });

        const batchTotal = batches.reduce((a, b) => a + (Number(b.stock_qty) || 0), 0);

        if (batchTotal > counted) {
          // Ortiqcha qoldiqni eng eski partiyalardan yechamiz
          let toRemove = batchTotal - counted;
          for (const b of batches) {
            if (toRemove <= 0) break;
            const have = Number(b.stock_qty) || 0;
            if (have <= 0) continue;
            const take = Math.min(have, toRemove);
            await b.update({ stock_qty: have - take }, { transaction: t });
            toRemove -= take;
          }
        } else if (batchTotal < counted) {
          const add = counted - batchTotal;
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

      await doc.update({
        status: 'finished',
        finished_at: new Date(),
        total_expected: totalExpected,
        total_counted:  totalCounted,
        total_diff_sum: totalDiffSum,
      }, { transaction: t });
    });

    const full = await InventoryModel.findOne({
      where: { id: doc.id },
      include: [{ model: InventoryItemModel, as: 'items' }],
    });
    res.json(full);
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
