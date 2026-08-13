const sequelize = require('../db/db-sequelize');
const HttpException = require('../utils/HttpException.utils');
const stockGuard = require('../utils/stockGuard.utils');

/**
 * Qoldiq "suratlari" (snapshot).
 *
 * Har bir xavfli amaldan (masalan inventarizatsiya yakunlash) oldin
 * qoldiqlar avtomatik nusxalanadi. Bu yerdan ularni ko'rish va
 * kerak bo'lsa qaytarish mumkin — terminalga kirmasdan.
 */
class SnapshotController {

  // GET /api/v1/snapshots
  getAll = async (req, res) => {
    const [rows] = await sequelize.query(
      'SELECT `id`,`label`,`reason`,`user_name`,`rows_count`,`total_qty`,`created_at` ' +
      'FROM `stock_snapshot` ORDER BY `id` DESC LIMIT 50'
    );

    // Hozirgi umumiy qoldiq — taqqoslash uchun
    const [[now]] = await sequelize.query(
      'SELECT COALESCE(SUM(qty),0) s FROM `product`'
    );

    res.json({
      hozirgi_qoldiq: Number(now.s) || 0,
      data: rows.map(r => ({
        id:         r.id,
        label:      r.label,
        reason:     r.reason,
        user:       r.user_name,
        rows:       Number(r.rows_count) || 0,
        totalQty:   Number(r.total_qty)  || 0,
        createdAt:  r.created_at,
      })),
    });
  };

  // GET /api/v1/snapshots/:id/preview — qaytarsak nima o'zgaradi
  preview = async (req, res) => {
    const id = Number(req.params.id);
    const [[snap]] = await sequelize.query(
      'SELECT * FROM `stock_snapshot` WHERE `id` = ?', { replacements: [id] }
    );
    if (!snap) throw new HttpException(404, 'Surat topilmadi');

    const [rows] = await sequelize.query(
      'SELECT p.id, p.name, p.qty AS hozir, si.qty AS qaytariladi ' +
      'FROM `stock_snapshot_item` si JOIN `product` p ON p.id = si.product_id ' +
      'WHERE si.snapshot_id = ? AND p.qty <> si.qty ORDER BY p.name LIMIT 100',
      { replacements: [id] }
    );
    const [[cnt]] = await sequelize.query(
      'SELECT COUNT(*) n FROM `stock_snapshot_item` si JOIN `product` p ON p.id = si.product_id ' +
      'WHERE si.snapshot_id = ? AND p.qty <> si.qty',
      { replacements: [id] }
    );

    res.json({
      label:      snap.label,
      createdAt:  snap.created_at,
      ozgaradi:   Number(cnt.n) || 0,
      namuna:     rows.map(r => ({
        id: r.id, name: r.name,
        hozir: Number(r.hozir), qaytariladi: Number(r.qaytariladi),
      })),
    });
  };

  // POST /api/v1/snapshots/:id/restore
  restore = async (req, res) => {
    const id = Number(req.params.id);

    // Qaytarishdan oldin hozirgi holatni ham saqlab qo'yamiz —
    // qaytarish ham noto'g'ri bo'lsa, orqaga yo'l qolsin
    let backId = null;
    try {
      backId = await stockGuard.takeSnapshot({
        label:  `Suratni qaytarishdan oldin (#${id})`,
        reason: 'avtomatik',
        user:   req.currentUser,
      });
    } catch { /* ixtiyoriy */ }

    let changed = 0;
    await sequelize.transaction(async (t) => {
      changed = await stockGuard.restoreSnapshot(id, { transaction: t });
    });

    res.json({
      ok: true,
      ozgardi: changed,
      oldingi_surat: backId,
      xabar: `${changed} ta tovar qoldig'i qaytarildi`,
    });
  };
}

module.exports = new SnapshotController();
