const HttpException = require('../utils/HttpException.utils');

/**
 * Rol bo'yicha cheklov — `auth()` dan keyin qo'yiladi.
 *
 * Nega alohida middleware kerak:
 *   `auth(...roles)` ichida "egasi o'zi" uchun chekinish bor —
 *   `req.params.id == user.id` bo'lsa rol tekshiruvi o'tkazib yuboriladi.
 *   U foydalanuvchi o'z profilini tahrirlashi uchun yozilgan, lekin
 *   `/:id` li boshqa yo'llarda (masalan /snapshots/2/restore) teshik
 *   bo'lib qoladi: id=2 xodim o'zining id siga teng har qanday resursga
 *   kira olardi. Bu middleware faqat rolga qaraydi.
 */
module.exports = function requireRole(...roles) {
  return function (req, res, next) {
    const role = req.currentUser?.role;
    if (!role || !roles.includes(role)) {
      return next(new HttpException(403, 'Bu amal uchun ruxsat yo\'q'));
    }
    next();
  };
};
