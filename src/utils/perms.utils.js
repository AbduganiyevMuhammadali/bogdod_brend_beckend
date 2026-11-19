// Foydalanuvchi modul ruxsatlarini SERVER tomonda tekshirish.
//
// Frontend `usePerms.js` bilan bir xil qoida: Admin/Dasturchi/Programmer
// hamma narsani ko'radi, qolganlar uchun `user.permissions[modul].korish`.
// Eski saqlangan kalitlar (kirim, mahsulot, kassa...) ham qabul qilinadi —
// Users sahifasi ilgari shunday nomlar bilan saqlagan.
const ADMIN_ROLES = ['Admin', 'Dasturchi', 'Programmer'];

const LEGACY = {
  purchases: ['kirim'],
  products:  ['mahsulot'],
  partners:  ['kontrag'],
  payments:  ['kassa', 'tolov'],
  returns:   ['qaytarish'],
  users:     ['foydalanuvchi'],
  reports:   ['aylanma', 'balans', 'xarajat'],
};

function isAdmin(user) {
  return !!user && ADMIN_ROLES.includes(user.role);
}

function permOf(user, module) {
  let p = user?.permissions;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  if (!p) return null;
  if (p[module]) return p[module];
  for (const k of LEGACY[module] || []) if (p[k]) return p[k];
  return null;
}

/** Modulni ko'rish ruxsati. `modules` bir nechta bo'lsa — bittasi yetarli. */
function canView(user, ...modules) {
  if (isAdmin(user)) return true;
  return modules.some(m => !!permOf(user, m)?.korish);
}

module.exports = { isAdmin, canView, ADMIN_ROLES };
