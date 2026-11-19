// AI yordamchi "vositalari" (function calling) — Gemini so'ragan ma'lumotni
// shu funksiyalar bazadan oladi va qisqa JSON qaytaradi.
//
// Qoidalar:
//   • Hamma so'rov JORIY FILIAL ichida (`requireBranchId()`); raw SQL bo'lgani
//     uchun Sequelize hook'lari emas, `branch_id = ?` o'zimiz qo'yamiz.
//   • Faqat O'QISH. Pul yoki tovar harakati qiladigan amal yo'q — ovoz bilan
//     noto'g'ri eshitilgan buyruq kassani buzmasin.
//   • Har vosita modul ruxsatiga bog'liq (perms.utils). Ruxsati yo'q vosita
//     Gemini'ga umuman yuborilmaydi.
const sequelize = require('../db/db-sequelize');
const { requireBranchId } = require('../utils/branchContext');
const { canView } = require('../utils/perms.utils');
const { startOfDay, endOfDay } = require('../utils/dateRange.utils');

const r0 = v => Math.round(Number(v) || 0);
const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
const n  = v => Number(v) || 0;

// Sana → "YYYY-MM-DD" (mahalliy)
function kunKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function vaqt(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v).slice(0, 16);
  return `${kunKey(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function sana(v) {
  if (!v) return null;
  return v instanceof Date ? kunKey(v) : String(v).slice(0, 10);
}

// "bugun", "kecha", "2026-11-19" → Date (kun boshi)
function parseKun(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const d = new Date();
  if (s === 'bugun' || s === 'today') return startOfDay(d);
  if (s === 'kecha' || s === 'yesterday') { d.setDate(d.getDate() - 1); return startOfDay(d); }
  return startOfDay(s);
}

// {from,to} → [boshi, oxiri]. Ikkisi ham bo'sh → bugun.
function oraliq(args = {}) {
  let b = parseKun(args.from) || parseKun(args.sana) || startOfDay(new Date());
  let e = args.to ? endOfDay(parseKun(args.to)) : (args.from || args.sana ? endOfDay(b) : endOfDay(new Date()));
  if (e < b) [b, e] = [startOfDay(e), endOfDay(b)];
  // 1 yildan uzun oraliq — cheklaymiz
  if ((e - b) > 370 * 86400000) b = startOfDay(new Date(e.getTime() - 370 * 86400000));
  return [b, e];
}

const q = (sql, repl) => sequelize.query(sql, { replacements: repl }).then(([rows]) => rows);
const q1 = (sql, repl) => q(sql, repl).then(rows => rows[0] || {});

const SAHIFALAR = {
  bosh_sahifa:      { path: '/dashboard',        module: 'dashboard', label: 'Bosh sahifa' },
  sotuv:            { path: '/sales',            module: 'sales',     label: 'Sotuv' },
  tovarlar:         { path: '/products',         module: 'products',  label: 'Mahsulotlar' },
  kirim:            { path: '/purchases',        module: 'purchases', label: 'Kirim' },
  partiyalar:       { path: '/partiya',          module: 'partiya',   label: 'Partiyalar' },
  mijozlar:         { path: '/partners',         module: 'partners',  label: 'Mijozlar' },
  qarzdorlar:       { path: '/debtors',          module: 'partners',  label: 'Qarzdorlar' },
  kassa:            { path: '/payments',         module: 'payments',  label: 'Kassa' },
  qaytarishlar:     { path: '/returns',          module: 'returns',   label: 'Qaytarishlar' },
  hisobotlar:       { path: '/reports',          module: 'reports',   label: 'Hisobotlar' },
  yetkazuvchilar:   { path: '/suppliers',        module: 'suppliers', label: 'Yetkazuvchilar' },
  inventarizatsiya: { path: '/inventarizatsiya', module: 'products',  label: 'Inventarizatsiya' },
  foydalanuvchilar: { path: '/users',            module: 'users',     label: 'Foydalanuvchilar' },
  sozlamalar:       { path: '/settings',         module: 'settings',  label: 'Sozlamalar' },
  filiallar:        { path: '/branches',         admin: true,         label: 'Filiallar' },
};

// ── Vositalar ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'savdo_hisoboti',
    modules: ['dashboard', 'reports'],
    description: "Savdo hisoboti: sotuvlar soni, tushum (chegirmadan keyin), to'langan, qarzga berilgan, chegirma, to'lov turlari, qaytarishlar, qarz to'lovlari. Ruxsat bo'lsa foyda va marja. Oraliq berilmasa — bugun. Bir kundan uzun oraliqda kunlik taqsimot ham qaytadi. Oldingi shunday davr bilan solishtirish ham bor.",
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: "Boshlanish kuni: YYYY-MM-DD, 'bugun' yoki 'kecha'" },
        to:   { type: 'string', description: 'Tugash kuni: YYYY-MM-DD (ixtiyoriy)' },
      },
    },
    async run(args, ctx) {
      const bid = requireBranchId();
      const [b, e] = oraliq(args);
      const k = await q1(`SELECT COUNT(*) sotuvlar, SUM(total_sum - COALESCE(discount,0)) tushum, SUM(paid_sum) tolangan,
                                 SUM(debt_sum) qarz, SUM(discount) chegirma, SUM(item_count) tovarlar
                            FROM kassa_register WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?`, [bid, b, e]);
      const turlar = await q(`SELECT payment_type tur, COUNT(*) soni, SUM(paid_sum) summa FROM kassa_register
                               WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ? GROUP BY payment_type`, [bid, b, e]);
      const tx = await q(`SELECT type, COUNT(*) soni, SUM(amount) summa FROM cash_transaction
                           WHERE branch_id=? AND type IN ('refund','debt_payment','income','expense') AND date BETWEEN ? AND ? GROUP BY type`, [bid, b, e]);
      const txm = Object.fromEntries(tx.map(t => [t.type, { soni: n(t.soni), summa: r0(t.summa) }]));

      // Oldingi shunday uzunlikdagi davr
      const uzunlik = e - b + 1;
      const pb = new Date(b.getTime() - uzunlik), pe = new Date(b.getTime() - 1);
      const old = await q1(`SELECT COUNT(*) sotuvlar, SUM(total_sum - COALESCE(discount,0)) tushum FROM kassa_register
                             WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?`, [bid, pb, pe]);
      const tushum = r0(k.tushum), oldTushum = r0(old.tushum);

      const out = {
        davr: { from: kunKey(b), to: kunKey(e) },
        sotuvlar: n(k.sotuvlar), tushum, tolangan: r0(k.tolangan), qarzga_berilgan: r0(k.qarz),
        chegirma: r0(k.chegirma), sotilgan_tovar_soni: r0(k.tovarlar),
        tolov_turlari: turlar.map(t => ({ tur: t.tur || 'Naqd', soni: n(t.soni), summa: r0(t.summa) })),
        qaytarishlar: txm.refund || { soni: 0, summa: 0 },
        qarz_tolovlari: txm.debt_payment || { soni: 0, summa: 0 },
        boshqa_kirim: txm.income || { soni: 0, summa: 0 },
        xarajat: txm.expense || { soni: 0, summa: 0 },
        oldingi_davr: { from: kunKey(pb), to: kunKey(pe), sotuvlar: n(old.sotuvlar), tushum: oldTushum,
                        ozgarish_foiz: oldTushum > 0 ? r1((tushum - oldTushum) / oldTushum * 100) : null },
      };
      if (canView(ctx.user, 'reports')) {
        const p = await q1(`SELECT SUM(total_sum) savdo, SUM(cost_price*qty) tannarx FROM product_register
                             WHERE branch_id=? AND status='active' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?`, [bid, b, e]);
        const savdo = r0(p.savdo), tannarx = r0(p.tannarx);
        out.foyda = { yalpi_foyda: savdo - tannarx, tannarx, marja_foiz: savdo > 0 ? r1((savdo - tannarx) / savdo * 100) : 0,
                      izoh: "Yalpi foyda = sotuv − FIFO tannarx (xarajatlar ayrilmagan)" };
      }
      if (e - b > 86400000 * 1.5) {
        out.kunlik = (await q(`SELECT DATE(date) kun, COUNT(*) sotuvlar, SUM(total_sum - COALESCE(discount,0)) tushum FROM kassa_register
                                WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ? GROUP BY DATE(date) ORDER BY kun LIMIT 62`, [bid, b, e]))
          .map(r => ({ kun: sana(r.kun), sotuvlar: n(r.sotuvlar), tushum: r0(r.tushum) }));
      }
      return out;
    },
  },

  {
    name: 'kassa_holati',
    modules: ['payments'],
    description: "Kassa holati bir kun uchun: to'lov turlari (Naqd/Karta/O'tkazma) bo'yicha sotuv tushumi, qarz to'lovlari, boshqa kirim, xarajat, qaytarishlar va naqd pul qoldig'i (ochilish qoldig'i bilan).",
    parameters: { type: 'object', properties: { sana: { type: 'string', description: "YYYY-MM-DD, 'bugun' yoki 'kecha'. Bo'sh — bugun" } } },
    async run(args) {
      const bid = requireBranchId();
      const [b, e] = oraliq({ from: args.sana || 'bugun' });
      const rows = await q(`SELECT type, COALESCE(payment_type,'Naqd') tur, COUNT(*) soni, SUM(amount) summa FROM cash_transaction
                             WHERE branch_id=? AND date BETWEEN ? AND ? GROUP BY type, payment_type`, [bid, b, e]);
      const by = {};
      for (const r of rows) {
        by[r.type] = by[r.type] || {};
        by[r.type][r.tur] = { soni: n(r.soni), summa: r0(r.summa) };
      }
      const sum = (type, tur) => Object.entries(by[type] || {}).filter(([t]) => !tur || t === tur).reduce((s, [, v]) => s + v.summa, 0);
      const naqd = sum('opening') + sum('sale', 'Naqd') + sum('debt_payment', 'Naqd') + sum('income', 'Naqd') - sum('expense', 'Naqd') - sum('refund', 'Naqd');
      return {
        sana: kunKey(b),
        ochilish_qoldigi: sum('opening'),
        sotuv_tushumi: by.sale || {}, qarz_tolovlari: by.debt_payment || {},
        boshqa_kirim: by.income || {}, xarajat: by.expense || {}, qaytarishlar: by.refund || {},
        jami: { sotuv: sum('sale'), qarz_tolovi: sum('debt_payment'), kirim: sum('income'), xarajat: sum('expense'), qaytarish: sum('refund') },
        naqd_qoldiq_hisoblangan: naqd,
        izoh: "Naqd qoldiq = ochilish + naqd sotuv + naqd qarz to'lovi + naqd kirim − naqd xarajat − naqd qaytarish",
      };
    },
  },

  {
    name: 'qarzdorlar',
    modules: ['partners'],
    description: "Qarzdor mijozlar ro'yxati: ism, telefon, qolgan qarz, to'lov muddati, kechikkan kunlar. filtr: 'hammasi' | 'bugun' (bugun to'lashi kerak va kechikkanlar) | 'kechikkan'.",
    parameters: {
      type: 'object',
      properties: {
        filtr: { type: 'string', enum: ['hammasi', 'bugun', 'kechikkan'] },
        limit: { type: 'integer', description: 'Maksimal satr (standart 20)' },
      },
    },
    async run(args) {
      const bid = requireBranchId();
      const bugun = kunKey();
      const filtr = args.filtr || 'hammasi';
      const limit = Math.min(Math.max(n(args.limit) || 20, 1), 60);
      const shart = filtr === 'bugun' ? 'AND s.due_date IS NOT NULL AND s.due_date <= ?'
                  : filtr === 'kechikkan' ? 'AND s.due_date IS NOT NULL AND s.due_date < ?' : '';
      const repl = [bid]; if (shart) repl.push(bugun);
      const rows = await q(`SELECT c.id, c.name, c.phone, SUM(s.debt_sum - s.debt_paid) qarz, MIN(s.due_date) muddat,
                                   MAX(s.date) oxirgi_xarid, COUNT(*) hujjatlar
                              FROM sale s JOIN client c ON c.id = s.client_id
                             WHERE s.branch_id=? AND (s.debt_sum - s.debt_paid) > 0.005 AND s.status <> 'cancelled' ${shart}
                             GROUP BY s.client_id ORDER BY (MIN(s.due_date) IS NULL), MIN(s.due_date) ASC, qarz DESC LIMIT ${limit}`, repl);
      const jami = await q1(`SELECT COUNT(DISTINCT client_id) mijozlar, SUM(debt_sum - debt_paid) summa FROM sale
                              WHERE branch_id=? AND (debt_sum - debt_paid) > 0.005 AND status <> 'cancelled'`, [bid]);
      return {
        filtr, bugun,
        jami: { mijozlar: n(jami.mijozlar), summa: r0(jami.summa) },
        royxat: rows.map(r => {
          const m = sana(r.muddat);
          const kech = m && m < bugun ? Math.round((new Date(bugun) - new Date(m)) / 86400000) : 0;
          return { mijoz_id: r.id, ism: r.name, telefon: r.phone, qarz: r0(r.qarz), muddat: m, kechikkan_kun: kech,
                   oxirgi_xarid: vaqt(r.oxirgi_xarid), hujjatlar: n(r.hujjatlar) };
        }),
      };
    },
  },

  {
    name: 'mijoz_qidir',
    modules: ['partners', 'sales'],
    description: "Mijozni ism, telefon yoki kod bo'yicha qidirish. Balans (qarz/kredit), ochiq qarz hujjatlari, xaridlar tarixi (soni, summasi, oxirgisi).",
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Ism, telefon yoki kod qismi (2+ belgi)' } }, required: ['q'] },
    async run(args) {
      const bid = requireBranchId();
      const s = String(args.q || '').trim();
      if (s.length < 2) return { xato: "Qidiruv uchun kamida 2 belgi kerak" };
      const like = `%${s}%`;
      const rows = await q(`SELECT id, code, name, phone, balance FROM client
                             WHERE branch_id=? AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) ORDER BY name LIMIT 8`, [bid, like, like, like]);
      const out = [];
      for (const c of rows) {
        const st = await q1(`SELECT COUNT(*) soni, SUM(total_sum - COALESCE(discount,0)) summa, MAX(date) oxirgi FROM kassa_register
                              WHERE branch_id=? AND client_id=? AND status='completed' AND sale_id IS NOT NULL`, [bid, c.id]);
        const qarzlar = await q(`SELECT doc_number, date, due_date, (debt_sum - debt_paid) qolgan FROM sale
                                  WHERE branch_id=? AND client_id=? AND (debt_sum - debt_paid) > 0.005 AND status <> 'cancelled' ORDER BY date LIMIT 10`, [bid, c.id]);
        const bal = n(c.balance);
        out.push({
          mijoz_id: c.id, kod: c.code, ism: c.name, telefon: c.phone,
          qarz: bal < 0 ? r0(-bal) : 0, kredit: bal > 0 ? r0(bal) : 0,
          xaridlar: { soni: n(st.soni), summa: r0(st.summa), oxirgi: vaqt(st.oxirgi) },
          ochiq_qarzlar: qarzlar.map(d => ({ chek: d.doc_number, sana: sana(d.date), muddat: sana(d.due_date), qolgan: r0(d.qolgan) })),
        });
      }
      return { topildi: out.length, mijozlar: out };
    },
  },

  {
    name: 'tovar_qidir',
    modules: ['products', 'sales'],
    description: "Tovarni nomi, shtrix-kodi, kodi yoki kategoriyasi bo'yicha qidirish: qoldiq, o'lchov, minimal qoldiq, chakana/ulgurji narx, oxirgi 30 kunda sotilgan miqdor.",
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Nom/shtrix-kod/kod/kategoriya qismi (2+ belgi)' }, limit: { type: 'integer' } }, required: ['q'] },
    async run(args) {
      const bid = requireBranchId();
      const s = String(args.q || '').trim();
      if (s.length < 2) return { xato: "Qidiruv uchun kamida 2 belgi kerak" };
      const like = `%${s}%`;
      const limit = Math.min(Math.max(n(args.limit) || 8, 1), 25);
      const rows = await q(`SELECT id, code, name, unit, category, qty, min_qty, retail_price, wholesale_price, active FROM product
                             WHERE branch_id=? AND is_folder=0 AND (name LIKE ? OR barcodes LIKE ? OR code LIKE ? OR category LIKE ?)
                             ORDER BY (name LIKE ?) DESC, name LIMIT ${limit}`, [bid, like, like, like, like, `${s}%`]);
      const b = new Date(Date.now() - 30 * 86400000);
      const out = [];
      for (const p of rows) {
        const st = await q1(`SELECT SUM(qty) dona, SUM(total_sum) summa FROM product_register
                              WHERE branch_id=? AND product_id=? AND status='active' AND sale_id IS NOT NULL AND date >= ?`, [bid, p.id, b]);
        out.push({ tovar_id: p.id, kod: p.code, nom: p.name, kategoriya: p.category, olchov: p.unit,
                   qoldiq: Number(p.qty) || 0, min_qoldiq: Number(p.min_qty) || 0,
                   chakana_narx: r0(p.retail_price), ulgurji_narx: r0(p.wholesale_price), faol: !!p.active,
                   oxirgi_30_kun: { sotilgan: Number(st.dona) || 0, summa: r0(st.summa) } });
      }
      return { topildi: out.length, tovarlar: out };
    },
  },

  {
    name: 'kam_qolgan_tovarlar',
    modules: ['products', 'purchases'],
    description: "Qoldig'i minimal darajaga tushgan yoki tugagan tovarlar (buyurtma berish kerak). Minimal qoldiq belgilanmagan tovarlardan faqat tugaganlari (qoldiq ≤ 0) ko'rsatiladi.",
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Standart 20' } } },
    async run(args) {
      const bid = requireBranchId();
      const limit = Math.min(Math.max(n(args.limit) || 20, 1), 60);
      const rows = await q(`SELECT id, name, unit, qty, min_qty, category FROM product
                             WHERE branch_id=? AND active=1 AND is_folder=0 AND ((min_qty > 0 AND qty <= min_qty) OR qty <= 0)
                             ORDER BY (qty <= 0) DESC, (qty / NULLIF(min_qty,0)) ASC, name LIMIT ${limit}`, [bid]);
      const jami = await q1(`SELECT SUM(min_qty > 0 AND qty <= min_qty) kam, SUM(qty <= 0) tugagan FROM product
                              WHERE branch_id=? AND active=1 AND is_folder=0`, [bid]);
      return {
        jami: { kam_qolgan: n(jami.kam), tugagan: n(jami.tugagan) },
        royxat: rows.map(p => ({ tovar_id: p.id, nom: p.name, kategoriya: p.category, olchov: p.unit,
                                 qoldiq: Number(p.qty) || 0, min_qoldiq: Number(p.min_qty) || 0,
                                 holat: Number(p.qty) <= 0 ? 'tugagan' : 'kam' })),
      };
    },
  },

  {
    name: 'top_tovarlar',
    modules: ['reports', 'dashboard'],
    description: "Eng ko'p sotilgan tovarlar: savdo summasi, dona va foyda bo'yicha. Oraliq berilmasa — bugun. mezon: 'savdo' | 'dona' | 'foyda'.",
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string' }, to: { type: 'string' },
        mezon: { type: 'string', enum: ['savdo', 'dona', 'foyda'] },
        limit: { type: 'integer', description: 'Standart 10' },
      },
    },
    async run(args, ctx) {
      const bid = requireBranchId();
      const [b, e] = oraliq(args);
      const limit = Math.min(Math.max(n(args.limit) || 10, 1), 30);
      const foyda = canView(ctx.user, 'reports');
      const order = args.mezon === 'dona' ? 'dona' : (args.mezon === 'foyda' && foyda) ? 'foyda' : 'savdo';
      const rows = await q(`SELECT product_name nom, SUM(qty) dona, SUM(total_sum) savdo, SUM(total_sum - cost_price*qty) foyda FROM product_register
                             WHERE branch_id=? AND status='active' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?
                             GROUP BY product_name ORDER BY ${order} DESC LIMIT ${limit}`, [bid, b, e]);
      return { davr: { from: kunKey(b), to: kunKey(e) }, mezon: order,
               tovarlar: rows.map(r => ({ nom: r.nom, dona: Number(r.dona) || 0, savdo: r0(r.savdo), ...(foyda ? { foyda: r0(r.foyda) } : {}) })) };
    },
  },

  {
    name: 'kassirlar_hisoboti',
    modules: ['reports', 'users'],
    description: "Kassirlar (xodimlar) bo'yicha sotuvlar soni, tushum va chegirma. Oraliq berilmasa — bugun.",
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    async run(args) {
      const bid = requireBranchId();
      const [b, e] = oraliq(args);
      const rows = await q(`SELECT COALESCE(cashier_name,'Noma''lum') kassir, COUNT(*) sotuvlar, SUM(total_sum - COALESCE(discount,0)) tushum,
                                   SUM(discount) chegirma, SUM(debt_sum) qarzga FROM kassa_register
                             WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?
                             GROUP BY cashier_name ORDER BY tushum DESC`, [bid, b, e]);
      return { davr: { from: kunKey(b), to: kunKey(e) },
               kassirlar: rows.map(r => ({ kassir: r.kassir, sotuvlar: n(r.sotuvlar), tushum: r0(r.tushum), chegirma: r0(r.chegirma), qarzga: r0(r.qarzga) })) };
    },
  },

  {
    name: 'oxirgi_sotuvlar',
    modules: ['sales', 'reports'],
    description: "Oxirgi sotuvlar (cheklar) ro'yxati: chek raqami, vaqt, mijoz, summa, to'lov turi, kassir, holat. Mijoz nomi yoki sana bo'yicha filtrlash mumkin.",
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Standart 10, maks 30' },
        mijoz: { type: 'string', description: 'Mijoz ismi qismi (ixtiyoriy)' },
        sana:  { type: 'string', description: "Faqat shu kun: YYYY-MM-DD / 'bugun' / 'kecha' (ixtiyoriy)" },
      },
    },
    async run(args) {
      const bid = requireBranchId();
      const limit = Math.min(Math.max(n(args.limit) || 10, 1), 30);
      const repl = [bid]; let shart = '';
      if (args.mijoz) { shart += ' AND client_name LIKE ?'; repl.push(`%${String(args.mijoz).trim()}%`); }
      if (args.sana)  { const [b, e] = oraliq({ sana: args.sana }); shart += ' AND date BETWEEN ? AND ?'; repl.push(b, e); }
      const rows = await q(`SELECT doc_number, date, client_name, (total_sum - COALESCE(discount,0)) summa, paid_sum, debt_sum, payment_type, cashier_name, status, item_count
                              FROM kassa_register WHERE branch_id=? AND sale_id IS NOT NULL ${shart} ORDER BY date DESC, id DESC LIMIT ${limit}`, repl);
      return { soni: rows.length, sotuvlar: rows.map(r => ({ chek: r.doc_number, vaqt: vaqt(r.date), mijoz: r.client_name || null, summa: r0(r.summa),
                                                              tolangan: r0(r.paid_sum), qarzga: r0(r.debt_sum), tolov_turi: r.payment_type, kassir: r.cashier_name,
                                                              tovarlar: n(r.item_count), holat: r.status === 'cancelled' ? 'bekor qilingan' : 'yakunlangan' })) };
    },
  },

  {
    name: 'sotuv_tafsiloti',
    modules: ['sales', 'reports'],
    description: "Bitta chek (sotuv) tafsiloti chek raqami bo'yicha: tovarlar, miqdor, narx, qaytarilgan, to'lov, qarz va mijoz.",
    parameters: { type: 'object', properties: { chek: { type: 'integer', description: 'Chek (hujjat) raqami' } }, required: ['chek'] },
    async run(args) {
      const bid = requireBranchId();
      const doc = n(args.chek);
      const s = await q1(`SELECT s.id, s.doc_number, s.date, s.payment_type, s.total_sum, s.discount, s.paid_sum, s.debt_sum, s.debt_paid, s.status, s.due_date, s.returned_sum,
                                 c.name mijoz, c.phone telefon, u.fullname kassir
                            FROM sale s LEFT JOIN client c ON c.id = s.client_id LEFT JOIN user u ON u.id = s.cashier_id
                           WHERE s.branch_id=? AND s.doc_number=? ORDER BY (s.status='completed') DESC, s.id DESC LIMIT 1`, [bid, doc]);
      if (!s.id) return { xato: `${doc}-chek topilmadi` };
      const items = await q(`SELECT product_name, qty, returned_qty, price, total_sum FROM sale_item WHERE sale_id=? ORDER BY id`, [s.id]);
      return {
        chek: s.doc_number, vaqt: vaqt(s.date), holat: s.status === 'cancelled' ? 'bekor qilingan' : 'yakunlangan',
        mijoz: s.mijoz ? { ism: s.mijoz, telefon: s.telefon } : null, kassir: s.kassir,
        tolov_turi: s.payment_type, jami: r0(s.total_sum), chegirma: r0(s.discount), tolangan: r0(s.paid_sum),
        qarz: r0(s.debt_sum), qarz_tolangan: r0(s.debt_paid), qarz_qolgan: r0(n(s.debt_sum) - n(s.debt_paid)), muddat: sana(s.due_date),
        qaytarilgan_summa: r0(s.returned_sum),
        tovarlar: items.map(i => ({ nom: i.product_name, miqdor: Number(i.qty) || 0, qaytarilgan: Number(i.returned_qty) || 0, narx: r0(i.price), summa: r0(i.total_sum) })),
      };
    },
  },

  {
    name: 'kirimlar',
    modules: ['purchases', 'reports'],
    description: "Kirim (xarid) hujjatlari hisoboti: soni, summasi, to'langan, yetkazuvchiga qarz; yetkazuvchilar bo'yicha taqsimot. Oraliq berilmasa — joriy oy.",
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    async run(args) {
      const bid = requireBranchId();
      let b, e;
      if (args.from || args.to || args.sana) [b, e] = oraliq(args);
      else { const d = new Date(); b = startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)); e = endOfDay(d); }
      const k = await q1(`SELECT COUNT(*) soni, SUM(total_sum) summa, SUM(paid_sum) tolangan FROM purchase
                           WHERE branch_id=? AND status='confirmed' AND date BETWEEN ? AND ?`, [bid, b, e]);
      const sup = await q(`SELECT COALESCE(supplier,'Noma''lum') yetkazuvchi, COUNT(*) soni, SUM(total_sum) summa, SUM(total_sum - paid_sum) qarz FROM purchase
                            WHERE branch_id=? AND status='confirmed' AND date BETWEEN ? AND ? GROUP BY supplier ORDER BY summa DESC LIMIT 12`, [bid, b, e]);
      const qarz = await q1(`SELECT COUNT(*) soni, SUM(total_sum - paid_sum) summa FROM purchase
                              WHERE branch_id=? AND status='confirmed' AND (total_sum - paid_sum) > 0.005`, [bid]);
      return { davr: { from: kunKey(b), to: kunKey(e) }, kirimlar: n(k.soni), summa: r0(k.summa), tolangan: r0(k.tolangan),
               yetkazuvchiga_qarz_umumiy: { hujjatlar: n(qarz.soni), summa: r0(qarz.summa) },
               yetkazuvchilar: sup.map(s => ({ yetkazuvchi: s.yetkazuvchi, hujjatlar: n(s.soni), summa: r0(s.summa), qarz: r0(s.qarz) })) };
    },
  },

  {
    name: 'sahifaga_ot',
    modules: null, // hamma uchun; sahifa ruxsati alohida tekshiriladi
    description: "Foydalanuvchi so'rasa dasturdagi sahifani ochish (masalan 'qarzdorlarni och', 'kassaga o't'). Faqat sahifani ochadi, hech narsa o'zgartirmaydi.",
    parameters: { type: 'object', properties: { sahifa: { type: 'string', enum: Object.keys(SAHIFALAR) } }, required: ['sahifa'] },
    async run(args, ctx) {
      const p = SAHIFALAR[args.sahifa];
      if (!p) return { xato: 'Bunday sahifa yo\'q' };
      const ok = p.admin ? canView(ctx.user) /* faqat admin */ : canView(ctx.user, p.module);
      if (!ok) return { xato: `Foydalanuvchida "${p.label}" sahifasiga ruxsat yo'q` };
      ctx.actions.push({ type: 'navigate', path: p.path, label: p.label });
      return { ok: true, ochildi: p.label, path: p.path };
    },
  },
];

/** Foydalanuvchi ruxsatiga ko'ra vositalar */
function toolsFor(user) {
  return TOOLS.filter(t => !t.modules || canView(user, ...t.modules));
}

/** Gemini uchun deklaratsiyalar */
function declarations(tools) {
  return tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } }));
}

/** Vositani bajarish (xato bo'lsa JSON ko'rinishida qaytaradi, agent to'xtamaydi) */
async function runTool(tools, name, args, ctx) {
  const t = tools.find(x => x.name === name);
  if (!t) return { xato: `Noma'lum vosita: ${name}` };
  try {
    return await t.run(args || {}, ctx);
  } catch (e) {
    console.log(`[AI] vosita xatosi ${name}:`, e.message);
    return { xato: `Vosita bajarilmadi: ${e.message}` };
  }
}

module.exports = { TOOLS, SAHIFALAR, toolsFor, declarations, runTool, kunKey };
