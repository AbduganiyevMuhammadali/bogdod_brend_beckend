const express = require('express');
const router = express.Router();
const { controller: ctrl } = require('../controllers/notification.controller');
const auth = require('../middleware/auth.middleware');
const awaitHF = require('../middleware/awaitHandlerFactory.middleware');

// Har qanday login qilgan foydalanuvchi o'z qurilmasidan obuna bo'la oladi
router.get('/public-key',  auth(), awaitHF(ctrl.getPublicKey));
router.post('/subscribe',   auth(), awaitHF(ctrl.subscribe));
router.post('/unsubscribe', auth(), awaitHF(ctrl.unsubscribe));

// Android (Capacitor) ilova uchun FCM token ro'yxati
router.post('/fcm-register',   auth(), awaitHF(ctrl.registerFcmToken));
router.post('/fcm-unregister', auth(), awaitHF(ctrl.unregisterFcmToken));

// Faqat "Dasturchi" hisobi bildirishnoma vaqtini sozlay oladi
router.get('/settings',        auth('Dasturchi'), awaitHF(ctrl.getSettings));
router.patch('/settings',      auth('Dasturchi'), awaitHF(ctrl.updateSettings));
router.post('/send-test',      auth('Dasturchi'), awaitHF(ctrl.sendTest));
router.get('/diagnostics',     auth('Dasturchi'), awaitHF(ctrl.diagnostics));

module.exports = router;
