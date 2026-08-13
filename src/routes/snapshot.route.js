const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/snapshot.controller');
const auth    = require('../middleware/auth.middleware');
const role    = require('../middleware/role.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');

// Qoldiqni ommaviy qaytarish — faqat rahbariyat qo'lida bo'lsin.
//
// `auth(...ROLLAR)` emas, `auth()` + `role(...)` ishlatilgan: auth ichida
// "egasi o'zi" chekinishi bor va u `/:id` li yo'llarda rol tekshiruvini
// o'tkazib yuborardi (id=2 xodim /snapshots/2/... ga kira olardi).
const ROLLAR = ['Dasturchi', 'Admin'];

router.get('/',             auth(), role(...ROLLAR), awaitHF(ctrl.getAll));
router.get('/:id/preview',  auth(), role(...ROLLAR), awaitHF(ctrl.preview));
router.post('/:id/restore', auth(), role(...ROLLAR), awaitHF(ctrl.restore));

module.exports = router;
