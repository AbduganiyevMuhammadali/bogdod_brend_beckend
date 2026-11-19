// Mijoz qarzini SINXRONLASH — nasiya hisobining yagona manbai.
//
// Qoida:
//   client.balance = Σ(qarz to'lovlari) − Σ(bekor qilinmagan sotuvlardagi debt_sum)
//   balance < 0 → mijoz qarzdor, balance > 0 → mijozda kredit (ortiqcha to'lagan)
//
// Qarz to'lovi mijoz kesimida qabul qilinadi (kassir "100 000 to'ladi"
// deydi, qaysi sotuv uchunligini aytmaydi). Shuning uchun to'lovlar
// mijozning OCHIQ sotuvlariga ENG ESKISIDAN boshlab taqsimlanadi va
// har sotuvning `debt_paid` ustuniga yoziladi. Qarzdorlar ro'yxati
// `debt_sum − debt_paid > 0` bo'lgan sotuvlarni ko'rsatadi — shunda
// to'langan qarz ro'yxatdan chiqadi, muddati esa sotuv bo'yicha qoladi.
//
// Funksiya IDEMPOTENT: har chaqirilganda hammasini noldan qayta hisoblaydi.
// Sotuv, to'lov, qaytarish, bekor qilish — har bir amaldan keyin chaqiriladi,
// shunda `client.balance` va `sale.debt_paid` hech qachon "qolib ketmaydi".
const sequelize = require('../db/db-sequelize');

const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

/**
 * @param {number} clientId
 * @param {{transaction?: import('sequelize').Transaction}} [opts]
 * @returns {Promise<{balance:number, qarz:number, kredit:number, tolangan:number}>}
 */
async function syncClientDebt(clientId, { transaction = null } = {}) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0) return { balance: 0, qarz: 0, kredit: 0, tolangan: 0 };
  const t = transaction;

  // Mijoz id'si butun bazada yagona — filial filtri shart emas
  const [[pay]] = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0) s FROM \`cash_transaction\`
      WHERE type = 'debt_payment' AND client_id = ?`,
    { replacements: [id], transaction: t }
  );
  const tolangan = r2(pay?.s);

  const [sales] = await sequelize.query(
    `SELECT id, debt_sum, debt_paid FROM \`sale\`
      WHERE client_id = ? AND status <> 'cancelled' AND debt_sum > 0
      ORDER BY date ASC, id ASC`,
    { replacements: [id], transaction: t }
  );

  let pool = tolangan;
  let jamiQarz = 0;
  for (const s of sales) {
    const debt = r2(s.debt_sum);
    jamiQarz = r2(jamiQarz + debt);
    const paid = r2(Math.min(debt, Math.max(0, pool)));
    pool = r2(pool - paid);
    if (Math.abs(paid - r2(s.debt_paid)) > 0.005) {
      await sequelize.query('UPDATE `sale` SET `debt_paid` = ? WHERE `id` = ?',
        { replacements: [paid, s.id], transaction: t });
    }
  }

  const balance = r2(tolangan - jamiQarz);
  await sequelize.query(
    'UPDATE `client` SET `balance` = ? WHERE `id` = ? AND (`balance` IS NULL OR ABS(`balance` - ?) > 0.005)',
    { replacements: [balance, id, balance], transaction: t }
  );

  return {
    balance,
    qarz:   balance < 0 ? -balance : 0,
    kredit: Math.max(0, pool),
    tolangan,
  };
}

/**
 * Hamma mijozni qayta hisoblash — bir martalik to'ldirish (startup) va
 * tekshiruv skriptlari uchun. Faqat sotuvi yoki to'lovi bor mijozlar.
 */
async function syncAllClients({ transaction = null } = {}) {
  const [rows] = await sequelize.query(
    `SELECT client_id FROM \`sale\` WHERE client_id IS NOT NULL
      UNION
     SELECT client_id FROM \`cash_transaction\` WHERE type = 'debt_payment' AND client_id IS NOT NULL`,
    { transaction }
  );
  let n = 0;
  for (const r of rows) { await syncClientDebt(r.client_id, { transaction }); n++; }
  return n;
}

module.exports = { syncClientDebt, syncAllClients, r2 };
