const HttpException = require('../utils/HttpException.utils');

// Eski saqlangan ruxsat kalitlari bilan moslik (frontend usePerms.js bilan bir xil)
const LEGACY = {
  purchases: ['kirim'],
  products:  ['mahsulot'],
  partners:  ['kontrag'],
  payments:  ['kassa', 'tolov'],
  returns:   ['qaytarish'],
  users:     ['foydalanuvchi'],
  reports:   ['aylanma', 'balans', 'xarajat'],
};

// auth() dan KEYIN ishlatiladi: req.currentUser mavjud bo'lishi shart.
// Admin/Dasturchi hamma narsani qila oladi; boshqalar uchun permissions[module][action] tekshiriladi.
const perm = (module, action = 'qoshish') => (req, res, next) => {
  const user = req.currentUser;
  if (!user) return next(new HttpException(401, 'Avtorizatsiya talab qilinadi'));
  if (['Admin', 'Programmer', 'Dasturchi'].includes(user.role)) return next();

  const p = user.permissions || {};
  const entry = p[module] || (LEGACY[module] || []).map(k => p[k]).find(Boolean);
  if (entry && entry[action]) return next();

  return next(new HttpException(403, "Bu amal uchun sizga huquq berilmagan"));
};

module.exports = perm;
