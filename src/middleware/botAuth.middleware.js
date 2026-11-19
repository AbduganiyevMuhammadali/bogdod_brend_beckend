const BotLinkModel  = require('../models/bot_link.model')
const BranchModel   = require('../models/branch.model')
const HttpException = require('../utils/HttpException.utils')
const { runWithBranch } = require('../utils/branchContext')

/**
 * Bot uchun autentifikatsiya — `X-Bot-Token` sarlavhasi orqali.
 *
 * Oddiy `auth()` dan farqi: bu token foydalanuvchiga emas, bog'langan
 * Telegram chatga tegishli va faqat O'QISH endpointlarida ishlaydi.
 * Bot hech narsani o'zgartira olmaydi.
 *
 * Har bog'lanish bitta FILIALGA tegishli (kod o'sha filial xodimi
 * tomonidan yasalgan). Keyingi barcha so'rovlar shu filial ichida
 * ishlaydi — bot boshqa filial ma'lumotini ko'rmaydi.
 */
module.exports = async function botAuth(req, res, next) {
  try {
    const token = req.headers['x-bot-token']
    if (!token) throw new HttpException(401, 'Bot tokeni yuborilmadi')

    // Bu yerda filial konteksti hali yo'q — token butun baza bo'ylab qidiriladi
    const link = await BotLinkModel.findOne({
      where: { token: String(token), active: true },
    })
    if (!link) throw new HttpException(401, 'Bot tokeni yaroqsiz')

    const branch = await BranchModel.findByPk(link.branch_id)
    if (!branch || !branch.active) throw new HttpException(403, 'Filial faol emas')

    req.botLink  = link
    req.branch   = branch
    req.branchId = branch.id
    runWithBranch(branch.id, () => next())
  } catch (e) {
    next(e)
  }
}
