const webpush = require('web-push');
const PushSubscriptionModel = require('../models/push_subscription.model');
const AppSettingModel = require('../models/app_setting.model');
const { vapidPublicKey, vapidPrivateKey, vapidSubject } = require('../startup/config');
const { messaging } = require('../startup/firebase');
const BaseController = require('./BaseController');

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

// Har kuni ertalabki xush kelibsiz xabarlari — Sellz brendiga mos, tasodifiy tanlanadi
const GREETINGS = [
  { title: "Xayrli tong! ☀️",          body: "Yangi kun, yangi savdolar! Sellz siz bilan — omadli kun tilaymiz." },
  { title: "Assalomu alaykum! 🌅",     body: "Bugungi kun barakali va savdolaringiz sara bo'lsin!" },
  { title: "Sellz — xayrli tong! 🚀",  body: "Bugun ham rejalaringiz amalga oshsin, kassa doim to'lib tursin!" },
  { title: "Yangi kun boshlandi! 💪",  body: "Bugungi savdo bugungidan ham yaxshiroq bo'lsin. Omad, Sellz jamoasi!" },
  { title: "Xayrli tong! 🌤️",          body: "Har bir yangi kun — yangi imkoniyat. Savdolaringiz baraka topsin!" },
  { title: "Sellz sizga xayrli tong tilaydi 🎉", body: "Do'koningizga tashrif buyuruvchilar ko'p, savdo shirin bo'lsin!" },
  { title: "Bugun ham g'alaba kuni! 🏆", body: "Mijozlaringiz ko'p, savdolaringiz baraka topsin. Xayrli tong!" },
  { title: "Yangi kun — yangi baraka! ✨", body: "Sellz jamoasidan sizga xayrli tong va yaxshi savdo tilaymiz!" },
];

function randomGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

class NotificationController extends BaseController {

  // Brauzer push uchun kerakli public VAPID kalitni frontend so'rab oladi
  getPublicKey = async (req, res) => {
    res.json({ publicKey: vapidPublicKey });
  };

  // Foydalanuvchi push ruxsat bergandan keyin, brauzer bergan obunani saqlaydi
  subscribe = async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Noto'g'ri obuna ma'lumotlari" });
    }
    await PushSubscriptionModel.upsert({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_id: req.currentUser.id,
    });
    res.json({ ok: true });
  };

  unsubscribe = async (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) await PushSubscriptionModel.destroy({ where: { endpoint } });
    res.json({ ok: true });
  };

  // Android (Capacitor) ilova FCM tokenini shu orqali ro'yxatdan o'tkazadi
  registerFcmToken = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token yuborilmadi" });
    await PushSubscriptionModel.upsert({
      fcm_token: token,
      user_id: req.currentUser.id,
    });
    res.json({ ok: true });
  };

  unregisterFcmToken = async (req, res) => {
    const { token } = req.body;
    if (token) await PushSubscriptionModel.destroy({ where: { fcm_token: token } });
    res.json({ ok: true });
  };

  // ── Faqat Dasturchi uchun ──────────────────────────────────────
  getSettings = async (req, res) => {
    const rows = await AppSettingModel.findAll({
      where: { key: ['daily_notification_enabled', 'daily_notification_time'] },
    });
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({
      enabled: map.daily_notification_enabled !== 'false',
      time: map.daily_notification_time || '08:00',
    });
  };

  updateSettings = async (req, res) => {
    const { enabled, time } = req.body;
    if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      return res.status(400).json({ message: "Vaqt formati noto'g'ri (SS:DD)" });
    }
    if (enabled !== undefined) {
      await AppSettingModel.upsert({ key: 'daily_notification_enabled', value: String(!!enabled) });
    }
    if (time) {
      await AppSettingModel.upsert({ key: 'daily_notification_time', value: time });
    }
    res.json({ ok: true });
  };

  // Dasturchi sinov uchun darhol o'ziga xabar yubora oladi
  sendTest = async (req, res) => {
    const result = await sendDailyGreeting();
    res.json({ ok: true, ...result });
  };

  // Obunalar holatini ko'rish — push kelmasa, sababni aniqlash uchun.
  // Tokenlarni to'liq ko'rsatmaymiz, faqat oxirgi belgilarini.
  diagnostics = async (req, res) => {
    const subs = await PushSubscriptionModel.findAll({
      attributes: ['id', 'user_id', 'endpoint', 'fcm_token', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({
      firebase_ulangan: !!messaging,
      jami: subs.length,
      android: subs.filter(s => s.fcm_token).length,
      brauzer: subs.filter(s => s.endpoint).length,
      obunalar: subs.map(s => ({
        id: s.id,
        user_id: s.user_id,
        tur: s.fcm_token ? 'android' : (s.endpoint ? 'brauzer' : 'nomalum'),
        belgi: s.fcm_token ? `...${String(s.fcm_token).slice(-12)}`
             : (s.endpoint ? `...${String(s.endpoint).slice(-24)}` : null),
        qoshilgan: s.createdAt,
      })),
    });
  };
}

// cron.js dan chaqiriladi — barcha obunachilarga (brauzer + Android/FCM) bugungi tabrik xabarini yuboradi
async function sendDailyGreeting() {
  const subs = await PushSubscriptionModel.findAll();
  const { title, body } = randomGreeting();

  let sent = 0;
  const web_ok = { n: 0 }, fcm_ok = { n: 0 };
  const xatolar = [];

  // Brauzer obunachilari (Web Push / VAPID)
  const webSubs = subs.filter(s => s.endpoint);
  const webPayload = JSON.stringify({ title, body, icon: '/favicon.png' });
  await Promise.all(webSubs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        webPayload
      );
      sent++; web_ok.n++;
    } catch (e) {
      xatolar.push(`brauzer#${sub.id}: ${e.statusCode || ''} ${e.message || e}`);
      if (e.statusCode === 404 || e.statusCode === 410) {
        await PushSubscriptionModel.destroy({ where: { id: sub.id } });
      }
    }
  }));

  // Android obunachilari (Firebase Cloud Messaging)
  const fcmSubs = subs.filter(s => s.fcm_token);
  if (messaging) {
    await Promise.all(fcmSubs.map(async (sub) => {
      try {
        await messaging.send({
          token: sub.fcm_token,
          notification: { title, body },
          android: {
            priority: 'high',
            notification: {
              channelId: 'daily-greeting',
              // Kanal telefonda hali yaratilmagan bo'lsa Android xabarni
              // jimgina tashlab yuboradi. Quyidagilar standart kanalga
              // tushib qolgan holatda ham ko'rinishini ta'minlaydi.
              sound: 'default',
              defaultSound: true,
              defaultVibrateTimings: true,
              notificationPriority: 'PRIORITY_MAX',
              visibility: 'PUBLIC',
            },
          },
        });
        sent++; fcm_ok.n++;
      } catch (e) {
        xatolar.push(`android#${sub.id}: ${e.code || ''} ${e.message || e}`);
        // Token eskirgan/bekor qilingan bo'lsa — bazadan tozalaymiz
        if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token') {
          await PushSubscriptionModel.destroy({ where: { id: sub.id } });
        }
      }
    }));
  } else if (fcmSubs.length) {
    xatolar.push('Firebase ulanmagan: secrets/firebase-service-account.json topilmadi');
  }

  return {
    sent,
    brauzer_yuborildi: web_ok.n,
    android_yuborildi: fcm_ok.n,
    brauzer_obuna: webSubs.length,
    android_obuna: fcmSubs.length,
    firebase_ulangan: !!messaging,
    xatolar,
  };
}

module.exports = { controller: new NotificationController(), sendDailyGreeting, AppSettingModel };
