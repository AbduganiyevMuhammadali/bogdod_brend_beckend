const sequelize = require('../db/db-sequelize');

/**
 * Qoldiqni ommaviy o'zgartiruvchi amallar uchun himoya qatlami.
 *
 * Ikki vazifasi bor:
 *   1. SNAPSHOT — o'zgartirishdan OLDIN barcha qoldiqni nusxalab qo'yadi,
 *      shunda amal noto'g'ri chiqsa bitta buyruq bilan qaytariladi.
 *   2. CHEGARA  — bir amalda juda ko'p tovar nolga tushayotgan bo'lsa,
 *      buni "halokat" deb hisoblab, aniq tasdiqsiz o'tkazmaydi.
 *
 * Nega kerak: inventarizatsiya tugallanmagan holda yakunlanganda 2000+
 * tovar qoldig'i bir zumda 0 ga tushib ketgan edi. Snapshot bo'lganda
 * bunday holat bir buyruq bilan orqaga qaytadi.
 */

// Jadval bir marta yaratiladi (server ishga tushganda db.js chaqiradi)
async function ensureTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`stock_snapshot\` (
      \`id\`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      \`label\`      VARCHAR(120) NOT NULL,
      \`reason\`     VARCHAR(255) DEFAULT NULL,
      \`user_id\`    INT DEFAULT NULL,
      \`user_name\`  VARCHAR(100) DEFAULT NULL,
      \`rows_count\` INT NOT NULL DEFAULT 0,
      \`total_qty\`  DECIMAL(18,3) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_snap_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`stock_snapshot_item\` (
      \`id\`          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      \`snapshot_id\` INT NOT NULL,
      \`product_id\`  INT NOT NULL,
      \`qty\`         DECIMAL(15,3) NOT NULL DEFAULT 0,
      INDEX \`idx_snapitem\` (\`snapshot_id\`),
      INDEX \`idx_snapitem_prod\` (\`snapshot_id\`, \`product_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

/**
 * Hozirgi barcha qoldiqni saqlab qo'yadi.
 * @returns {number} snapshot id
 */
async function takeSnapshot({ label, reason = null, user = null, transaction = null } = {}) {
  const t = transaction;

  const [[agg]] = await sequelize.query(
    'SELECT COUNT(*) n, COALESCE(SUM(qty),0) s FROM `product`',
    { transaction: t }
  );

  const [res] = await sequelize.query(
    'INSERT INTO `stock_snapshot` (`label`,`reason`,`user_id`,`user_name`,`rows_count`,`total_qty`) ' +
    'VALUES (?,?,?,?,?,?)',
    {
      replacements: [
        String(label).slice(0, 120),
        reason ? String(reason).slice(0, 255) : null,
        user?.id ?? null,
        user?.username ? String(user.username).slice(0, 100) : null,
        Number(agg.n) || 0,
        Number(agg.s) || 0,
      ],
      transaction: t,
    }
  );
  const snapId = res;

  // Qoldiqlarni bitta INSERT...SELECT bilan ko'chiramiz — 2000+ tovarda ham tez
  await sequelize.query(
    'INSERT INTO `stock_snapshot_item` (`snapshot_id`,`product_id`,`qty`) ' +
    'SELECT ?, `id`, `qty` FROM `product`',
    { replacements: [snapId], transaction: t }
  );

  return snapId;
}

/**
 * Snapshot'dagi qoldiqlarni qaytaradi.
 * @returns {number} nechta tovar o'zgardi
 */
async function restoreSnapshot(snapshotId, { transaction = null } = {}) {
  const t = transaction;

  const [[snap]] = await sequelize.query(
    'SELECT * FROM `stock_snapshot` WHERE `id` = ?',
    { replacements: [snapshotId], transaction: t }
  );
  if (!snap) throw new Error('Snapshot topilmadi');

  // Faqat farqi borlarini yangilaymiz
  const [changed] = await sequelize.query(
    'SELECT COUNT(*) n FROM `stock_snapshot_item` si ' +
    'JOIN `product` p ON p.id = si.product_id ' +
    'WHERE si.snapshot_id = ? AND p.qty <> si.qty',
    { replacements: [snapshotId], transaction: t }
  );

  await sequelize.query(
    'UPDATE `product` p ' +
    'JOIN `stock_snapshot_item` si ON si.product_id = p.id AND si.snapshot_id = ? ' +
    'SET p.qty = si.qty WHERE p.qty <> si.qty',
    { replacements: [snapshotId], transaction: t }
  );

  return Number(changed?.[0]?.n) || 0;
}

/**
 * Eski snapshot'larni tozalaydi — oxirgi `keep` tasi qoladi.
 * Snapshot'lar arzon (faqat id+qty), lekin cheksiz o'smasin.
 */
async function pruneSnapshots(keep = 30) {
  const [rows] = await sequelize.query(
    'SELECT `id` FROM `stock_snapshot` ORDER BY `id` DESC LIMIT ? OFFSET ?',
    { replacements: [1000, keep] }
  );
  if (!rows.length) return 0;
  const ids = rows.map(r => Number(r.id));
  await sequelize.query(
    `DELETE FROM \`stock_snapshot_item\` WHERE \`snapshot_id\` IN (${ids.join(',')})`
  );
  await sequelize.query(
    `DELETE FROM \`stock_snapshot\` WHERE \`id\` IN (${ids.join(',')})`
  );
  return ids.length;
}

module.exports = { ensureTable, takeSnapshot, restoreSnapshot, pruneSnapshots };
