const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/inventory.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');
const perm    = require('../middleware/perm.middleware');

// Inventarizatsiya "products" bo'limi huquqlariga bog'langan — qoldiqni
// o'zgartirgani uchun tahrir huquqi talab qilinadi.
router.get('/',        auth(), awaitHF(ctrl.getAll));
router.get('/:id',     auth(), awaitHF(ctrl.getById));

router.post('/',       auth(), perm('products', 'qoshish'), awaitHF(ctrl.create));
router.post('/:id/scan',   auth(), perm('products', 'tahrir'), awaitHF(ctrl.scan));
router.post('/:id/finish', auth(), perm('products', 'tahrir'), awaitHF(ctrl.finish));
router.post('/:id/cancel', auth(), perm('products', 'tahrir'), awaitHF(ctrl.cancel));
// Yakunlashni qaytarish — noto'g'ri yakunlangan sanoqdan keyin qoldiqni tiklaydi
router.post('/:id/rollback', auth(), perm('products', 'tahrir'), awaitHF(ctrl.rollback));
// Noto'g'ri "ortiqcha" satrlarni qayta tekshirish va birlashtirish
router.post('/:id/repair',   auth(), perm('products', 'tahrir'), awaitHF(ctrl.repair));

router.patch('/items/:itemId',  auth(), perm('products', 'tahrir'), awaitHF(ctrl.updateItem));
router.delete('/items/:itemId', auth(), perm('products', 'tahrir'), awaitHF(ctrl.deleteItem));

router.delete('/:id',  auth(), perm('products', 'tahrir'), awaitHF(ctrl.delete));

module.exports = router;
