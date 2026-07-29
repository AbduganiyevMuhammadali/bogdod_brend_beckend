// Har daqiqa joriy vaqtni tekshiradi; agar Dasturchi tomonidan sozlangan
// bildirishnoma vaqtiga to'g'ri kelsa, barcha obunachilarga kunlik xush
// kelibsiz xabarini yuboradi. Bir daqiqa ichida bir marta yuborilishini
// kafolatlash uchun oxirgi yuborilgan "SS:DD" ni xotirada saqlaymiz.
const cron = require('node-cron');
const { sendDailyGreeting, AppSettingModel } = require('../controllers/notification.controller');
const logger = require('winston');

let lastSentAt = null; // 'YYYY-MM-DD HH:mm'

module.exports = function startNotificationCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const rows = await AppSettingModel.findAll({
        where: { key: ['daily_notification_enabled', 'daily_notification_time'] },
      });
      const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
      const enabled = map.daily_notification_enabled !== 'false';
      const time = map.daily_notification_time || '08:00';
      if (!enabled) return;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const nowKey = `${now.toISOString().slice(0, 10)} ${hh}:${mm}`;

      if (`${hh}:${mm}` === time && lastSentAt !== nowKey) {
        lastSentAt = nowKey;
        const sent = await sendDailyGreeting();
        logger.info(`Kunlik bildirishnoma yuborildi: ${sent} ta qurilmaga`);
      }
    } catch (e) {
      logger.error('Bildirishnoma cron xatosi: ' + e.message);
    }
  });
};
