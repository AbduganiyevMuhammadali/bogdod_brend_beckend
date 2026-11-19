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
        // Qarz muddati — har sotuvga alohida. Mijozda bir necha qarz
        // bo'lsa, har birining o'z to'lash sanasi bo'ladi.
        ['sale',             'due_date',           'DATE NULL DEFAULT NULL'],
        // Mijoz CRM maydonlari
        ['client',           'status',             "VARCHAR(20) NOT NULL DEFAULT 'faol'"],
        ['client',           'tags',               'TEXT DEFAULT NULL'],
        // Bot: kunlik xabar soati (har chat o'zi tanlaydi)
        ['bot_link',         'daily_hour',         'INT NOT NULL DEFAULT 21'],
        ['bot_link',         'chat_username',      'VARCHAR(100) DEFAULT NULL'],
        ['bot_link',         'created_by_name',    'VARCHAR(100) DEFAULT NULL'],
        // Qisman qaytarish: shu satrdan qancha qaytarilgani
        ['sale_item',        'returned_qty',       'DECIMAL(15,3) NOT NULL DEFAULT 0'],
        // Sotuvdan jami qaytarilgan summa (chegirma hisobga olingan)
        ['sale',             'returned_sum',       'DECIMAL(18,2) NOT NULL DEFAULT 0'],
        // Qarzdan qancha to'langan (utils/clientDebt.utils.js taqsimlaydi)
        ['sale',             'debt_paid',          'DECIMAL(18,2) NOT NULL DEFAULT 0'],

        // ── FILIALLAR ───────────────────────────────────────────────
        // Barcha biznes jadvallarga `branch_id`. DEFAULT 1 — tizim
        // joriy etilgunga qadar yig'ilgan HAMMA ma'lumot 1-filialga
        // ("Bogdod brend") tegishli bo'lib qoladi.
        ['product',          'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['purchase',         'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['purchase_item',    'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['sale',             'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['sale_item',        'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['client',           'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['client_note',      'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['supplier',         'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['cash_transaction', 'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['kassa_register',   'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['product_register', 'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['inventory',        'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['inventory_item',   'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['bot_link',         'branch_id',          'INT NOT NULL DEFAULT 1'],
        ['stock_snapshot',   'branch_id',          'INT NOT NULL DEFAULT 1'],
        // Foydalanuvchi: NULL = bosh ofis (hamma filial), raqam = shu filial
        ['user',             'branch_id',          'INT NULL DEFAULT NULL'],
    ];

    // ── FILIAL jadvali — boshqa hamma narsadan OLDIN ─────────────────
    // Birinchi filial "Bogdod brend" (id = 1, asosiy). Yuqoridagi
    // `branch_id ... DEFAULT 1` ustunlari aynan shu satrga ishora qiladi.
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`branch\` (
        \`id\`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`name\`       VARCHAR(150) NOT NULL,
        \`code\`       VARCHAR(30)  DEFAULT NULL,
        \`address\`    TEXT         DEFAULT NULL,
        \`phone\`      VARCHAR(30)  DEFAULT NULL,
        \`is_main\`    TINYINT(1)   NOT NULL DEFAULT 0,
        \`active\`     TINYINT(1)   NOT NULL DEFAULT 1,
        \`created_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_branch_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      INSERT INTO \`branch\` (\`id\`, \`name\`, \`code\`, \`is_main\`, \`active\`)
      SELECT 1, 'Bogdod brend', 'BOGDOD', 1, 1
       WHERE NOT EXISTS (SELECT 1 FROM \`branch\`)
    `);

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

    // Telegram bot bilan bog'lanish. Har do'kon o'z serverida, bot esa
    // bitta va umumiy — bog'lanish shu jadval orqali saqlanadi.
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`bot_link\` (
        \`id\`              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`chat_id\`         VARCHAR(40)  DEFAULT NULL,
        \`chat_name\`       VARCHAR(200) DEFAULT NULL,
        \`pair_code\`       VARCHAR(10)  DEFAULT NULL,
        \`code_expires_at\` DATETIME     DEFAULT NULL,
        \`token\`           VARCHAR(120) DEFAULT NULL,
        \`active\`          TINYINT(1)   NOT NULL DEFAULT 1,
        \`daily\`           TINYINT(1)   NOT NULL DEFAULT 1,
        \`last_seen\`       DATETIME     DEFAULT NULL,
        \`created_by\`      INT          DEFAULT NULL,
        \`branch_id\`       INT NOT NULL DEFAULT 1,
        \`created_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_bot_token\` (\`token\`),
        INDEX \`idx_bot_chat\`  (\`chat_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Mijoz bilan muloqot tarixi (CRM eslatmalari).
    // Har bir qo'ng'iroq/uchrashuv/va'da shu yerga yoziladi — qarz
    // undirishda kim nima degani esdan chiqmasin.
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`client_note\` (
        \`id\`         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`client_id\`  INT NOT NULL,
        \`text\`       TEXT NOT NULL,
        \`kind\`       VARCHAR(20) NOT NULL DEFAULT 'izoh',
        \`remind_at\`  DATE DEFAULT NULL,
        \`done\`       TINYINT(1) NOT NULL DEFAULT 0,
        \`user_id\`    INT DEFAULT NULL,
        \`user_name\`  VARCHAR(100) DEFAULT NULL,
        \`branch_id\`  INT NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_note_client\` (\`client_id\`, \`created_at\`),
        INDEX \`idx_note_remind\` (\`remind_at\`, \`done\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Qoldiq "surat"lari (snapshot) — ommaviy o'zgarishdan oldin qoldiqlar
    // shu jadvalga nusxalanadi va kerak bo'lsa bir buyruq bilan qaytariladi.
    // Ustun qo'shish siklidan OLDIN: `stock_snapshot.branch_id` shu jadvalga
    // qo'shiladi.
    try {
        await require('../utils/stockGuard.utils').ensureTable();
    } catch (e) {
        console.log('stock_snapshot jadvali yaratilmadi:', e.message);
    }

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
        // Qarzdorlar ro'yxati: muddati kelganlarni tez topish uchun
        ['sale',             'idx_sale_due',          '(`due_date`, `debt_sum`)'],
        ['sale',             'idx_sale_client_debt',  '(`client_id`, `debt_sum`)'],
        ['sale',             'idx_sale_date',         '(`date`)'],
        ['sale_item',        'idx_si_sale',           '(`sale_id`)'],
        ['kassa_register',   'idx_kr_date',           '(`date`)'],
        ['product_register', 'idx_pr_date',           '(`date`)'],
        ['product_register', 'idx_pr_pitem',          '(`purchase_item_id`)'],
        ['cash_transaction', 'idx_ct_date',           '(`date`)'],
        // Filial bo'yicha: har so'rovda `branch_id = ?` sharti bor, shuning
        // uchun eng ko'p ishlatiladigan jadvallarda (filial, sana) indeks
        ['product',          'idx_product_branch',    '(`branch_id`, `active`, `is_folder`, `name`)'],
        ['sale',             'idx_sale_branch_date',  '(`branch_id`, `date`)'],
        ['sale',             'idx_sale_branch_client','(`branch_id`, `client_id`, `debt_sum`)'],
        ['kassa_register',   'idx_kr_branch_date',    '(`branch_id`, `status`, `date`)'],
        ['product_register', 'idx_pr_branch_date',    '(`branch_id`, `status`, `date`)'],
        ['cash_transaction', 'idx_ct_branch_date',    '(`branch_id`, `type`, `date`)'],
        ['cash_transaction', 'idx_ct_client',         '(`client_id`, `type`)'],
        ['cash_transaction', 'idx_ct_ref',            '(`reference_type`, `reference_id`)'],
        ['purchase',         'idx_purchase_branch',   '(`branch_id`, `status`, `date`)'],
        ['purchase_item',    'idx_pi_branch_prod',    '(`branch_id`, `product_id`)'],
        ['client',           'idx_client_branch',     '(`branch_id`, `name`)'],
        ['supplier',         'idx_supplier_branch',   '(`branch_id`, `name`)'],
        ['inventory',        'idx_inventory_branch',  '(`branch_id`, `status`)'],
        ['user',             'idx_user_branch',       '(`branch_id`)'],
        ['bot_link',         'idx_bot_branch',        '(`branch_id`)'],
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
    // FILIAL: mavjud foydalanuvchilarni biriktirish.
    //   • Admin / Dasturchi / Programmer → bosh ofis (NULL): hamma filialni
    //     ko'ra oladi, standart tanlovi asosiy filial — ish tartibi o'zgarmaydi,
    //     lekin yangi filial ochib, unga xodim biriktira oladi.
    //   • qolganlar (User)              → 1-filial ("Bogdod brend")
    await runOnce(db, 'branch_assign_users_v1', async () => {
        const [r] = await db.query(`
          UPDATE \`user\` SET \`branch_id\` = 1
           WHERE \`branch_id\` IS NULL
             AND \`role\` NOT IN ('Admin', 'Dasturchi', 'Programmer')
        `);
        console.log(`Filialga biriktirildi: ${r?.affectedRows ?? 0} ta foydalanuvchi`);
    });

    // NASIYA: `sale.debt_paid` ni mavjud to'lovlardan to'ldirish va
    // `client.balance` ni yagona qoida bo'yicha qayta hisoblash
    // (utils/clientDebt.utils.js). Ilgari qarz to'lovi sotuvga
    // bog'lanmasdi va Qarzdorlar ro'yxati to'langan qarzni ko'rsatib
    // turardi.
    await runOnce(db, 'backfill_debt_paid_v1', async () => {
        const { syncAllClients } = require('../utils/clientDebt.utils');
        const n = await syncAllClients();
        console.log(`Qarz sinxronlandi: ${n} ta mijoz`);
    });

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