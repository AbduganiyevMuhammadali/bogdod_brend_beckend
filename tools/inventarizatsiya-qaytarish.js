#!/usr/bin/env node
/**
 * Inventarizatsiya yakunlanishini QAYTARISH (rollback).
 *
 * Nima bo'ldi:
 *   Sanoq tugallanmagan holda "Yakunlash" bosilgan. Yakunlash sanalgan
 *   miqdorni haqiqiy qoldiq deb yozadi — skanerlanmagan tovarlarning
 *   counted_qty = 0 bo'lgani uchun ularning qoldig'i 0 ga tushib qolgan.
 *
 * Nega qaytarish mumkin:
 *   Hujjat ochilganda har tovarning o'sha paytdagi qoldig'i
 *   `inventory_item.expected_qty` ga yozilgan. Yakunlash bu ustunni
 *   O'ZGARTIRMAYDI — faqat o'qiydi. Ya'ni eski qoldiqlar bazada saqlanib
 *   turibdi va shu skript ularni joyiga qaytaradi.
 *
 * Skript nimalarni qaytaradi:
 *   1. product.qty                 → expected_qty (hujjat ochilgandagi qoldiq)
 *   2. purchase_item.stock_qty     → FIFO partiyalari (yakunlash ularni ham tekislagan)
 *   3. Yakunlash ochgan "ortiqcha" kirim hujjatlari o'chiriladi
 *   4. inventory.status            → 'draft' (hujjat qayta ochiladi)
 *
 * Ishlatish (do'kondagi kompyuterda, server TO'XTATILGAN holda):
 *   node tools/inventarizatsiya-qaytarish.js            # ko'rish (hech narsa yozmaydi)
 *   node tools/inventarizatsiya-qaytarish.js --apply    # haqiqiy qaytarish
 *   node tools/inventarizatsiya-qaytarish.js --apply --id=12   # aniq hujjat
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');

// SQL loglari qaytarish natijasini ko'rinmas qilib yuboradi — o'chiramiz
sequelize.options.logging = false;

const args  = process.argv.slice(2);
const APPLY = args.includes('--apply');
const idArg = args.find(a => a.startsWith('--id='));
const DOC_ID = idArg ? Number(idArg.split('=')[1]) : null;

const fmt = n => new Intl.NumberFormat('uz-UZ').format(Number(n) || 0);

(async () => {
  await sequelize.authenticate();

  // ── 1. Qaytariladigan hujjatni topamiz ───────────────────────────────
  let docs;
  if (DOC_ID) {
    [docs] = await sequelize.query(
      'SELECT * FROM `inventory` WHERE `id` = ?', { replacements: [DOC_ID] }
    );
  } else {
    // Eng oxirgi yakunlangan hujjat
    [docs] = await sequelize.query(
      "SELECT * FROM `inventory` WHERE `status` = 'finished' ORDER BY `finished_at` DESC, `id` DESC LIMIT 1"
    );
  }

  if (!docs.length) {
    console.log('Yakunlangan inventarizatsiya hujjati topilmadi.');
    console.log('Hujjatlar ro\'yxati:');
    const [all] = await sequelize.query(
      'SELECT id, doc_number, status, date, finished_at FROM `inventory` ORDER BY id DESC LIMIT 20'
    );
    console.table(all);
    await sequelize.close();
    process.exit(1);
  }

  const doc = docs[0];

  console.log('═══════════════════════════════════════════════════════');
  console.log(`HUJJAT: #${doc.doc_number}  (id=${doc.id})`);
  console.log(`  holati:      ${doc.status}`);
  console.log(`  ochilgan:    ${doc.date}`);
  console.log(`  yakunlangan: ${doc.finished_at}`);
  console.log(`  hisobda edi: ${fmt(doc.total_expected)}`);
  console.log(`  sanaldi:     ${fmt(doc.total_counted)}`);
  console.log('═══════════════════════════════════════════════════════');

  if (doc.status !== 'finished') {
    console.log(`\nDIQQAT: hujjat holati '${doc.status}' — yakunlangan emas.`);
    console.log('Qaytarish faqat yakunlangan hujjat uchun ma\'noga ega.');
    if (!DOC_ID) { await sequelize.close(); process.exit(1); }
  }

  // ── 2. Satrlar ───────────────────────────────────────────────────────
  const [items] = await sequelize.query(
    'SELECT * FROM `inventory_item` WHERE `inventory_id` = ? ORDER BY id',
    { replacements: [doc.id] }
  );

  const real = items.filter(i => i.product_id);          // bazadagi tovarlar
  const ghosts = items.filter(i => !i.product_id);       // "noma'lum tovar" satrlari

  // Hozirgi qoldiqlar
  const ids = real.map(i => i.product_id);
  const [cur] = ids.length
    ? await sequelize.query(
        'SELECT id, name, qty FROM `product` WHERE `id` IN (' + ids.map(Number).join(',') + ')'
      )
    : [[]];
  const curById = new Map(cur.map(p => [p.id, p]));

  // ── Yakunlashdan KEYIN bo'lgan sotuvlar ──────────────────────────────
  // Halokatdan keyin kassada sotuv bo'lgan bo'lishi mumkin. Ularni
  // hisobga olmasak, sotilgan tovar qoldiqqa qayta qo'shilib qoladi
  // (ya'ni yo'q tovar bor bo'lib ko'rinadi). Shuning uchun qaytariladigan
  // qiymatdan yakunlashdan keyin sotilgani ayiriladi.
  let soldAfter = new Map();
  if (doc.finished_at && ids.length) {
    const [sold] = await sequelize.query(
      `SELECT si.product_id, SUM(si.qty) AS q
         FROM sale_item si
         JOIN sale s ON s.id = si.sale_id
        WHERE si.product_id IN (${ids.map(Number).join(',')})
          AND s.date >= ?
          AND (s.status IS NULL OR s.status <> 'cancelled')
        GROUP BY si.product_id`,
      { replacements: [doc.finished_at] }
    ).catch(() => [[]]);
    soldAfter = new Map((sold || []).map(r => [r.product_id, Number(r.q) || 0]));
  }
  const soldTotal = [...soldAfter.values()].reduce((a, b) => a + b, 0);

  // Farqi bor satrlar — aynan shular qaytariladi
  const changes = [];
  for (const it of real) {
    const p = curById.get(it.product_id);
    if (!p) continue;                                     // mahsulot o'chirilgan
    const now  = Number(p.qty) || 0;
    const sold = soldAfter.get(p.id) || 0;
    // Hujjat ochilgandagi qoldiq MINUS shundan keyin sotilgani
    const back = (Number(it.expected_qty) || 0) - sold;
    if (now !== back) changes.push({ id: p.id, name: p.name, now, back, sold });
  }

  if (soldTotal > 0) {
    console.log(`\nDIQQAT: yakunlashdan keyin ${soldTotal} dona tovar sotilgan.`);
    console.log('        Qaytariladigan qoldiqdan bu ayirildi (sotuvlar bekor qilinmaydi).');
  }

  console.log(`\nSatrlar: ${items.length} ta (bazadagi: ${real.length}, noma'lum: ${ghosts.length})`);
  console.log(`Qoldig'i o'zgargan: ${changes.length} ta tovar\n`);

  if (!changes.length) {
    console.log('Qaytariladigan o\'zgarish topilmadi — qoldiqlar allaqachon joyida.');
    await sequelize.close();
    process.exit(0);
  }

  console.log('Namuna (birinchi 15 ta):');
  console.table(changes.slice(0, 15).map(c => ({
    id: c.id,
    tovar: String(c.name).slice(0, 40),
    hozir: c.now,
    'keyin sotilgan': c.sold || 0,
    'qaytariladi': c.back,
  })));

  const sumNow  = changes.reduce((a, c) => a + c.now, 0);
  const sumBack = changes.reduce((a, c) => a + c.back, 0);
  console.log(`\nJami qoldiq:  hozir ${fmt(sumNow)}  →  qaytgach ${fmt(sumBack)}`);

  // ── 3. Yakunlash ochgan "ortiqcha" kirim hujjatlari ──────────────────
  const [extraPurchases] = await sequelize.query(
    "SELECT id, doc_number, total_sum FROM `purchase` WHERE `comment` LIKE ?",
    { replacements: [`Inventarizatsiya #${doc.doc_number} — ortiqcha%`] }
  );
  if (extraPurchases.length) {
    console.log(`\nYakunlash ochgan kirim hujjatlari (o'chiriladi): ${extraPurchases.length} ta`);
    console.table(extraPurchases);
  }

  if (!APPLY) {
    console.log('\n───────────────────────────────────────────────────────');
    console.log('BU FAQAT KO\'RISH REJIMI — hech narsa o\'zgartirilmadi.');
    console.log('Haqiqiy qaytarish uchun:');
    console.log(`   node tools/inventarizatsiya-qaytarish.js --apply --id=${doc.id}`);
    console.log('───────────────────────────────────────────────────────');
    await sequelize.close();
    process.exit(0);
  }

  // ── 4. QAYTARISH ─────────────────────────────────────────────────────
  console.log('\n>>> QAYTARILMOQDA...\n');

  await sequelize.transaction(async (t) => {
    // 4a. product.qty ni expected_qty ga qaytaramiz (bo'lakma-bo'lak)
    const CHUNK = 500;
    for (let i = 0; i < changes.length; i += CHUNK) {
      const part  = changes.slice(i, i + CHUNK);
      const cases = part.map(c => `WHEN ${Number(c.id)} THEN ${Number(c.back)}`).join(' ');
      const idList = part.map(c => Number(c.id)).join(',');
      await sequelize.query(
        `UPDATE \`product\` SET \`qty\` = CASE \`id\` ${cases} END WHERE \`id\` IN (${idList})`,
        { transaction: t }
      );
    }
    console.log(`  ✓ ${changes.length} ta tovar qoldig'i qaytarildi`);

    // 4b. Yakunlash ochgan "ortiqcha" kirim hujjatlarini o'chiramiz.
    //     Bu hujjatlar yakunlash paytida yaratilgan — qaytarganda ular
    //     ortiqcha qoldiq bo'lib qolmasligi kerak.
    if (extraPurchases.length) {
      const pids = extraPurchases.map(p => Number(p.id)).join(',');
      await sequelize.query(
        `DELETE FROM \`purchase_item\` WHERE \`purchase_id\` IN (${pids})`, { transaction: t }
      );
      await sequelize.query(
        `DELETE FROM \`purchase\` WHERE \`id\` IN (${pids})`, { transaction: t }
      );
      console.log(`  ✓ ${extraPurchases.length} ta ortiqcha kirim hujjati o'chirildi`);
    }

    // 4c. FIFO partiyalarini qoldiqqa moslaymiz.
    //     Yakunlash partiyalar yig'indisini sanalgan miqdorga tekislagan
    //     (ko'pincha 0 ga). Endi qoldiq qaytgach, partiyalar ham unga
    //     mos bo'lishi kerak — aks holda sotuvda FIFO tannarx topilmaydi.
    let fixedBatches = 0;
    for (const c of changes) {
      const [batches] = await sequelize.query(
        'SELECT id, unit_qty, sold_qty, stock_qty FROM `purchase_item` WHERE `product_id` = ? ORDER BY id ASC',
        { replacements: [c.id], transaction: t }
      );
      if (!batches.length) continue;

      const total = batches.reduce((a, b) => a + (Number(b.stock_qty) || 0), 0);
      if (total === c.back) continue;                    // allaqachon mos

      let need = c.back;
      for (const b of batches) {
        // Partiyaga sig'adigan maksimal qoldiq: kelgan - sotilgan
        const cap  = Math.max(0, (Number(b.unit_qty) || 0) - (Number(b.sold_qty) || 0));
        const give = Math.min(cap, need);
        if (Number(b.stock_qty) !== give) {
          await sequelize.query(
            'UPDATE `purchase_item` SET `stock_qty` = ? WHERE `id` = ?',
            { replacements: [give, b.id], transaction: t }
          );
          fixedBatches++;
        }
        need -= give;
      }
      // Partiyalar sig'imi yetmasa (need > 0) — eng oxirgi partiyaga qo'shamiz,
      // shunda umumiy qoldiq mahsulot qoldig'iga teng bo'ladi
      if (need > 0) {
        const last = batches[batches.length - 1];
        const [[cr]] = await sequelize.query(
          'SELECT stock_qty FROM `purchase_item` WHERE `id` = ?',
          { replacements: [last.id], transaction: t }
        );
        await sequelize.query(
          'UPDATE `purchase_item` SET `stock_qty` = ? WHERE `id` = ?',
          { replacements: [(Number(cr.stock_qty) || 0) + need, last.id], transaction: t }
        );
        fixedBatches++;
      }
    }
    console.log(`  ✓ ${fixedBatches} ta FIFO partiyasi moslandi`);

    // 4d. Hujjatni qayta ochamiz — sanoqni davom ettirish mumkin bo'lsin
    await sequelize.query(
      "UPDATE `inventory` SET `status` = 'draft', `finished_at` = NULL, " +
      "`total_counted` = 0, `total_diff_sum` = 0 WHERE `id` = ?",
      { replacements: [doc.id], transaction: t }
    );
    console.log(`  ✓ Hujjat #${doc.doc_number} qayta ochildi (draft)`);
  });

  // ── 5. Tekshirish ────────────────────────────────────────────────────
  const [after] = await sequelize.query(
    'SELECT SUM(qty) tq, SUM(CASE WHEN qty>0 THEN 1 ELSE 0 END) pos FROM `product`'
  );
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('QAYTARISH TUGADI');
  console.log(`  Jami qoldiq:      ${fmt(after[0].tq)}`);
  console.log(`  Qoldig'i bor tovar: ${after[0].pos} ta`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nEndi hujjat qayta ochilgan. Sanoqni davom ettirishingiz');
  console.log('yoki hujjatni bekor qilib, yangisini ochishingiz mumkin.');

  await sequelize.close();
})().catch(async (e) => {
  console.error('\nXATOLIK:', e.message);
  console.error('Hech narsa o\'zgartirilmadi (tranzaksiya bekor qilindi).');
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
