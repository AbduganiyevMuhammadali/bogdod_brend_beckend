const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/report.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')

router.get('/overview',         auth(), awaitHF(ctrl.getOverview))
router.get('/today',            auth(), awaitHF(ctrl.getTodaySales))
router.get('/products',         auth(), awaitHF(ctrl.getProductSales))
router.get('/clients',          auth(), awaitHF(ctrl.getClientReport))
router.get('/cashiers',         auth(), awaitHF(ctrl.getCashierReport))
router.get('/cash-register',    auth(), awaitHF(ctrl.getCashRegister))
router.get('/profit',           auth(), awaitHF(ctrl.getProfitReport))
router.get('/dashboard-extra',  auth(), awaitHF(ctrl.getDashboardExtra))
router.get('/suppliers',        auth(), awaitHF(ctrl.getSupplierReport))

module.exports = router
