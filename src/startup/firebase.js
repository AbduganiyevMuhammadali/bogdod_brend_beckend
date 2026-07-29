// Firebase Admin SDK — Android (Capacitor) ilovaga FCM orqali push-bildirishnoma
// yuborish uchun. Xizmat hisobi kaliti (maxfiy!) beckend/secrets/ papkasida
// saqlanadi va .gitignore orqali repo'ga tushmasligi ta'minlangan.
const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('winston');

const KEY_PATH = path.join(__dirname, '../../secrets/firebase-service-account.json');

let messaging = null;
if (fs.existsSync(KEY_PATH)) {
  const serviceAccount = require(KEY_PATH);
  const app = initializeApp({ credential: cert(serviceAccount) });
  messaging = getMessaging(app);
} else {
  logger.warn('Firebase xizmat hisobi kaliti topilmadi (secrets/firebase-service-account.json) — FCM push ishlamaydi.');
}

module.exports = { messaging };
