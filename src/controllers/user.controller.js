const UserModel = require('../models/user.model');
const BranchModel = require('../models/branch.model');
const HttpException = require('../utils/HttpException.utils');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret_jwt } = require('../startup/config');
const BaseController = require('./BaseController');
const { MyUser, MainUser } = require('../utils/userRoles.utils');
const { Op } = require('sequelize');

/******************************************************************************
 *                              User Controller
 *
 * FILIAL qoidalari:
 *   • Bosh ofis (branch_id = NULL) foydalanuvchi hamma xodimni ko'radi va
 *     istalgan filialga (yoki bosh ofisga) biriktira oladi.
 *   • Filialga biriktirilgan admin faqat O'Z filiali xodimlarini ko'radi
 *     va yaratganlari avtomatik o'sha filialga tushadi.
 ******************************************************************************/
class UserController extends BaseController {

    // Javobga filial nomini qo'shamiz — frontend ro'yxatda ko'rsatadi
    async _withBranch(users) {
        const list = Array.isArray(users) ? users : [users];
        const ids = [...new Set(list.map(u => u.branch_id).filter(Boolean))];
        const branches = ids.length
            ? await BranchModel.findAll({ where: { id: { [Op.in]: ids } }, raw: true })
            : [];
        const byId = new Map(branches.map(b => [b.id, b]));
        const out = list.map(u => {
            const j = u.toJSON ? u.toJSON() : { ...u };
            const b = j.branch_id ? byId.get(j.branch_id) : null;
            j.branch = b ? { id: b.id, name: b.name, code: b.code } : null;
            return j;
        });
        return Array.isArray(users) ? out : out[0];
    }

    getAll = async (req, res, next) => {
        const where = { id: { [Op.ne]: MyUser } };
        // Filial xodimi faqat o'z filialidagilarni ko'radi
        if (req.branchLocked) where.branch_id = req.branchId;
        else if (req.query.branch_id === 'null') where.branch_id = null;
        else if (req.query.branch_id) where.branch_id = Number(req.query.branch_id);

        const modelList = await UserModel.findAll({
            where,
            order: [['fullname', 'ASC'], ['id', 'ASC']],
        });
        res.send(await this._withBranch(modelList));
    };

    getById = async (req, res, next) => {
        const user = await UserModel.findOne({ where: { id: req.params.id } });
        if (!user) throw new HttpException(404, req.mf('data not found'));
        this._kirishMumkinmi(req, user);
        res.send(await this._withBranch(user));
    };

    getByUsername = async (req, res, next) => {
        const user = await UserModel.findOne({ where: { username: req.params.username } });
        if (!user) throw new HttpException(404, req.mf('data not found'));
        this._kirishMumkinmi(req, user);
        res.send(await this._withBranch(user));
    };

    // Joriy foydalanuvchi + u hozir qaysi filialda ishlayotgani
    getCurrentUser = async (req, res, next) => {
        const j = req.currentUser.toJSON();
        j.branch        = req.branch ? { id: req.branch.id, name: req.branch.name, code: req.branch.code } : null;
        j.branch_locked = !!req.branchLocked;
        res.send(j);
    };

    create = async (req, res, next) => {
        this.checkValidation(req);
        await this.hashPassword(req);
        let { username, fullname, password, role, email, warehouse, permissions, active } = req.body;

        // Login takrorlanmasin — avval baza xatosi (500) chiqardi
        if (await UserModel.findOne({ where: { username }, paranoid: false })) {
            throw new HttpException(400, 'Bu login band');
        }

        const branch_id = await this._filialniAniqla(req, req.body.branch_id);

        const model = await UserModel.create({
            username, fullname, password, role,
            email:       email       ?? null,
            warehouse:   warehouse   ?? null,
            permissions: permissions ?? null,
            active:      active !== undefined ? active : true,
            branch_id,
        });
        if (!model) throw new HttpException(500, req.mf('Something went wrong'));

        res.status(201).send(await this._withBranch(model));
    };

    update = async (req, res, next) => {
        this.checkValidation(req);
        await this.hashPassword(req);
        let { username, fullname, password, role, email, warehouse, permissions, active } = req.body;

        const model = await UserModel.findOne({ where: { id: req.params.id } });
        if (!model) throw new HttpException(404, req.mf('data not found'));
        this._kirishMumkinmi(req, model);

        if (username !== model.username &&
            await UserModel.findOne({ where: { username, id: { [Op.ne]: model.id } }, paranoid: false })) {
            throw new HttpException(400, 'Bu login band');
        }

        model.username = username;
        model.fullname = fullname;
        if (password) model.password = password;
        model.role = role;
        if (email       !== undefined) model.email       = email;
        if (warehouse   !== undefined) model.warehouse   = warehouse;
        if (permissions !== undefined) model.permissions = permissions;
        if (active      !== undefined) model.active      = active;
        if (req.body.branch_id !== undefined) {
            model.branch_id = await this._filialniAniqla(req, req.body.branch_id, model);
        }
        await model.save();

        res.send(await this._withBranch(model));
    };

    delete = async (req, res, next) => {
        const model = await UserModel.findOne({ where: { id: req.params.id } });
        if (!model) throw new HttpException(404, req.mf('data not found'));
        this._kirishMumkinmi(req, model);

        if (model.id === MainUser) throw new HttpException(400, req.mf('This item cannot be deleted'));
        if (model.id === req.currentUser.id) throw new HttpException(400, 'O\'zingizni o\'chira olmaysiz');

        try {
            await model.destroy({ force: true });
        } catch (error) {
            await model.destroy();
        }
        res.send(req.mf('data has been deleted'));
    };

    userLogin = async (req, res, next) => {
        this.checkValidation(req);
        const { username, password: pass } = req.body;

        const user = await UserModel.findOne({ where: { username } });
        if (!user) throw new HttpException(401, req.mf('Incorrect login or password!'));

        const isMatch = await bcrypt.compare(pass, user.password);
        if (!isMatch) throw new HttpException(401, req.mf('Incorrect login or password!'));
        if (user.active === false) throw new HttpException(401, 'Hisobingiz faolsizlantirilgan');

        // Filialga biriktirilgan xodimning filiali yopiq bo'lsa — kirmaydi
        let branch = null;
        if (user.branch_id) {
            branch = await BranchModel.findByPk(user.branch_id);
            if (!branch || !branch.active) {
                throw new HttpException(401, 'Sizning filialingiz faol emas. Administratorga murojaat qiling.');
            }
        }

        const token = jwt.sign({ user_id: user.id.toString() }, secret_jwt, { expiresIn: '24h' });

        const j = user.toJSON();
        j.token         = token;
        j.branch        = branch ? { id: branch.id, name: branch.name, code: branch.code } : null;
        j.branch_locked = !!user.branch_id;
        res.send(j);
    };

    // hash password if it exists
    hashPassword = async (req) => {
        if (req.body.password) {
            req.body.password = await bcrypt.hash(req.body.password, 8);
        }
    }

    // ── Filial yordamchilari ────────────────────────────────────────────

    // Filial xodimi boshqa filial foydalanuvchisiga tegmasin
    _kirishMumkinmi(req, user) {
        if (req.branchLocked && user.branch_id !== req.branchId && user.id !== req.currentUser.id) {
            throw new HttpException(403, 'Bu foydalanuvchi boshqa filialga tegishli');
        }
    }

    // So'ralgan `branch_id` ni tekshirib, saqlanadigan qiymatni qaytaradi
    async _filialniAniqla(req, requested, existing = null) {
        // Filial admini: faqat o'z filiali
        if (req.branchLocked) return req.branchId;

        if (requested === undefined) return existing ? existing.branch_id : null;
        if (requested === null || requested === '' || requested === 'null') return null;   // bosh ofis

        const b = await BranchModel.findByPk(Number(requested));
        if (!b) throw new HttpException(400, 'Filial topilmadi');
        return b.id;
    }
}

module.exports = new UserController;
