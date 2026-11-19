// Filial (branch) konteksti.
//
// Har bir HTTP so'rov qaysi filialga tegishli ekani shu yerda saqlanadi.
// `auth()` middleware foydalanuvchini aniqlagach `runWithBranch` ni
// chaqiradi va so'rovning QOLGAN HAMMA qismi (kontroller, Sequelize
// so'rovlari, tranzaksiyalar) o'sha filial ichida ishlaydi.
//
// Nega AsyncLocalStorage: filial id'sini har bir funksiyaga qo'lda
// uzatish shart emas — `await` zanjiri bo'ylab avtomatik tarqaladi.
// Sequelize global hook'lari (db/branchScope.js) shu kontekstdan o'qib,
// `branch_id` ustuni bor har bir modelga filtrni o'zi qo'yadi.
const { AsyncLocalStorage } = require('async_hooks');
const HttpException = require('./HttpException.utils');

const als = new AsyncLocalStorage();

/** Berilgan filial ichida `fn` ni ishga tushiradi (sinxron yoki async). */
function runWithBranch(branchId, fn) {
  const id = Number(branchId);
  return als.run({ branchId: Number.isFinite(id) && id > 0 ? id : null }, fn);
}

/** Joriy filial id'si yoki `null` (kontekst yo'q — masalan startup, cron). */
function getBranchId() {
  return als.getStore()?.branchId ?? null;
}

/**
 * Joriy filial id'si — bo'lmasa xato. Kontrollerlardagi raw SQL va
 * `max`/`sum` kabi hook'siz chaqiruvlarda ishlatiladi: filialsiz
 * ishlashdan ko'ra xato berish xavfsizroq.
 */
function requireBranchId() {
  const id = getBranchId();
  if (!id) throw new HttpException(500, 'Filial konteksti aniqlanmadi');
  return id;
}

module.exports = { runWithBranch, getBranchId, requireBranchId };
