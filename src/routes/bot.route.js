const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/bot.controller')
const auth    = require('../middleware/auth.middleware')
const role    = require('../middleware/role.middleware')
const botAuth = require('../middleware/botAuth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')

const ROLLAR = ['Dasturchi', 'Admin']

// ── Dastur ichidan (Sozlamalar) — oddiy auth ────────────────────────
router.post('/pair-code',    auth(), role(...ROLLAR), awaitHF(ctrl.createPairCode))
router.get('/links',         auth(), role(...ROLLAR), awaitHF(ctrl.links))
router.delete('/links/:id',  auth(), role(...ROLLAR), awaitHF(ctrl.unlink))

// ── Bot chaqiradi ───────────────────────────────────────────────────
// `pair` auth talab qilmaydi: 6 xonali kodning o'zi tasdiq bo'lib
// xizmat qiladi (5 daqiqa amal qiladi, bir marta ishlatiladi).
router.post('/pair',         awaitHF(ctrl.pair))

// Qolganlari bot tokeni bilan — faqat o'qish
router.get('/summary',       botAuth, awaitHF(ctrl.summary))
router.get('/debtors',       botAuth, awaitHF(ctrl.debtors))
router.get('/low-stock',     botAuth, awaitHF(ctrl.lowStock))
router.get('/daily-targets', botAuth, awaitHF(ctrl.dailyTargets))

module.exports = router
