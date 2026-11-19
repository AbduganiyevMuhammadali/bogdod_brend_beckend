const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/ai.controller')
const auth    = require('../middleware/auth.middleware')
const role    = require('../middleware/role.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')

// AI yordamchi. Suhbat hammaga (vositalar ruxsatga qaraydi),
// sozlamalar (API kalit, model) faqat rahbariyatga.
router.get('/status',    auth(), awaitHF(ctrl.status))
router.get('/greeting',  auth(), awaitHF(ctrl.greeting))
router.post('/chat',     auth(), awaitHF(ctrl.chat))
router.post('/speak',    auth(), awaitHF(ctrl.speak))
router.get('/settings',  auth(), role(...ctrl.ROLLAR), awaitHF(ctrl.getSettings))
router.put('/settings',  auth(), role(...ctrl.ROLLAR), awaitHF(ctrl.putSettings))
router.post('/test',     auth(), role(...ctrl.ROLLAR), awaitHF(ctrl.test))

module.exports = router
