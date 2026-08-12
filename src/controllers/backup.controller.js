const { spawn } = require('child_process');
const HttpException = require('../utils/HttpException.utils');
const config = require('../startup/config');
const sequelize = require('../db/db-sequelize');

// mysqldump berilgan bayroqni qo'llab-quvvatlaydimi.
//
// `--help` chiqishida bayroq nomi bor-yo'qligiga qaraymiz: MariaDB va eski
// MySQL da `--set-gtid-purged` yo'q va noma'lum bayroq bilan mysqldump
// umuman ishga tushmaydi. Natija keshlanadi — har yuklashda tekshirilmasin.
const flagCache = new Map();
function supportsFlag(bin, flag) {
  const name = flag.split('=')[0];
  const key  = `${bin} ${name}`;
  if (flagCache.has(key)) return Promise.resolve(flagCache.get(key));

  return new Promise((resolve) => {
    let out = '', done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      flagCache.set(key, v);
      resolve(v);
    };
    try {
      const c = spawn(bin, ['--help']);
      c.stdout.on('data', d => { out += d.toString(); });
      c.on('error', () => finish(false));
      c.on('close', () => finish(out.includes(name)));
      setTimeout(() => { try { c.kill(); } catch {} finish(false); }, 5000);
    } catch { finish(false); }
  });
}

// Bazani to'liq nusxasini (.sql) yuklab beradi.
//
// Nusxa `mysqldump` orqali olinadi va to'g'ridan-to'g'ri javobga oqim
// (stream) qilib yuboriladi — diskda vaqtinchalik fayl yaratilmaydi.
// Shunda bir necha yuz megabaytlik baza ham serverning joyini band
// qilmaydi va yarim yozilgan fayl qolib ketmaydi.
class BackupController {

  // GET /api/v1/backup/download
  download = async (req, res) => {
    const bin = process.env.MYSQLDUMP_PATH || 'mysqldump';

    const stamp = new Date().toISOString()
      .replace(/[:T]/g, '-')
      .replace(/\..+$/, '');
    const fileName = `${config.db_name}-zaxira-${stamp}.sql`;

    const args = [
      '-h', String(config.host),
      '-P', String(config.db_port || 3306),
      '-u', String(config.db_user),
      // --single-transaction: InnoDB jadvallarni qulflamasdan, bitta
      // izchil (consistent) holatda oladi — nusxa olayotganda kassa
      // ishlashda davom etaveradi va nusxa "yarim" holatda chiqmaydi.
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--default-character-set=utf8mb4',
      // Tiklashda jadval mavjud bo'lsa xato bermasin
      '--add-drop-table',
      config.db_name,
    ];

    // GTID yoqilgan serverlarda mysqldump faylga
    // `SET @@GLOBAL.GTID_PURGED=...` qatorini qo'shadi. Shu fayl boshqa
    // (yoki o'sha) serverga tiklanganda MySQL xato beradi:
    //   "@@GLOBAL.GTID_PURGED cannot be changed"
    // va tiklash birinchi jadvalgacha ham yetmay to'xtaydi. Bizga nusxa
    // replikatsiya uchun emas, tiklash uchun kerak — shuning uchun
    // o'chiramiz. Eski MySQL/MariaDB bu bayroqni bilmaydi, shuning uchun
    // qo'llab-quvvatlanishini oldindan tekshiramiz.
    if (await supportsFlag(bin, '--set-gtid-purged=OFF')) {
      args.splice(args.length - 1, 0, '--set-gtid-purged=OFF');
    }

    // Parol argument sifatida berilsa, serverdagi boshqa jarayonlar uni
    // `ps` da ko'ra oladi. Shuning uchun muhit o'zgaruvchisi orqali beramiz.
    const env = { ...process.env };
    if (config.db_pass) env.MYSQL_PWD = String(config.db_pass);

    let child;
    try {
      child = spawn(bin, args, { env });
    } catch (e) {
      throw new HttpException(500, `mysqldump ishga tushmadi: ${e.message}`);
    }

    // Sarlavhalarni faqat birinchi baytdan keyin yozamiz: mysqldump
    // darhol yiqilsa (masalan bin topilmasa), foydalanuvchi buzuq fayl
    // o'rniga tushunarli xato oladi.
    let headersSent = false;
    let stderr = '';

    const sendHeaders = () => {
      if (headersSent) return;
      headersSent = true;
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      // Brauzer oqimni keshlamasin
      res.setHeader('Cache-Control', 'no-store');
    };

    child.stdout.on('data', (chunk) => {
      sendHeaders();
      // Oqim to'lib ketsa, mysqldump ni kutishga majburlaymiz
      if (!res.write(chunk)) {
        child.stdout.pause();
        res.once('drain', () => child.stdout.resume());
      }
    });

    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', (e) => {
      if (!headersSent) {
        res.status(500).json({
          message: `mysqldump topilmadi yoki ishga tushmadi: ${e.message}. ` +
                   `Serverda "mysql-client" o'rnatilganini tekshiring.`,
        });
      } else {
        res.destroy(e);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        sendHeaders();     // bo'sh baza bo'lsa ham fayl qaytsin
        return res.end();
      }
      if (!headersSent) {
        return res.status(500).json({
          message: `Zaxira nusxa olishda xatolik (kod ${code}): ` +
                   (stderr.trim() || 'noma\'lum xato'),
        });
      }
      // Sarlavha ketib bo'lgan — ulanishni uzamiz, shunda brauzer
      // faylni to'liq deb qabul qilmaydi
      res.destroy(new Error(stderr || `mysqldump kodi ${code}`));
    });

    // Foydalanuvchi yuklashni to'xtatsa, mysqldump ham to'xtasin
    res.on('close', () => {
      if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
    });
  };

  // GET /api/v1/backup/info — tugmani ko'rsatishdan oldin holatni bilish
  info = async (req, res) => {
    const bin = process.env.MYSQLDUMP_PATH || 'mysqldump';

    // mysqldump mavjudmi
    const available = await new Promise((resolve) => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      try {
        const c = spawn(bin, ['--version']);
        c.on('error', () => finish(false));
        c.on('close', code => finish(code === 0));
        setTimeout(() => { try { c.kill(); } catch {} finish(false); }, 5000);
      } catch { finish(false); }
    });

    // Baza hajmi (taxminiy)
    let sizeMb = null;
    try {
      const [[row]] = await sequelize.query(
        'SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb ' +
        'FROM information_schema.TABLES WHERE table_schema = ?',
        { replacements: [config.db_name] }
      );
      sizeMb = row?.mb != null ? Number(row.mb) : null;
    } catch { /* ixtiyoriy */ }

    res.json({ available, database: config.db_name, sizeMb });
  };
}

module.exports = new BackupController();
