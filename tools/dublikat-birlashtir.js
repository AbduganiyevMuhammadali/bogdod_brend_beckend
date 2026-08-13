#!/usr/bin/env node
/**
 * Bir xil nomli takroriy mahsulot yozuvlarini birlashtiradi.
 *
 * MUAMMO: bir tovar bazaga bir necha marta kiritilgan (masalan
 * "Loro Piana Finka 3XL Oq" — 4 ta alohida yozuv, har birida 1 dona).
 * Omborda esa 1 dona bor. Inventarizatsiyada kassir uni bir marta
 * skanerlaydi: bittasi "topildi", qolgan 3 tasi "topilmadi" bo'lib
 * qoladi va soxta kamomad chiqadi.
 *
 * YECHIM: har nom uchun BITTA asosiy yozuv qoldiriladi:
 *   • qoldiqlar (qty) asosiysiga yig'iladi
 *   • shtrix-kodlar birlashtiriladi (hammasi ishlaydigan bo'ladi)
 *   • kirim/sotuv satrlari asosiy tovarga ko'chiriladi
 *   • ortiqcha yozuv arxivga olinadi (paranoid delete — hisobot buzilmaydi)
 *
 * Asosiy yozuv — eng eskisi (kichik id): tarixi ko'proq bo'ladi.
 *
 * Ishlatish:
 *   node tools/dublikat-birlashtir.js            # ko'rish (hech narsa o'zgarmaydi)
 *   node tools/dublikat-birlashtir.js --apply    # haqiqiy birlashtirish
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const APPLY = process.argv.includes('--apply');

(async () => {
  await sequelize.authenticate();
  const [[db]] = await sequelize.query('SELECT DATABASE() AS d');
  console.log(`\nBAZA: ${db.d}\n${'='.repeat(60)}`);

  // Takroriy nomlar
  const [groups] = await sequelize.query(`
    SELECT name, COUNT(*) n, GROUP_CONCAT(id ORDER BY id) ids
      FROM \`product\`
     WHERE deletedAt IS NULL
     GROUP BY name HAVING COUNT(*) > 1
     ORDER BY n DESC, name
  `);

  if (!groups.length) {
    console.log('Takroriy nom topilmadi — birlashtirish shart emas.');
    await sequelize.close();
    return;
  }

  const jamiYozuv = groups.reduce((a, g) => a + Number(g.n), 0);
  console.log(`Takroriy nomlar:     ${groups.length} ta`);
  console.log(`Jami yozuvlar:       ${jamiYozuv} ta`);
  console.log(`Birlashtirilgach:    ${groups.length} ta qoladi ` +
              `(${jamiYozuv - groups.length} ta arxivga olinadi)\n`);

  // Namuna
  console.log('NAMUNA (birinchi 10 ta):');
  const namuna = [];
  for (const g of groups.slice(0, 10)) {
    const ids = g.ids.split(',').map(Number);
    const [rows] = await sequelize.query(
      `SELECT id, qty, barcodes FROM \`product\` WHERE id IN (${ids.join(',')})`
    );
    const jami = rows.reduce((a, r) => a + Number(r.qty || 0), 0);
    namuna.push({
      tovar: String(g.name).slice(0, 40),
      yozuvlar: Number(g.n),
      qoldiqlar: rows.map(r => Number(r.qty || 0)).join('+'),
      birlashgach: jami,
      asosiy_id: Math.min(...ids),
    });
  }
  console.table(namuna);

  if (!APPLY) {
    console.log('\n' + '-'.repeat(60));
    console.log('KO\'RISH REJIMI — hech narsa o\'zgartirilmadi.');
    console.log('Haqiqiy birlashtirish uchun:');
    console.log('   node tools/dublikat-birlashtir.js --apply');
    console.log('-'.repeat(60));
    await sequelize.close();
    return;
  }

  console.log('\n>>> BIRLASHTIRILMOQDA...\n');

  let birlashdi = 0, arxivlandi = 0, kochirildi = 0;

  await sequelize.transaction(async (t) => {
    for (const g of groups) {
      const ids  = g.ids.split(',').map(Number).sort((a, b) => a - b);
      const main = ids[0];              // eng eski — asosiy
      const dups = ids.slice(1);

      const [rows] = await sequelize.query(
        `SELECT id, qty, barcodes FROM \`product\` WHERE id IN (${ids.join(',')})`,
        { transaction: t }
      );

      // Qoldiqlarni yig'amiz
      const jamiQty = rows.reduce((a, r) => a + Number(r.qty || 0), 0);

      // Shtrix-kodlarni birlashtiramiz — hammasi ishlaydigan bo'lsin
      const kodlar = new Set();
      for (const r of rows) {
        let list = [];
        try { list = JSON.parse(r.barcodes) || []; } catch { /* buzuq */ }
        (list || []).forEach(b => { const s = String(b).trim(); if (s) kodlar.add(s); });
      }

      await sequelize.query(
        'UPDATE `product` SET `qty` = ?, `barcodes` = ? WHERE `id` = ?',
        { replacements: [jamiQty, JSON.stringify([...kodlar]), main], transaction: t }
      );

      // Tarixni asosiy tovarga ko'chiramiz — hisobotlar buzilmasin
      for (const table of ['sale_item', 'purchase_item', 'product_register', 'inventory_item']) {
        try {
          const [res] = await sequelize.query(
            `UPDATE \`${table}\` SET \`product_id\` = ? WHERE \`product_id\` IN (${dups.join(',')})`,
            { replacements: [main], transaction: t }
          );
          kochirildi += res?.affectedRows || 0;
        } catch { /* jadval yo'q bo'lsa o'tkazamiz */ }
      }

      // Ortiqcha yozuvlarni arxivga olamiz (butunlay o'chirmaymiz)
      await sequelize.query(
        `UPDATE \`product\` SET \`deletedAt\` = NOW() WHERE \`id\` IN (${dups.join(',')})`,
        { transaction: t }
      );

      birlashdi++;
      arxivlandi += dups.length;
    }
  });

  console.log(`  ✓ ${birlashdi} ta nom birlashtirildi`);
  console.log(`  ✓ ${arxivlandi} ta ortiqcha yozuv arxivga olindi`);
  console.log(`  ✓ ${kochirildi} ta tarix satri asosiy tovarga ko'chirildi`);

  const [[after]] = await sequelize.query(
    'SELECT COUNT(*) n, SUM(qty) q FROM `product` WHERE deletedAt IS NULL'
  );
  console.log(`\nEndi bazada: ${after.n} ta faol tovar, jami qoldiq ${after.q}`);
  console.log('\nKeyingi qadam: inventarizatsiyada "Qayta tekshirish" tugmasini bosing.');

  await sequelize.close();
})().catch(async e => {
  console.error('\nXATOLIK:', e.message);
  console.error('Hech narsa o\'zgartirilmadi (tranzaksiya bekor qilindi).');
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
