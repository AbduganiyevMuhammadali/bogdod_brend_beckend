#!/usr/bin/env node
/**
 * TEKSHIRISH — bazaga HECH NARSA yozmaydi, faqat o'qiydi.
 *
 * Qoldiqlarni qaytarish mumkinmi yoki yo'qmi — shuni aytadi.
 * Qaytarishdan OLDIN shuni ishga tushiring.
 *
 * Ishlatish (do'kon serverida):
 *   node tools/tekshirish.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const fmt = n => new Intl.NumberFormat('uz-UZ').format(Number(n) || 0);

(async () => {
  await sequelize.authenticate();

  const [[cfg]] = await sequelize.query('SELECT DATABASE() AS db');
  console.log('═══════════════════════════════════════════════════');
  console.log(`BAZA: ${cfg.db}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Mahsulotlar holati
  const [[p]] = await sequelize.query(
    'SELECT COUNT(*) n, SUM(qty) tq, SUM(CASE WHEN qty=0 THEN 1 ELSE 0 END) z FROM `product`'
  );
  console.log('1) MAHSULOTLAR');
  console.log(`   jami:            ${fmt(p.n)} ta`);
  console.log(`   jami qoldiq:     ${fmt(p.tq)}`);
  console.log(`   qoldig'i 0 bo'lgan: ${fmt(p.z)} ta`);

  // 2. Inventarizatsiya hujjatlari
  const [docs] = await sequelize.query(
    'SELECT id, doc_number, status, date, finished_at, total_expected, total_counted ' +
    'FROM `inventory` ORDER BY id DESC LIMIT 10'
  );
  console.log('\n2) INVENTARIZATSIYA HUJJATLARI');
  if (!docs.length) {
    console.log('   HUJJAT YO\'Q!');
    console.log('   => Qoldiqlar boshqa sababdan yo\'qolgan bo\'lishi mumkin.');
    console.log('      Bu holda skript yordam bera olmaydi — zaxira nusxa kerak.');
    await sequelize.close();
    return;
  }
  console.table(docs.map(d => ({
    id: d.id,
    hujjat: d.doc_number,
    holati: d.status,
    ochilgan: d.date ? new Date(d.date).toLocaleString('uz-UZ') : '—',
    yakunlangan: d.finished_at ? new Date(d.finished_at).toLocaleString('uz-UZ') : '—',
    'hisobda edi': fmt(d.total_expected),
    sanaldi: fmt(d.total_counted),
  })));

  // 3. Eng muhimi: expected_qty saqlanib qolganmi?
  console.log('3) QAYTARISH MUMKINMI?');
  let anyRecoverable = false;

  for (const d of docs) {
    const [[e]] = await sequelize.query(
      'SELECT COUNT(*) n, SUM(expected_qty) s, ' +
      'SUM(CASE WHEN expected_qty > 0 THEN 1 ELSE 0 END) pos ' +
      'FROM `inventory_item` WHERE `inventory_id` = ?',
      { replacements: [d.id] }
    );

    if (!Number(e.n)) continue;

    const ok = Number(e.s) > 0;
    if (ok) anyRecoverable = true;

    console.log(`\n   Hujjat #${d.doc_number} (id=${d.id}, ${d.status}):`);
    console.log(`     satrlar:                ${fmt(e.n)} ta`);
    console.log(`     expected_qty yig'indisi: ${fmt(e.s)}`);
    console.log(`     qoldig'i bor edi:        ${fmt(e.pos)} ta tovar`);
    console.log(`     => ${ok ? 'QAYTARISH MUMKIN ✓' : 'expected_qty ham 0 — qaytarib bo\'lmaydi ✗'}`);

    if (ok) {
      // Nechta tovar haqiqatan o'zgaradi
      const [[c]] = await sequelize.query(
        'SELECT COUNT(*) n FROM `inventory_item` ii ' +
        'JOIN `product` p ON p.id = ii.product_id ' +
        'WHERE ii.inventory_id = ? AND p.qty <> ii.expected_qty',
        { replacements: [d.id] }
      );
      console.log(`     qaytariladigan tovar:    ${fmt(c.n)} ta`);
      console.log(`\n     Qaytarish buyrug'i:`);
      console.log(`       node tools/inventarizatsiya-qaytarish.js --apply --id=${d.id}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  if (anyRecoverable) {
    console.log('XULOSA: Qoldiqlarni QAYTARISH MUMKIN.');
    console.log('');
    console.log('Keyingi qadamlar:');
    console.log('  1. Zaxira nusxa oling:');
    console.log(`     mysqldump -u root -p ${cfg.db} > zaxira.sql`);
    console.log('  2. Ko\'rib chiqing (hech narsa o\'zgarmaydi):');
    console.log('     node tools/inventarizatsiya-qaytarish.js');
    console.log('  3. Qaytaring (yuqoridagi --id bilan)');
  } else {
    console.log('XULOSA: expected_qty saqlanmagan — skript yordam bera olmaydi.');
    console.log('Zaxira nusxa (mysqldump) yoki MySQL binary log kerak bo\'ladi.');
  }
  console.log('═══════════════════════════════════════════════════');

  await sequelize.close();
})().catch(async (e) => {
  console.error('\nXATOLIK:', e.message);
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
