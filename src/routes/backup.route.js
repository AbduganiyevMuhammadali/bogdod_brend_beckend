const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/backup.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');

// Zaxira nusxa butun biznes ma'lumotini (narxlar, mijozlar, sotuvlar)
// o'z ichiga oladi — shuning uchun faqat rahbariyat rollariga ochiq.
const ROLLAR = ['Dasturchi', 'Admin'];

router.get('/info',     auth(...ROLLAR), awaitHF(ctrl.info));
router.get('/download', auth(...ROLLAR), awaitHF(ctrl.download));

module.exports = router;
