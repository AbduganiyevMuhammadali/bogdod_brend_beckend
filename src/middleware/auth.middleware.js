const HttpException = require('../utils/HttpException.utils');
const UserModel = require('../models/user.model');
const BranchModel = require('../models/branch.model');
const jwt = require('jsonwebtoken');
const {secret_jwt} = require('../startup/config')
const { runWithBranch } = require('../utils/branchContext');

// Filial satrlari uchun qisqa kesh — bosh ofis foydalanuvchisi har
// so'rovda sarlavhadagi filialni tekshirtiradi, har safar bazaga
// bormaslik uchun 15 soniya eslab qolamiz.
const branchCache = new Map();   // id -> { row, at }
const CACHE_MS = 15_000;
async function findBranch(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const c = branchCache.get(n);
    if (c && Date.now() - c.at < CACHE_MS) return c.row;
    const row = await BranchModel.findByPk(n);
    branchCache.set(n, { row, at: Date.now() });
    return row;
}
let mainCache = { row: null, at: 0 };
async function mainBranch() {
    if (mainCache.row && Date.now() - mainCache.at < CACHE_MS) return mainCache.row;
    const row = await BranchModel.findOne({ where: { is_main: true, active: true } })
             || await BranchModel.findOne({ where: { active: true }, order: [['id', 'ASC']] });
    mainCache = { row, at: Date.now() };
    return row;
}
// Filial yaratilgan/o'zgargan paytda kesh eskirmasin
function resetBranchCache() { branchCache.clear(); mainCache = { row: null, at: 0 }; }

/**
 * Foydalanuvchi qaysi filialda ishlayotganini aniqlaydi.
 *
 *   • `user.branch_id` bor      → qattiq bog'langan, sarlavha e'tiborga olinmaydi
 *   • `user.branch_id = NULL`   → bosh ofis: `X-Branch-Id` sarlavhasidagi filial;
 *                                  sarlavha yo'q/noto'g'ri bo'lsa — asosiy filial
 */
async function resolveBranch(req, user) {
    if (user.branch_id) {
        const b = await findBranch(user.branch_id);
        if (!b)         throw new HttpException(403, 'Sizga biriktirilgan filial topilmadi');
        if (!b.active)  throw new HttpException(403, `"${b.name}" filiali faol emas`);
        return b;
    }
    const hdr = req.headers['x-branch-id'];
    if (hdr !== undefined && hdr !== '' && hdr !== 'null') {
        const b = await findBranch(hdr);
        if (b && b.active) return b;
    }
    const main = await mainBranch();
    if (!main) throw new HttpException(500, 'Hech qanday faol filial yo\'q');
    return main;
}

const auth = (...roles) => {
    return async function (req, res, next) {
        try {
            const authHeader = req.headers.authorization;
            const bearer = 'Bearer ';

            if (!authHeader || !authHeader.startsWith(bearer)) {
                throw new HttpException(401, req.mf('Access denied. No credentials sent!'));
            }

            const token = authHeader.replace(bearer, '');

            // Verify Token
            const decoded = jwt.verify(token, secret_jwt);
            const user = await UserModel.findOne({where:{ id: decoded.user_id }});

            if (!user) {
                throw new HttpException(401, req.mf('Authentication failed!'));
            }
            if (user.active === false) {
                throw new HttpException(401, 'Hisobingiz faolsizlantirilgan');
            }

            // check if the current user is the owner user
            const ownerAuthorized = req.params.id == user.id;

            // if the current user is not the owner and
            // if the user role don't have the permission to do this action.
            // the user will get this error
            if (!ownerAuthorized && roles.length && !roles.includes(user.role)) {
                throw new HttpException(401, req.mf('Unauthorized'));
            }

            // if the user has permissions
            req.currentUser = user;

            // ── Filial ─────────────────────────────────────────────────
            // So'rovning qolgan hamma qismi shu filial ichida ishlaydi:
            // Sequelize hook'lari `branch_id` filtrini o'zi qo'yadi.
            const branch = await resolveBranch(req, user);
            req.branch   = branch;
            req.branchId = branch.id;
            // Bosh ofis xodimi uchun `true` — frontend filial tanlagichni ko'rsatadi
            req.branchLocked = !!user.branch_id;

            runWithBranch(branch.id, () => next());

        } catch (e) {
            if (!e.status || e.status === 500) e.status = e.status || 401;
            next(e);
        }
    }
}

module.exports = auth;
module.exports.resetBranchCache = resetBranchCache;
