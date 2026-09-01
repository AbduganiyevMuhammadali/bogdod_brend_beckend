#!/usr/bin/env node
/**
 * SANOQ TAHLILI — bazaga HECH NARSA yozmaydi, faqat o'qiydi.
 *
 * "Topilmadi" deb belgilangan tovarlar haqiqatan yo'qmi, yoki
 * shunchaki skanerlanmay qolganmi — shuni aniqlaydi.
 *
 * Ishlatish (do'kon serverida):
 *   node tools/sanoq-tahlil.js          # oxirgi sanoq
 *   node tools/sanoq-tahlil.js 6        # 6-hujjat
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const fmt = n => new Intl.NumberFormat('uz-UZ').format(Number(n) || 0);
const chiz = () => console.log('─'.repeat(64));

(async () => {
  await sequelize.authenticate();

  const arg = process.argv[2];
  const [docs] = arg
    ? await sequelize.query('SELECT * FROM `inventory` WHERE doc_number = ? OR id = ? ORDER BY id DESC LIMIT 1',
        { replacements: [arg, arg] })
    : await sequelize.query('SELECT * FROM `inventory` ORDER BY id DESC LIMIT 1');

  if (!docs.length) { console.log('Hujjat topilmadi'); await sequelize.close(); return; }
  const doc = docs[0];

  console.log('═'.repeat(64));
  console.log(`INVENTARIZATSIYA #${doc.doc_number}  (id=${doc.id})`);
  console.log('═'.repeat(64));
  console.log(`Holati:      ${doc.status}`);
  console.log(`Ochilgan:    ${doc.created_at ? new Date(doc.created_at).toLocaleString('uz-UZ') : '—'}`);
  console.log(`Yakunlangan: ${doc.finished_at ? new Date(doc.finished_at).toLocaleString('uz-UZ') : '—'}`);
  console.log(`Hisobda edi: ${fmt(doc.total_expected)} · Sanaldi: ${fmt(doc.total_counted)}\n`);

  // ── 1. Satrlar taqsimoti ────────────────────────────────────────
  const [[st]] = await sequelize.query(`
    SELECT
      COUNT(*) jami,
      SUM(CASE WHEN counted_qty > 0 THEN 1 ELSE 0 END) sanalgan,
      SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN 1 ELSE 0 END) topilmadi,
      SUM(CASE WHEN expected_qty = 0 AND counted_qty > 0 THEN 1 ELSE 0 END) ortiqcha,
      SUM(CASE WHEN counted_qty = 0 AND expected_qty > 0 THEN expected_qty ELSE 0 END) yoqolgan_dona
    FROM \`inventory_item\` WHERE inventory_id = ?`, { replacements: [doc.id] });

  console.log('1) SATRLAR');
  console.log(`   jami satr:           ${fmt(st.jami)}`);
  console.log(`   skanerlangan:        ${fmt(st.sanalgan)}`);
  console.log(`   TOPILMADI (0 sanaldi): ${fmt(st.topilmadi)}  → ${fmt(st.yoqolgan_dona)} dona`);
  console.log(`   ortiqcha:            ${fmt(st.ortiqcha)}\n`);

  // ── 2. ENG MUHIMI: "topilmadi" larning hozirgi qoldig'i ─────────
  //
  // Sanoq yakunlangan bo'lsa, ular 0 ga tushgan bo'lishi kerak.
  // Agar qoldig'i hali ham bor bo'lsa — yakunlash ularga ta'sir
  // qilmagan (yoki keyin kirim bo'lgan).
  const [nolga] = await sequelize.query(`
    SELECT
      COUNT(*) n,
      SUM(CASE WHEN p.qty = 0 THEN 1 ELSE 0 END) hozir_nol,
      SUM(CASE WHEN p.qty > 0 THEN 1 ELSE 0 END) hozir_bor
    FROM \`inventory_item\` i
    JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
    { replacements: [doc.id] });

  console.log('2) "TOPILMADI" TOVARLARNING HOZIRGI HOLATI');
  console.log(`   qoldig'i 0:   ${fmt(nolga[0].hozir_nol)} ta  ← sanoq nolga tushirgan`);
  console.log(`   qoldig'i bor: ${fmt(nolga[0].hozir_bor)} ta\n`);

  // ── 3. Ular sotilganmi? Sotuv tarixi bor tovar — real mavjud edi ─
  const [sotuv] = await sequelize.query(`
    SELECT
      COUNT(DISTINCT i.product_id) tovar,
      COUNT(*) satr
    FROM \`inventory_item\` i
    JOIN \`sale_item\` si ON si.product_id = i.product_id
    JOIN \`sale\` s ON s.id = si.sale_id AND (s.status IS NULL OR s.status <> 'cancelled')
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
    { replacements: [doc.id] });

  console.log('3) "TOPILMADI" TOVARLAR SOTILGANMI?');
  console.log(`   sotuv tarixi bor: ${fmt(sotuv[0].tovar)} ta tovar (${fmt(sotuv[0].satr)} marta sotilgan)`);
  console.log(`   => bu tovarlar real mavjud bo'lgan, sanoqda skanerlanmay qolgan\n`);

  // ── 4. SANOQ DAVOMIDA SOTILGANLAR ───────────────────────────────
  //
  // Eng ehtimolli sabab: tovar sanoq ochilgandan keyin sotilgan,
  // shuning uchun javonda yo'q edi va skanerlanmadi.
  if (doc.created_at) {
    const [davomida] = await sequelize.query(`
      SELECT COUNT(DISTINCT si.product_id) tovar, SUM(si.qty) dona
      FROM \`inventory_item\` i
      JOIN \`sale_item\` si ON si.product_id = i.product_id
      JOIN \`sale\` s ON s.id = si.sale_id
        AND (s.status IS NULL OR s.status <> 'cancelled')
        AND s.date >= ?
      WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
      { replacements: [doc.created_at, doc.id] });

    console.log('4) SANOQ OCHILGANDAN KEYIN SOTILGANLAR');
    console.log(`   ${fmt(davomida[0].tovar)} ta tovar · ${fmt(davomida[0].dona)} dona`);
    console.log(`   => bular javonda yo'q edi, chunki sotib ketilgan — normal holat\n`);
  }

  // ── 5. SHTRIX-KOD MUAMMOSI ──────────────────────────────────────
  //
  // Skaner o'qiy olmagan bo'lishi mumkin: kodi yo'q, dublikat kod,
  // yoki noto'g'ri formatdagi kod.
  const [kod] = await sequelize.query(`
    SELECT
      SUM(CASE WHEN p.barcodes IS NULL OR p.barcodes = '' OR p.barcodes = '[]' THEN 1 ELSE 0 END) kodsiz
    FROM \`inventory_item\` i
    JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0`,
    { replacements: [doc.id] });

  console.log('5) SHTRIX-KOD MUAMMOSI');
  console.log(`   shtrix-kodi yo'q: ${fmt(kod[0].kodsiz)} ta  ← skanerlab bo'lmaydi!\n`);

  // Dublikat kodlar — bittasi skanerlansa boshqasi "topilmadi" bo'lib qoladi
  const [dubl] = await sequelize.query(`
    SELECT p.barcodes, COUNT(*) n
    FROM \`inventory_item\` i
    JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND p.barcodes IS NOT NULL
      AND p.barcodes <> '' AND p.barcodes <> '[]'
    GROUP BY p.barcodes HAVING n > 1 ORDER BY n DESC LIMIT 10`,
    { replacements: [doc.id] });

  if (dubl.length) {
    console.log("   DUBLIKAT SHTRIX-KODLAR (bittasi skanerlansa ikkinchisi topilmadi bo'lib qoladi):");
    for (const d of dubl) console.log(`     ${d.barcodes}  →  ${d.n} ta tovarda`);
    console.log('');
  }

  // ── 6. Namuna: "topilmadi" larning 15 tasi ──────────────────────
  const [namuna] = await sequelize.query(`
    SELECT i.product_name, i.barcode, i.expected_qty, p.qty hozir,
      (SELECT COUNT(*) FROM \`sale_item\` si
         JOIN \`sale\` s ON s.id = si.sale_id AND (s.status IS NULL OR s.status <> 'cancelled')
       WHERE si.product_id = i.product_id) sotilgan,
      (SELECT MAX(s.date) FROM \`sale_item\` si
         JOIN \`sale\` s ON s.id = si.sale_id AND (s.status IS NULL OR s.status <> 'cancelled')
       WHERE si.product_id = i.product_id) oxirgi_sotuv
    FROM \`inventory_item\` i
    JOIN \`product\` p ON p.id = i.product_id
    WHERE i.inventory_id = ? AND i.counted_qty = 0 AND i.expected_qty > 0
    ORDER BY i.expected_qty DESC LIMIT 15`, { replacements: [doc.id] });

  console.log('6) NAMUNA — eng ko\'p qoldiqli "topilmadi" tovarlar:');
  console.table(namuna.map(r => ({
    tovar: (r.product_name || '').slice(0, 34),
    'shtrix': r.barcode || '—',
    'hisobda edi': r.expected_qty,
    'hozir': r.hozir,
    'necha marta sotilgan': r.sotilgan,
    'oxirgi sotuv': r.oxirgi_sotuv ? new Date(r.oxirgi_sotuv).toLocaleDateString('uz-UZ') : '—',
  })));

  chiz();
  console.log('XULOSA:');
  const kodsiz = Number(kod[0].kodsiz) || 0;
  if (kodsiz > 0)
    console.log(`  • ${fmt(kodsiz)} ta tovarda shtrix-kod yo'q — ularni skanerlab bo'lmagan`);
  if (Number(sotuv[0].tovar) > 0)
    console.log(`  • ${fmt(sotuv[0].tovar)} ta tovar ilgari sotilgan — demak real mavjud edi`);
  console.log(`  • Sanoq ${doc.status === 'finished' ? 'YAKUNLANGAN' : 'yakunlanmagan'}` +
    (doc.status === 'finished'
      ? ` — "topilmadi" larning qoldig'i 0 ga tushirilgan.\n    Qaytarish: sahifadagi "Yakunlashni qaytarish" tugmasi.`
      : ''));
  chiz();

  await sequelize.close();
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
