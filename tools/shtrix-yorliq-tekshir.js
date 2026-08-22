#!/usr/bin/env node
/**
 * Yorliq chop etishda muammo beradigan shtrix-kodlarni topadi.
 * Bazaga HECH NARSA yozmaydi — faqat o'qiydi.
 *
 * MUAMMO: kod bo'sh joy yoki ko'rinmas belgi bilan saqlangan bo'lsa,
 * EAN-13 tekshiruvidan o'tmaydi va yorliq CODE128 bilan chiziladi.
 * CODE128 13 xonali raqam uchun ancha KENG chiqadi — chiziqlar siqiladi
 * va arzon termal printerda skaner o'qiy olmaydi.
 *
 *   node tools/shtrix-yorliq-tekshir.js          # ko'rish
 *   node tools/shtrix-yorliq-tekshir.js --apply  # tozalash
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const APPLY = process.argv.includes('--apply');
const toza = c => String(c ?? '').replace(/[^0-9A-Za-z._-]/g, '');
const ean13 = s => {
  if (!/^\d{13}$/.test(s)) return false;
  const x = s.slice(0, 12).split('').reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return ((10 - (x % 10)) % 10) === Number(s[12]);
};

(async () => {
  await sequelize.authenticate();
  const [[db]] = await sequelize.query('SELECT DATABASE() AS d');
  console.log(`\nBAZA: ${db.d}\n${'='.repeat(60)}`);

  const [rows] = await sequelize.query(
    "SELECT id, name, barcodes FROM `product` WHERE barcodes IS NOT NULL AND barcodes <> '[]'"
  );

  let jami = 0, iflos = 0, code128 = 0;
  const tuzatish = [];
  const misollar = [];

  for (const p of rows) {
    let list = [];
    try { list = JSON.parse(p.barcodes) || []; } catch { continue; }
    if (!Array.isArray(list)) continue;

    const yangi = list.map(b => toza(b));
    let ozgardi = false;

    list.forEach((b, i) => {
      jami++;
      const s = String(b);
      if (s !== yangi[i]) {
        iflos++; ozgardi = true;
        if (misollar.length < 10) misollar.push({
          tovar: String(p.name).slice(0, 34),
          edi: JSON.stringify(s),
          boladi: yangi[i],
        });
      }
      if (!ean13(yangi[i])) code128++;
    });

    if (ozgardi) tuzatish.push({ id: p.id, barcodes: JSON.stringify(yangi) });
  }

  console.log(`Jami shtrix-kod:            ${jami}`);
  console.log(`Iflos (bo'sh joy/belgi):    ${iflos}  <- yorliq CODE128 bilan chiqadi`);
  console.log(`EAN-13 emas (normal holat): ${code128}`);

  if (misollar.length) {
    console.log('\nNAMUNA:');
    console.table(misollar);
  }

  if (!tuzatish.length) {
    console.log('\nTozalanadigan kod yo\'q — hammasi joyida.');
    await sequelize.close(); return;
  }

  if (!APPLY) {
    console.log(`\n${tuzatish.length} ta mahsulot tozalanadi.`);
    console.log('Bajarish uchun: node tools/shtrix-yorliq-tekshir.js --apply');
    await sequelize.close(); return;
  }

  await sequelize.transaction(async (t) => {
    for (const u of tuzatish) {
      await sequelize.query('UPDATE `product` SET `barcodes` = ? WHERE `id` = ?',
        { replacements: [u.barcodes, u.id], transaction: t });
    }
  });
  console.log(`\n✓ ${tuzatish.length} ta mahsulot shtrix-kodi tozalandi`);

  await sequelize.close();
})().catch(async e => {
  console.error('\nXATOLIK:', e.message);
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
