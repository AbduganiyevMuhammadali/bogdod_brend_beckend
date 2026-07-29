const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/client.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

router.get('/',             auth(), awaitHF(ctrl.getAll))
router.get('/:id',          auth(), awaitHF(ctrl.getById))
router.get('/:id/history',  auth(), awaitHF(ctrl.getHistory))
router.get('/:id/ledger',   auth(), awaitHF(ctrl.getLedger))
router.post('/',            auth(), perm('partners', 'qoshish'), awaitHF(ctrl.create))
router.put('/:id',          auth(), perm('partners', 'tahrir'),  awaitHF(ctrl.update))
router.delete('/:id',       auth(), perm('partners', 'tahrir'),  awaitHF(ctrl.remove))

module.exports = router
