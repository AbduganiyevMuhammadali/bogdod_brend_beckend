#!/usr/bin/env node
/**
 * OMBOR HISOBOTI — bazaga HECH NARSA yozmaydi, faqat o'qiydi.
 *
 * Omborda aslida nechta tovar borligini ko'rsatadi va inventarizatsiya
 * raqamlari bilan solishtiradi. "Nega tafovut chiqdi?" degan savolga
 * javob beradi.
 *
 * Ishlatish (do'kon serverida):
 *   node tools/ombor-hisobot.js        # oxirgi sanoq bilan solishtiradi
 *   node tools/ombor-hisobot.js 6      # 6-hujjat bilan
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const fmt = n => new Intl.NumberFormat('uz-UZ').format(Number(n) || 0);
const bosh = t => {
  console.log('\n' + '═'.repeat(66));
  console.log(t);
  console.log('═'.repeat(66));
};

(async () => {
  await sequelize.authenticate();
  const [[cfg]] = await sequelize.query('SELECT DATABASE() db, NOW() vaqt');

  bosh(`OMBOR HISOBOTI   ·   baza: ${cfg.db}   ·   ${new Date(cfg.vaqt).toLocaleString('uz-UZ')}`);

  // ── 1. TOVARLAR TAQSIMOTI ───────────────────────────────────────
  //
  // Sanoq varaqasi FAQAT shu shartga mos tovarlarga ochiladi:
  //   active = 1  AND  is_folder = 0  AND  qty > 0
  // Shuning uchun bazadagi umumiy son bilan sanoqdagi son FARQ QILADI.
  const [[t]] = await sequelize.query(`
    SELECT
      COUNT(*)                                                        jami,
      SUM(CASE WHEN is_folder = 1 THEN 1 ELSE 0 END)                  papka,
      SUM(CASE WHEN is_folder = 0 AND active = 0 THEN 1 ELSE 0 END)   nofaol,
      SUM(CASE WHEN is_folder = 0 AND active = 1 THEN 1 ELSE 0 END)   faol,
      SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty > 0 THEN 1 ELSE 0 END) qoldigi_bor,
      SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty = 0 THEN 1 ELSE 0 END) qoldigi_nol,
      SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty < 0 THEN 1 ELSE 0 END) manfiy,
      SUM(CASE WHEN is_folder = 0 AND active = 1 AND qty > 0 THEN qty ELSE 0 END) jami_dona
    FROM \`product\``);

  console.log('\n1) TOVARLAR TAQSIMOTI');
  console.log(`   Bazadagi barcha yozuv:        ${fmt(t.jami)}`);
  console.log(`     · papka (tovar emas):       ${fmt(t.papka)}`);
  console.log(`     · o'chirilgan (nofaol):     ${fmt(t.nofaol)}`);
  console.log(`     · FAOL TOVAR:               ${fmt(t.faol)}`);
  console.log(`         qoldig'i bor (qty > 0): ${fmt(t.qoldigi_bor)}   ← SANOQQA SHULAR TUSHADI`);
  console.log(`         qoldig'i 0:             ${fmt(t.qoldigi_nol)}   ← sanoqqa tushmaydi`);
  if (Number(t.manfiy) > 0)
    console.log(`         MANFIY qoldiq:          ${fmt(t.manfiy)}   ← XATO, tekshiring!`);
  console.log(`\n   Omborda jami:                 ${fmt(t.jami_dona)} DONA tovar`);

  // ── 2. SHTRIX-KOD HOLATI ────────────────────────────────────────
  //
  // Kodi yo'q tovarni skanerlab bo'lmaydi — u sanoqda avtomatik
  // "topilmadi" ga tushadi.
  const [[b]] = await sequelize.query(`
    SELECT
      COUNT(*) n,
      SUM(CASE WHEN barcodes IS NULL OR barcodes = '' OR barcodes = '[]' THEN 1 ELSE 0 END) kodsiz,
      SUM(CASE WHEN barcodes IS NULL OR barcodes = '' OR barcodes = '[]' THEN qty ELSE 0 END) kodsiz_dona
    FROM \`product\`
    WHERE is_folder = 0 AND active = 1 AND qty > 0`);

  console.log('\n2) SHTRIX-KOD HOLATI (qoldig\'i bor faol tovarlar)');
  console.log(`   shtrix-kodi bor:  ${fmt(Number(b.n) - Number(b.kodsiz))}`);
  console.log(`   SHTRIX-KODI YO'Q: ${fmt(b.kodsiz)}  (${fmt(b.kodsiz_dona)} dona)`);
  if (Number(b.kodsiz) > 0)
    console.log(`   => bularni SKANERLAB BO'LMAYDI, sanoqda doim "topilmadi" bo'ladi`);

  // ── 3. DUBLIKAT SHTRIX-KODLAR ───────────────────────────────────
  //
  // Ikki tovarda bir xil kod bo'lsa, skaner doim BIRINCHISIGA tushadi.
  // Ikkinchisi hech qachon skanerlanmaydi → "topilmadi" bo'lib qoladi.
  const [dubl] = await sequelize.query(`
    SELECT barcodes, COUNT(*) n, SUM(qty) dona,
           GROUP_CONCAT(name ORDER BY id SEPARATOR ' | ') nomlar
    FROM \`product\`
    WHERE is_folder = 0 AND active = 1 AND qty > 0
      AND barcodes IS NOT NULL AND barcodes <> '' AND barcodes <> '[]'
    GROUP BY barcodes HAVING n > 1
    ORDER BY n DESC, dona DESC`);

  const dublTovar = dubl.reduce((a, d) => a + Number(d.n), 0);
  const dublYoqoladi = dubl.reduce((a, d) => a + Number(d.n) - 1, 0);

  console.log('\n3) DUBLIKAT SHTRIX-KODLAR');
  console.log(`   bir xil kodli guruh:  ${fmt(dubl.length)}`);
  console.log(`   ularda jami tovar:    ${fmt(dublTovar)}`);
  console.log(`   SKANERLANMAY QOLADI:  ${fmt(dublYoqoladi)}  ← skaner faqat birinchisini topadi`);
  if (dubl.length) {
    console.log('\n   Eng ko\'p takrorlangan 10 tasi:');
    for (const d of dubl.slice(0, 10))
      console.log(`     ${String(d.barcodes).slice(0, 22).padEnd(24)} ${String(d.n).padStart(2)} ta · ${String(d.nomlar).slice(0, 60)}`);
  }

  // ── 4. INVENTARIZATSIYA BILAN SOLISHTIRISH ──────────────────────
  const arg = process.argv[2];
  const [docs] = arg
    ? await sequelize.query('SELECT * FROM `inventory` WHERE doc_number = ? OR id = ? ORDER BY id DESC LIMIT 1',
        { replacements: [arg, arg] })
    : await sequelize.query('SELECT * FROM `inventory` ORDER BY id DESC LIMIT 1');

  if (!docs.length) {
    console.log('\n4) Inventarizatsiya hujjati topilmadi');
    await sequelize.close();
    return;
  }
  const doc = docs[0];

  const [[s]] = await sequelize.query(`
    SELECT COUNT(*) satr,
      SUM(CASE WHEN counted_qty > 0 THEN 1 ELSE 0 END) sanaldi,
      SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN 1 ELSE 0 END) topilmadi,
      SUM(CASE WHEN expected_qty = 0 AND counted_qty > 0 THEN 1 ELSE 0 END) ortiqcha,
      SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN expected_qty ELSE 0 END) topilmadi_dona
    FROM \`inventory_item\` WHERE inventory_id = ?`, { replacements: [doc.id] });

  bosh(`4) INVENTARIZATSIYA #${doc.doc_number}  (${doc.status})`);
  console.log(`   ochilgan:    ${doc.created_at ? new Date(doc.created_at).toLocaleString('uz-UZ') : '—'}`);
  console.log(`   yakunlangan: ${doc.finished_at ? new Date(doc.finished_at).toLocaleString('uz-UZ') : '—'}`);
  console.log(`\n   satrlar:     ${fmt(s.satr)}`);
  console.log(`   topildi:     ${fmt(s.sanaldi)}`);
  console.log(`   TOPILMADI:   ${fmt(s.topilmadi)}   (${fmt(s.topilmadi_dona)} dona)`);
  console.log(`   ortiqcha:    ${fmt(s.ortiqcha)}`);

  // ── 5. "TOPILMADI" SABABLARINI AJRATAMIZ ────────────────────────
  //
  // Har bir sababni alohida sanaymiz — qaysi biri asosiy ekani
  // shundan ko'rinadi.
  bosh('5) "TOPILMADI" — SABABLAR BO\'YICHA');

  // (a) shtrix-kodi yo'q
  const [[a1]] = await sequelize.query(`
    SELECT COUNT(*) n, SUM(i.expected_qty) dona
    FROM \`inventory_item\` i JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0
      AND (p.barcodes IS NULL OR p.barcodes = '' OR p.barcodes = '[]')`,
    { replacements: [doc.id] });

  // (b) dublikat kodli (skaner boshqasiga tushgan)
  const [[a2]] = await sequelize.query(`
    SELECT COUNT(*) n, SUM(i.expected_qty) dona
    FROM \`inventory_item\` i JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0
      AND p.barcodes IN (
        SELECT barcodes FROM (
          SELECT barcodes FROM \`product\`
          WHERE is_folder = 0 AND active = 1
            AND barcodes IS NOT NULL AND barcodes <> '' AND barcodes <> '[]'
          GROUP BY barcodes HAVING COUNT(*) > 1
        ) x
      )`, { replacements: [doc.id] });

  // (c) sanoq davomida sotilgan
  let a3 = { n: 0, dona: 0 };
  if (doc.created_at) {
    const [[r]] = await sequelize.query(`
      SELECT COUNT(DISTINCT i.product_id) n, COALESCE(SUM(si.qty), 0) dona
      FROM \`inventory_item\` i
      JOIN \`sale_item\` si ON si.product_id = i.product_id
      JOIN \`sale\` s ON s.id = si.sale_id
        AND (s.status IS NULL OR s.status <> 'cancelled') AND s.date >= ?
      WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
      { replacements: [doc.created_at, doc.id] });
    a3 = r;
  }

  // (d) ilgari sotilgan — demak real mavjud tovar edi
  const [[a4]] = await sequelize.query(`
    SELECT COUNT(DISTINCT i.product_id) n
    FROM \`inventory_item\` i
    JOIN \`sale_item\` si ON si.product_id = i.product_id
    JOIN \`sale\` s ON s.id = si.sale_id AND (s.status IS NULL OR s.status <> 'cancelled')
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
    { replacements: [doc.id] });

  const jamiTopilmadi = Number(s.topilmadi) || 0;
  const qator = (nom, n, izoh) => {
    const foiz = jamiTopilmadi > 0 ? Math.round(Number(n) / jamiTopilmadi * 100) : 0;
    console.log(`   ${nom.padEnd(34)} ${String(fmt(n)).padStart(6)}  (${String(foiz).padStart(3)}%)  ${izoh}`);
  };

  qator('shtrix-kodi YO\'Q',            a1.n, 'skanerlab bo\'lmaydi');
  qator('dublikat kodli',               a2.n, 'skaner boshqasini topgan');
  qator('sanoq davomida sotilgan',      a3.n, 'javonda yo\'q edi — normal');
  qator('ilgari sotuvi bo\'lgan',       a4.n, 'real mavjud tovar');

  const izohlangan = Number(a1.n) + Number(a2.n);
  console.log(`\n   Texnik sabab bilan izohlanadi:  ${fmt(izohlangan)} ta`);
  console.log(`   Qolgani (skanerlanmagan):       ${fmt(jamiTopilmadi - izohlangan)} ta`);

  // ── 6. XULOSA ───────────────────────────────────────────────────
  bosh('XULOSA');
  console.log(`   Omborda faol tovar (qty>0):  ${fmt(t.qoldigi_bor)} xil · ${fmt(t.jami_dona)} dona`);
  console.log(`   Sanoqda satr:                ${fmt(s.satr)}`);
  const farq = Number(s.satr) - Number(t.qoldigi_bor);
  if (farq !== 0)
    console.log(`   Farq:                        ${farq > 0 ? '+' : ''}${fmt(farq)}  (sanoqdan keyin qoldiq o'zgargan)`);

  console.log('');
  if (Number(a1.n) > 0)
    console.log(`   ⚠  ${fmt(a1.n)} ta tovarda SHTRIX-KOD YO'Q — ularga kod bering, aks holda`);
  console.log(`      har sanoqda "topilmadi" bo'lib qolaveradi.`);
  if (Number(a2.n) > 0)
    console.log(`   ⚠  ${fmt(a2.n)} ta tovar DUBLIKAT kodli — kodlarni ajrating.`);
  const skanerlanmagan = jamiTopilmadi - izohlangan;
  if (skanerlanmagan > jamiTopilmadi * 0.5)
    console.log(`   ⚠  ${fmt(skanerlanmagan)} ta shunchaki SKANERLANMAGAN — sanoq tugatilmagan.`);

  if (doc.status === 'finished')
    console.log(`\n   Sanoq YAKUNLANGAN — bu ${fmt(s.topilmadi)} ta tovarning qoldig'i 0 ga tushgan.`);
  console.log(`   Tiklash: sahifadagi "Yakunlashni qaytarish" tugmasi.`);
  console.log('');

  await sequelize.close();
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
