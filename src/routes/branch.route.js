const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/branch.controller')
const auth    = require('../middleware/auth.middleware')
const role    = require('../middleware/role.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')

// Filiallar — ko'rish hammaga (o'z filialini bilish uchun),
// yaratish/tahrirlash faqat rahbariyatga.
const ROLLAR = ['Dasturchi', 'Admin', 'Programmer']

router.get('/current',  auth(), awaitHF(ctrl.current))
router.get('/',         auth(), awaitHF(ctrl.getAll))
router.get('/:id',      auth(), awaitHF(ctrl.getById))
router.post('/',        auth(), role(...ROLLAR), awaitHF(ctrl.create))
router.put('/:id',      auth(), role(...ROLLAR), awaitHF(ctrl.update))
router.patch('/:id',    auth(), role(...ROLLAR), awaitHF(ctrl.update))

module.exports = router
