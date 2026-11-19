const { Op } = require('sequelize')
const sequelize     = require('../db/db-sequelize')
const BranchModel   = require('../models/branch.model')
const UserModel     = require('../models/user.model')
const HttpException = require('../utils/HttpException.utils')
const { resetBranchCache } = require('../middleware/auth.middleware')

/**
 * Filiallar.
 *
 * Ko'rish — hamma (bosh ofis: barchasi, filial xodimi: faqat o'ziniki).
 * Yaratish/tahrirlash — faqat Admin/Dasturchi va faqat bosh ofisdan
 * (filialga biriktirilgan admin boshqa filial ocha olmaydi).
 *
 * O'chirish YO'Q: filialda ma'lumot bo'ladi, o'chirilsa hisobot buziladi.
 * Kerak bo'lsa `active = false` qilinadi — kirish to'xtaydi, tarix qoladi.
 */
class BranchController {

  /** GET /branches — ro'yxat (+ har birida nechta foydalanuvchi) */
  getAll = async (req, res) => {
    const where = {}
    if (req.branchLocked) where.id = req.branchId
    if (req.query.active === 'true') where.active = true

    const rows = await BranchModel.findAll({ where, order: [['is_main', 'DESC'], ['name', 'ASC']] })

    const counts = await UserModel.findAll({
      attributes: ['branch_id', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      where: { branch_id: { [Op.in]: rows.map(r => r.id) } },
      group: ['branch_id'], raw: true,
    }).catch(() => [])
    const byBranch = new Map(counts.map(c => [c.branch_id, Number(c.n) || 0]))

    res.json(rows.map(r => ({
      ...r.toJSON(),
      users: byBranch.get(r.id) || 0,
      current: r.id === req.branchId,
    })))
  }

  /** GET /branches/current — shu so'rov qaysi filialda ishlayapti */
  current = async (req, res) => {
    res.json({
      ...req.branch.toJSON(),
      locked: req.branchLocked,     // true → foydalanuvchi filialni o'zgartira olmaydi
    })
  }

  getById = async (req, res) => {
    const b = await BranchModel.findByPk(req.params.id)
    if (!b) throw new HttpException(404, 'Filial topilmadi')
    if (req.branchLocked && b.id !== req.branchId) throw new HttpException(403, 'Boshqa filial')
    res.json(b)
  }

  create = async (req, res) => {
    this._bosOfisShart(req)
    const data = this._pick(req.body)
    if (!data.name) throw new HttpException(400, 'Filial nomi kiritilishi shart')
    if (data.code) await this._kodBandmi(data.code)

    const b = await sequelize.transaction(async (t) => {
      const row = await BranchModel.create({ ...data, is_main: false, active: data.active !== false }, { transaction: t })
      if (req.body.is_main === true) await this._asosiyQil(row.id, t)
      return row
    })
    resetBranchCache()
    res.status(201).json(await BranchModel.findByPk(b.id))
  }

  update = async (req, res) => {
    this._bosOfisShart(req)
    const b = await BranchModel.findByPk(req.params.id)
    if (!b) throw new HttpException(404, 'Filial topilmadi')

    const data = this._pick(req.body)
    if (data.name !== undefined && !data.name) throw new HttpException(400, 'Filial nomi bo\'sh bo\'lmasin')
    if (data.code && data.code !== b.code) await this._kodBandmi(data.code, b.id)
    // Asosiy filialni faolsizlantirib bo'lmaydi — bosh ofis standart
    // tanlovsiz qoladi
    if (data.active === false && b.is_main) throw new HttpException(400, 'Asosiy filialni faolsizlantirib bo\'lmaydi')

    await sequelize.transaction(async (t) => {
      await b.update(data, { transaction: t })
      if (req.body.is_main === true && !b.is_main) await this._asosiyQil(b.id, t)
    })
    resetBranchCache()
    res.json(await BranchModel.findByPk(b.id))
  }

  // ── yordamchilar ──────────────────────────────────────────────────
  _pick(body) {
    const out = {}
    if (body.name    !== undefined) out.name    = String(body.name || '').trim().slice(0, 150)
    if (body.code    !== undefined) out.code    = String(body.code || '').trim().toUpperCase().slice(0, 30) || null
    if (body.address !== undefined) out.address = body.address ? String(body.address).trim() : null
    if (body.phone   !== undefined) out.phone   = body.phone ? String(body.phone).trim().slice(0, 30) : null
    if (body.active  !== undefined) out.active  = !!body.active
    return out
  }
  _bosOfisShart(req) {
    if (req.branchLocked) {
      throw new HttpException(403, 'Filiallarni faqat bosh ofis foydalanuvchisi boshqaradi')
    }
  }
  async _kodBandmi(code, exceptId = null) {
    const where = { code }
    if (exceptId) where.id = { [Op.ne]: exceptId }
    if (await BranchModel.findOne({ where })) throw new HttpException(400, `"${code}" kodi band`)
  }
  async _asosiyQil(id, t) {
    await BranchModel.update({ is_main: false }, { where: { is_main: true }, transaction: t })
    await BranchModel.update({ is_main: true, active: true }, { where: { id }, transaction: t })
  }
}

module.exports = new BranchController()
