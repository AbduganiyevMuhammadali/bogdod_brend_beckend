#!/usr/bin/env node
/**
 * Eski sotuvlarda chegirmani `product_register` ga qo'llaydi.
 *
 * MUAMMO: chegirma butun chekka beriladi, foyda esa har mahsulot
 * bo'yicha `product_register` dan hisoblanadi. Ilgari bu jadvalga
 * chegirmasiz narx yozilardi — natijada foyda hisobotida savdo va
 * foyda haqiqiydan katta ko'rinardi.
 *
 * Sotuv kodi tuzatildi (yangi sotuvlar to'g'ri yoziladi), lekin eski
 * yozuvlar qolgan. Shu skript ularni qayta hisoblab chiqadi.
 *
 * QANDAY ISHLAYDI: har sotuv uchun chegirma nisbati topiladi
 *   nisbat = discount / total_sum
 * va shu sotuvga tegishli `product_register` satrlarining
 * `total_sum` / `price` ustunlari shu nisbatda kamaytiriladi.
 *
 * XAVFSIZ: har satr uchun asl qiymat `orig_total_sum` ustuniga
 * saqlanadi, shuning uchun qayta ishga tushirilsa ham qiymat ikki
 * marta kamaymaydi va kerak bo'lsa orqaga qaytarish mumkin.
 *
 * Ishlatish:
 *   node tools/chegirma-tuzat.js            # ko'rish (hech narsa yozilmaydi)
 *   node tools/chegirma-tuzat.js --apply    # haqiqiy tuzatish
 *   node tools/chegirma-tuzat.js --undo     # orqaga qaytarish
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const APPLY = process.argv.includes('--apply');
const UNDO  = process.argv.includes('--undo');
const fmt = n => new Intl.NumberFormat('uz-UZ').format(Math.round(Number(n) || 0));

(async () => {
  await sequelize.authenticate();
  const [[db]] = await sequelize.query('SELECT DATABASE() AS d');
  console.log(`\nBAZA: ${db.d}\n${'='.repeat(64)}`);

  // Asl qiymatni saqlash uchun ustun — bir marta qo'shiladi
  try {
    await sequelize.query(
      'ALTER TABLE `product_register` ADD COLUMN `orig_total_sum` DECIMAL(18,2) NULL DEFAULT NULL'
    );
    console.log('(orig_total_sum ustuni qo\'shildi)');
  } catch { /* allaqachon bor */ }
  try {
    await sequelize.query(
      'ALTER TABLE `product_register` ADD COLUMN `orig_price` DECIMAL(18,2) NULL DEFAULT NULL'
    );
  } catch { /* allaqachon bor */ }

  // ── ORQAGA QAYTARISH ────────────────────────────────────────────
  if (UNDO) {
    const [[c]] = await sequelize.query(
      'SELECT COUNT(*) n FROM `product_register` WHERE `orig_total_sum` IS NOT NULL'
    );
    if (!Number(c.n)) {
      console.log('Qaytariladigan satr yo\'q.');
      await sequelize.close(); return;
    }
    if (!APPLY) {
      console.log(`${c.n} ta satr qaytariladi. Bajarish uchun:`);
      console.log('   node tools/chegirma-tuzat.js --undo --apply');
      await sequelize.close(); return;
    }
    await sequelize.query(
      'UPDATE `product_register` SET `total_sum` = `orig_total_sum`, ' +
      '`price` = COALESCE(`orig_price`, `price`), ' +
      '`orig_total_sum` = NULL, `orig_price` = NULL ' +
      'WHERE `orig_total_sum` IS NOT NULL'
    );
    console.log(`${c.n} ta satr asl holiga qaytarildi.`);
    await sequelize.close(); return;
  }

  // ── TUZATILISHI KERAK SATRLAR ───────────────────────────────────
  // Faqat chegirmali va hali tuzatilmagan (orig_total_sum IS NULL)
  const [rows] = await sequelize.query(`
    SELECT s.id sale_id, s.doc_number, s.date, s.total_sum, s.discount,
           COUNT(pr.id) satrlar, SUM(pr.total_sum) reg_sum
      FROM sale s
      JOIN product_register pr ON pr.sale_id = s.id
     WHERE s.discount > 0
       AND s.status <> 'cancelled'
       AND pr.orig_total_sum IS NULL
     GROUP BY s.id
     ORDER BY s.date DESC
  `);

  if (!rows.length) {
    console.log('Tuzatiladigan sotuv topilmadi — hammasi joyida.');
    await sequelize.close(); return;
  }

  const jamiSatr = rows.reduce((a, r) => a + Number(r.satrlar), 0);
  const jamiCheg = rows.reduce((a, r) => a + Number(r.discount), 0);
  const jamiReg  = rows.reduce((a, r) => a + Number(r.reg_sum), 0);

  console.log(`Chegirmali sotuvlar:  ${rows.length} ta`);
  console.log(`Tuzatiladigan satrlar: ${jamiSatr} ta`);
  console.log(`Hisobotdagi savdo:     ${fmt(jamiReg)} so'm`);
  console.log(`Jami chegirma:         ${fmt(jamiCheg)} so'm`);
  console.log(`Tuzatgandan keyin:     ${fmt(jamiReg - jamiCheg)} so'm\n`);

  console.log('NAMUNA (oxirgi 10 ta sotuv):');
  console.table(rows.slice(0, 10).map(r => ({
    hujjat:   r.doc_number,
    sana:     new Date(r.date).toLocaleDateString('uz-UZ'),
    'chek summasi': fmt(r.total_sum),
    chegirma: fmt(r.discount),
    'hisobotda hozir': fmt(r.reg_sum),
    'bo\'ladi': fmt(Number(r.reg_sum) * (1 - Number(r.discount) / Number(r.total_sum))),
  })));

  if (!APPLY) {
    console.log('\n' + '-'.repeat(64));
    console.log('KO\'RISH REJIMI — hech narsa o\'zgartirilmadi.');
    console.log('Haqiqiy tuzatish uchun:');
    console.log('   node tools/chegirma-tuzat.js --apply');
    console.log('-'.repeat(64));
    await sequelize.close(); return;
  }

  console.log('\n>>> TUZATILMOQDA...\n');

  let tuzatildi = 0;
  await sequelize.transaction(async (t) => {
    for (const r of rows) {
      const total = Number(r.total_sum) || 0;
      const disc  = Number(r.discount)  || 0;
      if (total <= 0) continue;

      // Chegirma nisbati — 1 dan oshmasin (100% chegirma chegarasi)
      const nisbat = Math.min(disc / total, 1);
      const koef   = 1 - nisbat;

      // Asl qiymatni saqlab, keyin kamaytiramiz
      const [res] = await sequelize.query(
        'UPDATE `product_register` ' +
        '   SET `orig_total_sum` = `total_sum`, ' +
        '       `orig_price`     = `price`, ' +
        '       `total_sum`      = ROUND(`total_sum` * ?, 2), ' +
        '       `price`          = ROUND(`price` * ?, 2) ' +
        ' WHERE `sale_id` = ? AND `orig_total_sum` IS NULL',
        { replacements: [koef, koef, r.sale_id], transaction: t }
      );
      tuzatildi += res?.affectedRows || 0;
    }
  });

  console.log(`  ✓ ${tuzatildi} ta satr tuzatildi`);

  // Natijani tekshiramiz
  const [[after]] = await sequelize.query(
    'SELECT SUM(total_sum) s FROM `product_register` WHERE `status` = \'active\''
  );
  console.log(`\nHisobotdagi jami savdo endi: ${fmt(after.s)} so'm`);
  console.log('\nOrqaga qaytarish kerak bo\'lsa:');
  console.log('   node tools/chegirma-tuzat.js --undo --apply');

  await sequelize.close();
})().catch(async e => {
  console.error('\nXATOLIK:', e.message);
  console.error('Hech narsa o\'zgartirilmadi (tranzaksiya bekor qilindi).');
  try { await sequelize.close(); } catch {}
  process.exit(1);
});
