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
    // Kodning "o'zagi" — boshidagi barcha nollarsiz shakl.
    // Skaner bitta emas, bir nechta nolni ham tushirib yuborishi mumkin
    // (masalan yorliqda 0025118631939 -> skanerda 25118631939).
    const core = s.replace(/^0+/, '');
    if (core && core !== s) out.push(core);

    // O'zakni 12, 13 va 14 xonagacha nol bilan to'ldirilgan shakllar.
    // Shu bitta halqa ilgarigi barcha alohida holatlarni qamrab oladi:
    // 12->13, 13->12, 14->13 va ko'p nolli variantlar.
    const base = core || s;
    for (const len of [12, 13, 14]) {
      if (base.length < len) out.push(base.padStart(len, '0'));
    }
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
