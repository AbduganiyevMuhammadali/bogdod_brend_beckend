const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/debtor.controller')
const auth    = require('../middleware/auth.middleware')
const awaitHF = require('../middleware/awaitHandlerFactory.middleware')
const perm    = require('../middleware/perm.middleware')

// Qarzdorlar (CRM). Mijoz ma'lumoti bo'lgani uchun "partners" huquqiga
// bog'langan — ko'rish hammaga, o'zgartirish tahrir huquqiga.
//
// Diqqat: aniq yo'llar (/reminders, /notes/...) `/:id` dan OLDIN
// turishi kerak, aks holda ular id deb qabul qilinadi.
router.get('/reminders',        auth(), awaitHF(ctrl.reminders))
router.get('/',                 auth(), awaitHF(ctrl.getAll))

router.patch('/notes/:noteId',  auth(), perm('partners', 'tahrir'), awaitHF(ctrl.updateNote))
router.delete('/notes/:noteId', auth(), perm('partners', 'tahrir'), awaitHF(ctrl.removeNote))
router.patch('/sale/:saleId/due', auth(), perm('partners', 'tahrir'), awaitHF(ctrl.updateDue))

router.get('/:id',              auth(), awaitHF(ctrl.getOne))
router.patch('/:id',            auth(), perm('partners', 'tahrir'), awaitHF(ctrl.updateClient))
router.post('/:id/notes',       auth(), perm('partners', 'tahrir'), awaitHF(ctrl.addNote))

module.exports = router
