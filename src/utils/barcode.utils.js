/**
 * Shtrix-kod variantlari.
 *
 * MUAMMO: ko'p skanerlar `0` bilan boshlanadigan EAN-13 kodni UPC-A deb
 * hisoblab, boshidagi nolni TUSHIRIB YUBORADI. Natijada yorliqda
 * `0724740032380` (13 xona) yozilgan bo'lsa, dasturga `724740032380`
 * (12 xona) keladi va tovar "bazada yo'q" bo'lib qoladi.
 *
 * Teskarisi ham bo'ladi: ba'zi skanerlar 12 xonali UPC-A ni 13 xonaga
 * to'ldirib yuboradi.
 *
 * Shuning uchun qidiruvda bir necha shaklni sinab ko'ramiz. Tartib
 * muhim: eng ehtimolli (o'zi) birinchi bo'ladi.
 *
 * @param {string} code skanerdan kelgan kod
 * @returns {string[]} tekshiriladigan variantlar (takrorlanmaydi)
 */
function barcodeVariants(code) {
  const s = String(code || '').trim();
  if (!s) return [];

  const out = [s];

  // Faqat raqamli kodlar uchun nol bilan o'ynash mantiqiy
  if (/^\d+$/.test(s)) {
    // 12 xona -> boshiga 0 qo'shib 13 ga (skaner nolni tushirgan holat)
    if (s.length === 12) out.push('0' + s);

    // 13 xona va 0 bilan boshlanadi -> nolsiz 12 xonali shakl
    if (s.length === 13 && s[0] === '0') out.push(s.slice(1));

    // Ba'zi tizimlar kodni 14 xonagacha nol bilan to'ldiradi (ITF-14)
    if (s.length === 14 && s[0] === '0') out.push(s.slice(1));
    if (s.length === 13) out.push('0' + s);

    // Boshidagi barcha nollarni olib tashlagan shakl — kod matn ustuniga
    // raqam sifatida yozilib qolgan bo'lsa yordam beradi
    const trimmed = s.replace(/^0+/, '');
    if (trimmed && trimmed !== s) out.push(trimmed);
  }

  // Takrorlarni olib tashlaymiz, tartib saqlanadi
  return [...new Set(out)];
}

/**
 * EAN-13 nazorat raqami to'g'rimi.
 * Kodni tekshirish/tashxis uchun ishlatiladi.
 */
function isValidEan13(code) {
  const s = String(code || '');
  if (!/^\d{13}$/.test(s)) return false;
  const sum = s.slice(0, 12).split('').reduce(
    (a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0
  );
  return ((10 - (sum % 10)) % 10) === Number(s[12]);
}

module.exports = { barcodeVariants, isValidEan13 };
