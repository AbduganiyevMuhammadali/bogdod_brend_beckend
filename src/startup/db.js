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
        // Yorliqlar chop etilganmi — tezkor kiritish tarixida ko'rsatiladi,
        // shunda qaysi hujjatga yorliq bosilgani esdan chiqmaydi
        ['purchase',         'labels_printed_at',  'DATETIME NULL DEFAULT NULL'],
        ['purchase',         'labels_printed_by',  'INT NULL DEFAULT NULL'],
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

    // Indekslar — mahsulot ko'payganda sotuv sahifasi sekinlashmasligi uchun.
    // `product.name` bo'yicha indekssiz har so'rovda butun jadval saralanardi
    // (Table scan + Sort). Mavjud bo'lsa xato beradi, uni e'tiborsiz qoldiramiz.
    const indexes = [
        ['product',          'idx_product_name',      '(`name`)'],
        ['product',          'idx_product_active',    '(`active`)'],
        // Mahsulotlar sahifasi doim `name` bo'yicha saralaydi va ko'pincha
        // kategoriya bo'yicha filtrlaydi. Birgalikda indeks bo'lmasa MySQL
        // filtrlangan satrlarni alohida saralashga majbur (filesort).
        ['product',          'idx_product_cat_name',  '(`category`, `name`)'],
        ['product',          'idx_product_active_name','(`active`, `is_folder`, `name`)'],
        // Kod/brend bo'yicha prefiks qidiruv uchun
        ['product',          'idx_product_code',      '(`code`)'],
        ['product',          'idx_product_brand',     '(`brand`)'],
        // Kam qolgan tovar sanog'i (sidebar badge) har sahifada chaqiriladi
        ['product',          'idx_product_lowstock',  '(`active`, `is_folder`, `min_qty`)'],
        ['purchase_item',    'idx_pi_prod_sold',      '(`product_id`, `sold_qty`)'],
        // FIFO: ochiq partiyani eng eskisidan qidirish
        ['purchase_item',    'idx_pi_prod_stock',     '(`product_id`, `stock_qty`, `id`)'],
        ['product_register', 'idx_pr_sale',           '(`sale_id`)'],
        ['sale',             'idx_sale_date',         '(`date`)'],
        ['sale_item',        'idx_si_sale',           '(`sale_id`)'],
        ['kassa_register',   'idx_kr_date',           '(`date`)'],
        ['product_register', 'idx_pr_date',           '(`date`)'],
        ['product_register', 'idx_pr_pitem',          '(`purchase_item_id`)'],
        ['cash_transaction', 'idx_ct_date',           '(`date`)'],
    ];
    for (const [table, name, cols] of indexes) {
        try {
            await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` ${cols}`);
            console.log(`${table}.${name} indeksi qoshildi`);
        } catch { /* already exists */ }
    }

    // Bir martalik tuzatishlar. Bajarilgani `app_setting` da belgilanadi —
    // aks holda har server ishga tushganda takrorlanib, foydalanuvchi qo'lda
    // o'zgartirgan holatni bekor qilib yuborardi.
    await runOnce(db, 'backfill_labels_printed_v1', async () => {
        // Bu funksiya qo'shilgunga qadar yaratilgan tezkor kiritish
        // hujjatlariga yorliq allaqachon chop etilgan deb hisoblaymiz —
        // amalda ular bosilib, tovarga yopishtirilgan.
        const [res] = await db.query(`
          UPDATE \`purchase\`
             SET \`labels_printed_at\` = \`date\`,
                 \`labels_printed_by\` = \`created_by\`
           WHERE \`comment\` LIKE '%qoldiq%'
             AND \`labels_printed_at\` IS NULL
        `);
        console.log(`labels_printed belgilandi: ${res?.affectedRows ?? 0} ta hujjat`);
    });
}

// Bir martalik vazifani bajaradi va bajarilganini yozib qo'yadi
async function runOnce(db, key, fn) {
    try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS \`app_setting\` (
            \`id\`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            \`key\`        VARCHAR(100) NOT NULL UNIQUE,
            \`value\`      TEXT DEFAULT NULL,
            \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        const [rows] = await db.query(
          'SELECT `value` FROM `app_setting` WHERE `key` = ? LIMIT 1', { replacements: [key] }
        );
        if (rows.length) return;          // allaqachon bajarilgan

        await fn();

        await db.query(
          'INSERT INTO `app_setting` (`key`, `value`) VALUES (?, ?)',
          { replacements: [key, new Date().toISOString()] }
        );
    } catch (e) {
        // Bir martalik tuzatish yiqilsa ham server ishga tushaversin
        console.log(`runOnce(${key}) xatolik:`, e.message);
    }
    // .catch(err => { Global exception hadler borligi uchun
    //     console.error('Baza bilan aloqa uzildi xatolik ->:', err);
    // });
}