const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/backup.controller');
const auth    = require('../middleware/auth.middleware');
const role    = require('../middleware/role.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');

// Zaxira nusxa butun biznes ma'lumotini (narxlar, mijozlar, sotuvlar)
// o'z ichiga oladi — shuning uchun faqat rahbariyat rollariga ochiq.
const ROLLAR = ['Dasturchi', 'Admin'];

router.get('/info',     auth(), role(...ROLLAR), awaitHF(ctrl.info));
router.get('/download', auth(), role(...ROLLAR), awaitHF(ctrl.download));

module.exports = router;
