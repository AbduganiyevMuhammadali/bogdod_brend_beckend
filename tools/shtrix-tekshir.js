#!/usr/bin/env node
/**
 * "Noma'lum tovar" muammosini tashxislaydi — bazaga HECH NARSA yozmaydi.
 *
 * Inventarizatsiyada topilmagan shtrix-kodlarni oladi va ular bazada
 * haqiqatan yo'qmi yoki qidiruv topa olmayaptimi — shuni aniqlaydi.
 *
 * Ishlatish:
 *   node tools/shtrix-tekshir.js              # oxirgi ochiq hujjat
 *   node tools/shtrix-tekshir.js --id=4
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const idArg = process.argv.find(a => a.startsWith('--id='));
const DOC_ID = idArg ? Number(idArg.split('=')[1]) : null;

(async () => {
  await sequelize.authenticate();

  const [docs] = DOC_ID
    ? await sequelize.query('SELECT * FROM `inventory` WHERE id=?', { replacements: [DOC_ID] })
    : await sequelize.query("SELECT * FROM `inventory` ORDER BY id DESC LIMIT 1");
  if (!docs.length) { console.log('Hujjat topilmadi'); await sequelize.close(); return; }
  const doc = docs[0];
  console.log(`\nHUJJAT #${doc.doc_number} (id=${doc.id}, ${doc.status})\n`);

  // "Noma'lum" satrlar
  const [unknown] = await sequelize.query(
    'SELECT id, barcode, product_name, counted_qty FROM `inventory_item` ' +
    'WHERE inventory_id = ? AND product_id IS NULL ORDER BY id',
    { replacements: [doc.id] }
  );
  console.log(`"Noma'lum tovar" satrlari: ${unknown.length} ta`);
  if (!unknown.length) { await sequelize.close(); return; }

  // Har birini bazada qidiramiz — turli usullar bilan
  let topildi = 0, yoq = 0;
  const misollar = [];

  for (const u of unknown) {
    const code = String(u.barcode || '').trim();
    if (!code) continue;

    // 1) JSON element sifatida aniq moslik
    const [a] = await sequelize.query(
      'SELECT id,name,barcodes FROM `product` WHERE `barcodes` LIKE ? LIMIT 5',
      { replacements: [`%"${code}"%`] }
    );
    // 2) Umuman substring
    const [b] = await sequelize.query(
      'SELECT id,name,barcodes FROM `product` WHERE `barcodes` LIKE ? LIMIT 5',
      { replacements: [`%${code}%`] }
    );
    // 3) O'chirilgan (arxivdagi) tovarlar orasida
    const [c] = await sequelize.query(
      'SELECT id,name,deletedAt FROM `product` WHERE `barcodes` LIKE ? AND `deletedAt` IS NOT NULL LIMIT 3',
      { replacements: [`%${code}%`] }
    );

    if (a.length || b.length) {
      topildi++;
      if (misollar.length < 10) {
        misollar.push({
          kod: code,
          holat: a.length ? 'ANIQ moslik bor' : 'faqat substring',
          tovar: (a[0] || b[0]).name,
          arxivda: c.length ? 'HA' : 'yo\'q',
        });
      }
    } else {
      yoq++;
      if (misollar.length < 10) misollar.push({ kod: code, holat: 'bazada YO\'Q', tovar: '—', arxivda: '—' });
    }
  }

  console.log(`  bazada topildi:     ${topildi} ta  <- bular xato, ulanishi kerak edi`);
  console.log(`  bazada haqiqatan yo'q: ${yoq} ta  <- yangi/yorliqsiz tovar\n`);
  if (misollar.length) console.table(misollar);

  // Umumiy holat: bazadagi shtrix-kodlar qanday saqlangan
  console.log('\nBAZADAGI SHTRIX-KOD FORMATLARI (namuna):');
  const [fmt] = await sequelize.query(
    "SELECT id, name, barcodes FROM `product` WHERE barcodes IS NOT NULL AND barcodes <> '[]' LIMIT 5"
  );
  fmt.forEach(p => console.log(`  #${p.id} ${String(p.name).slice(0, 30)}: ${p.barcodes}`));

  const [[cnt]] = await sequelize.query(
    "SELECT COUNT(*) n FROM `product` WHERE barcodes IS NULL OR barcodes = '[]' OR barcodes = ''"
  );
  const [[tot]] = await sequelize.query('SELECT COUNT(*) n FROM `product`');
  console.log(`\nShtrix-kodi YO'Q tovarlar: ${cnt.n} / ${tot.n}`);

  await sequelize.close();
})().catch(async e => {
  console.error('XATOLIK:', e.message);
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
