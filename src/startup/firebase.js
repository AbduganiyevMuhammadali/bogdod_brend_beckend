// Firebase Admin SDK — Android (Capacitor) ilovaga FCM orqali push-bildirishnoma
// yuborish uchun.
//
// Kalit ikki yo'l bilan berilishi mumkin:
//   1) secrets/firebase-service-account.json fayli (lokal ish uchun qulay)
//   2) .env dagi FIREBASE_SERVICE_ACCOUNT o'zgaruvchisi — JSON matni yoki
//      uning base64 ko'rinishi (serverga deploy qilishda qulay, chunki
//      secrets/ papkasi .gitignore da va git orqali serverga tushmaydi)
//
// Ikkalasi ham bo'lmasa — FCM o'chirilgan holatda qoladi va Android
// qurilmalarga bildirishnoma bormaydi.
const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const logger = require('winston');

const KEY_PATH = path.join(__dirname, '../../secrets/firebase-service-account.json');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text);
    // .env orqali o'tganda \n belgilari matn sifatida qolib ketadi
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return { account: parsed, manba: '.env (FIREBASE_SERVICE_ACCOUNT)' };
  }

  if (fs.existsSync(KEY_PATH)) {
    return { account: require(KEY_PATH), manba: 'secrets/firebase-service-account.json' };
  }

  return null;
}

let messaging = null;
try {
  const loaded = loadServiceAccount();
  if (loaded) {
    const app = initializeApp({ credential: cert(loaded.account) });
    messaging = getMessaging(app);
    logger.info(`Firebase ulandi (${loaded.manba}), loyiha: ${loaded.account.project_id}`);
  } else {
    logger.warn(
      'Firebase kaliti topilmadi — Android push ishlamaydi. ' +
      'secrets/firebase-service-account.json faylini qo\'ying yoki ' +
      '.env ga FIREBASE_SERVICE_ACCOUNT ni yozing.'
    );
  }
} catch (e) {
  logger.error('Firebase kalitini o\'qib bo\'lmadi: ' + e.message);
}

module.exports = { messaging };
