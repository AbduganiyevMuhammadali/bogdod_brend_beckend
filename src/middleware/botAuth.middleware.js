const BotLinkModel  = require('../models/bot_link.model')
const HttpException = require('../utils/HttpException.utils')

/**
 * Bot uchun autentifikatsiya — `X-Bot-Token` sarlavhasi orqali.
 *
 * Oddiy `auth()` dan farqi: bu token foydalanuvchiga emas, bog'langan
 * Telegram chatga tegishli va faqat O'QISH endpointlarida ishlaydi.
 * Bot hech narsani o'zgartira olmaydi.
 */
module.exports = async function botAuth(req, res, next) {
  try {
    const token = req.headers['x-bot-token']
    if (!token) throw new HttpException(401, 'Bot tokeni yuborilmadi')

    const link = await BotLinkModel.findOne({
      where: { token: String(token), active: true },
    })
    if (!link) throw new HttpException(401, 'Bot tokeni yaroqsiz')

    req.botLink = link
    next()
  } catch (e) {
    next(e)
  }
}
