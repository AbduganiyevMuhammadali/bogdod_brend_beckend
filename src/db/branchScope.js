// Sequelize uchun FILIAL FILTRI — global hook'lar.
//
// Modelda `branch_id` ustuni bo'lsa va joriy so'rov filial kontekstida
// ketayotgan bo'lsa (utils/branchContext.js):
//   • findAll / findOne / findByPk / findAndCountAll / count
//       → WHERE ga `branch_id = <joriy>` qo'shiladi
//   • Model.update(values, { where }) / Model.destroy({ where })
//       → WHERE ga `branch_id` qo'shiladi (boshqa filial satri o'zgarmaydi)
//   • create / bulkCreate / upsert
//       → yangi satrga `branch_id` yoziladi
//
// Shu tufayli kontrollerlar o'zgarmagan holda filialga bo'linib ishlaydi.
// Hook'lar faqat KONTEKST BOR paytda ishlaydi: server ishga tushishi,
// migratsiyalar va cron filialsiz, butun baza ustida ishlayveradi.
//
// Qamrab OLMAYDIGAN joylar (ularda filtr kontrollerda qo'lda qo'yiladi):
//   • `sequelize.query(...)` — raw SQL
//   • `Model.max/min/sum` — Sequelize bu agregatlarda hook chaqirmaydi
//
// Istisno: `{ allBranches: true }` opsiyasi bilan hook o'tkazib yuboriladi.
const { Op } = require('sequelize');
const { getBranchId } = require('../utils/branchContext');

function isScoped(Model) {
  if (!Model || !Model.rawAttributes || !Model.rawAttributes.branch_id) return false;
  // `branchScoped: false` — ustun bor, lekin filtr qo'lda (masalan `user`:
  // bosh ofis xodimlarida branch_id NULL, ular hamma filialga tegishli)
  return Model.options?.branchScoped !== false;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

// WHERE ga filial shartini qo'shadi. Kontroller `branch_id` ni o'zi
// aniq bergan bo'lsa (masalan bosh ofis hisoboti), unga tegilmaydi.
function scopeWhere(options, branchId) {
  if (!options || options.allBranches) return;
  const w = options.where;
  if (w == null) {
    options.where = { branch_id: branchId };
  } else if (isPlainObject(w)) {
    if (w.branch_id === undefined) w.branch_id = branchId;
  } else {
    // `sequelize.where(...)`, `literal(...)` kabi obyektlar — AND bilan o'raymiz
    options.where = { [Op.and]: [w, { branch_id: branchId }] };
  }
}

function fillInstance(inst, branchId) {
  if (!inst) return;
  const cur = typeof inst.get === 'function' ? inst.get('branch_id') : inst.branch_id;
  if (cur == null) {
    if (typeof inst.set === 'function') inst.set('branch_id', branchId);
    else inst.branch_id = branchId;
  }
}

function install(sequelize) {
  const onFind = function (options) {
    const bid = getBranchId();
    if (bid && isScoped(this)) scopeWhere(options, bid);
  };
  sequelize.addHook('beforeFind',        onFind);
  sequelize.addHook('beforeCount',       onFind);
  sequelize.addHook('beforeBulkUpdate',  onFind);
  sequelize.addHook('beforeBulkDestroy', onFind);
  // `Model.restore({ where })` (paranoid) ham filial ichida qolsin
  sequelize.addHook('beforeBulkRestore', onFind);

  // `notNull` tekshiruvi `beforeCreate` dan OLDIN (validate bosqichida)
  // ishlaydi — shuning uchun qiymat `beforeValidate` da to'ldiriladi.
  const onInstance = function (inst) {
    const bid = getBranchId();
    if (bid && isScoped(this)) fillInstance(inst, bid);
  };
  sequelize.addHook('beforeValidate', onInstance);
  sequelize.addHook('beforeCreate',   onInstance);
  sequelize.addHook('beforeBulkCreate', function (instances) {
    const bid = getBranchId();
    if (bid && isScoped(this)) (instances || []).forEach(i => fillInstance(i, bid));
  });
  sequelize.addHook('beforeUpsert', function (values) {
    const bid = getBranchId();
    if (bid && isScoped(this) && values && values.branch_id == null) values.branch_id = bid;
  });
}

module.exports = { install, isScoped };
