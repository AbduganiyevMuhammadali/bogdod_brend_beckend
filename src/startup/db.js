const db = require('../db/db-sequelize');
// let migration = require('./migration');

module.exports = async function(){
    await db.authenticate();
    console.log('Baza bilan aloqa ulandi');

    const migrations = [
        ['purchase_item',    'sold_qty',          'DECIMAL(15,3) NOT NULL DEFAULT 0'],
        ['sale_item',        'cost_price',         'DECIMAL(15,2) NOT NULL DEFAULT 0'],
        ['product_register', 'purchase_item_id',   'INT NULL DEFAULT NULL'],
        ['purchase',         'supplier_id',        'INT NULL DEFAULT NULL'],
        ['purchase',         'paid_sum',           'DECIMAL(18,2) NOT NULL DEFAULT 0'],
        // USD / exchange_rate columns
        ['sale',             'exchange_rate',      'DECIMAL(12,2) NOT NULL DEFAULT 0'],
        ['sale',             'total_usd',          'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['sale',             'discount_usd',       'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['sale',             'paid_usd',           'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['sale',             'debt_usd',           'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['sale_item',        'price_usd',          'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['sale_item',        'total_usd',          'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['kassa_register',   'exchange_rate',      'DECIMAL(12,2) NOT NULL DEFAULT 0'],
        ['kassa_register',   'total_usd',          'DECIMAL(15,4) NOT NULL DEFAULT 0'],
        ['cash_transaction', 'exchange_rate',      'DECIMAL(12,2) NOT NULL DEFAULT 0'],
        ['cash_transaction', 'amount_usd',         'DECIMAL(15,4) NOT NULL DEFAULT 0'],
    ];

    // supplier jadvalini yaratish (mavjud bo'lmasa)
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`supplier\` (
        \`id\`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`code\`       VARCHAR(30)  DEFAULT NULL,
        \`name\`       VARCHAR(200) NOT NULL,
        \`phone\`      VARCHAR(30)  DEFAULT NULL,
        \`address\`    TEXT         DEFAULT NULL,
        \`balance\`    DECIMAL(18,2) NOT NULL DEFAULT 0,
        \`comment\`    TEXT         DEFAULT NULL,
        \`active\`     TINYINT(1)   NOT NULL DEFAULT 1,
        \`created_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Inventarizatsiya jadvallari
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`inventory\` (
        \`id\`             INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`doc_number\`     INT NOT NULL,
        \`date\`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`warehouse\`      VARCHAR(100) DEFAULT 'Asosiy ombor',
        \`comment\`        TEXT DEFAULT NULL,
        \`status\`         ENUM('draft','finished','cancelled') NOT NULL DEFAULT 'draft',
        \`total_expected\` DECIMAL(15,3) NOT NULL DEFAULT 0,
        \`total_counted\`  DECIMAL(15,3) NOT NULL DEFAULT 0,
        \`total_diff_sum\` DECIMAL(18,2) NOT NULL DEFAULT 0,
        \`created_by\`     INT DEFAULT NULL,
        \`finished_at\`    DATETIME DEFAULT NULL,
        \`created_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS \`inventory_item\` (
        \`id\`           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`inventory_id\` INT NOT NULL,
        \`product_id\`   INT DEFAULT NULL,
        \`product_name\` VARCHAR(200) NOT NULL,
        \`barcode\`      VARCHAR(100) DEFAULT NULL,
        \`expected_qty\` DECIMAL(15,3) NOT NULL DEFAULT 0,
        \`counted_qty\`  DECIMAL(15,3) NOT NULL DEFAULT 0,
        \`cost_price\`   DECIMAL(15,2) NOT NULL DEFAULT 0,
        \`is_extra\`     TINYINT(1) NOT NULL DEFAULT 0,
        \`scanned_at\`   DATETIME DEFAULT NULL,
        \`created_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_inv\` (\`inventory_id\`),
        INDEX \`idx_inv_barcode\` (\`inventory_id\`, \`barcode\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    for (const [table, col, def] of migrations) {
        try {
            await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
            console.log(`${table}.${col} qoshildi`);
        } catch { /* already exists */ }
    }
    // .catch(err => { Global exception hadler borligi uchun
    //     console.error('Baza bilan aloqa uzildi xatolik ->:', err);
    // });
}