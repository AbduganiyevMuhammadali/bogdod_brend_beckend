const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/sale.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

router.get('/next-number',  auth(), awaitHF(ctrl.getNextDocNumber))
router.get('/cash-report',  auth(), awaitHF(ctrl.getCashReport))
router.get('/product-report', auth(), awaitHF(ctrl.getProductReport))
router.get('/',             auth(), awaitHF(ctrl.getAll))
router.get('/:id',          auth(), awaitHF(ctrl.getById))
router.post('/complete',    auth(), perm('sales', 'qoshish'),    awaitHF(ctrl.complete))
router.post('/pay-debt',    auth(), perm('payments', 'qoshish'), awaitHF(ctrl.payDebt))
router.post('/cash-entry',  auth(), perm('payments', 'qoshish'), awaitHF(ctrl.cashEntry))
router.post('/:id/cancel',  auth(), perm('returns', 'qoshish'),  awaitHF(ctrl.cancel))

module.exports = router
