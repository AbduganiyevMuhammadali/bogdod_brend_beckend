// AI yordamchi ("Sellz AI") — Gemini bilan ishlaydigan ovozli agent.
//
// Oqim:
//   frontend (AiAgent.vue) → POST /api/v1/ai/chat {text | audio, history}
//   → Gemini Interactions API (function calling) → vositalar (aiTools.js)
//   bazadan JORIY FILIAL ma'lumotini oladi → Gemini yakuniy javob yozadi
//   → ixtiyoriy TTS (ovoz) → frontend ko'rsatadi va o'qib beradi.
//
// Barcha so'rovlar `auth()` dan o'tadi: filial konteksti va foydalanuvchi
// ruxsatlari oddiy sahifalardagidek amal qiladi.
const HttpException = require('../utils/HttpException.utils');
const gemini        = require('../services/gemini.service');
const tools         = require('../services/aiTools');
const { isAdmin, canView } = require('../utils/perms.utils');
const sequelize     = require('../db/db-sequelize');
const { requireBranchId } = require('../utils/branchContext');

const ROLLAR = ['Dasturchi', 'Admin', 'Programmer'];

// Tanlash uchun modellar (Sozlamalar ro'yxati). Boshqasini qo'lda yozish ham mumkin.
const MODELS = [
  { id: 'gemini-4-hydrogen',    label: 'Gemini 4 Hydrogen — tez, agentlik uchun (tavsiya)' },
  { id: 'gemini-3.8-flash',     label: 'Gemini 3.8 Flash — barqaror' },
  { id: 'gemini-3.6-flash',     label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite',label: 'Gemini 3.5 Flash-Lite — eng tez va arzon' },
];
const TTS_MODELS = [
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS — o\'zbekcha, arzon (tavsiya)' },
  { id: 'gemini-3.8-flash-tts',      label: 'Gemini 3.8 Flash TTS — sifatliroq' },
  { id: 'browser',                   label: 'Brauzer ovozi (Gemini\'siz, o\'zbek tili cheklangan)' },
];
const VOICES = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus',
  'Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux',
  'Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'];
const THINKING = ['minimal', 'low', 'medium', 'high'];

// Ovozli xabar uchun qabul qilinadigan formatlar (Gemini qo'llaydi)
const AUDIO_MIMES = {
  'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav',
  'audio/webm': 'audio/webm', 'audio/ogg': 'audio/ogg', 'audio/opus': 'audio/opus',
  'audio/mp3': 'audio/mp3', 'audio/mpeg': 'audio/mpeg', 'audio/mp4': 'audio/m4a', 'audio/m4a': 'audio/m4a',
  'audio/aac': 'audio/aac', 'audio/flac': 'audio/flac',
};
const MAX_AUDIO_B64 = 8 * 1024 * 1024;

// Oddiy chegara: bir foydalanuvchi daqiqada ko'pi bilan 20 so'rov (xarajat himoyasi)
const limiter = new Map();
function checkLimit(userId) {
  const now = Date.now();
  const w = limiter.get(userId) || [];
  const fresh = w.filter(t => now - t < 60000);
  if (fresh.length >= 20) throw new HttpException(429, 'Juda ko\'p so\'rov. Bir daqiqadan keyin urinib ko\'ring');
  fresh.push(now); limiter.set(userId, fresh);
}

// ── Matn yordamchilari ───────────────────────────────────────────────────

/** 3450000 → "3 mln 450 ming so'm" (ovoz uchun qulay) */
function pulSoz(v) {
  const x = Math.round(Math.abs(Number(v) || 0));
  if (x === 0) return '0 so\'m';
  const mlrd = Math.floor(x / 1e9), mln = Math.floor((x % 1e9) / 1e6), ming = Math.floor((x % 1e6) / 1e3), q = x % 1000;
  const p = [];
  if (mlrd) p.push(`${mlrd} mlrd`);
  if (mln)  p.push(`${mln} mln`);
  if (ming && !mlrd) p.push(`${ming} ming`);
  if (q && !mln && !mlrd) p.push(String(q));
  return `${(Number(v) < 0 ? 'minus ' : '')}${p.join(' ')} so'm`;
}

const HAFTA = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const OYLAR = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function hozir() {
  const d = new Date();
  return {
    iso: tools.kunKey(d),
    soat: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    matn: `${d.getDate()}-${OYLAR[d.getMonth()]} ${d.getFullYear()}, ${HAFTA[d.getDay()]}`,
    h: d.getHours(),
  };
}
function salom(h) {
  if (h < 5)  return 'Xayrli tun';
  if (h < 11) return 'Xayrli tong';
  if (h < 17) return 'Xayrli kun';
  return 'Xayrli kech';
}
function ismi(user) {
  return (user?.fullname || user?.username || '').trim().split(/\s+/)[0] || '';
}

function systemInstruction(req, userTools) {
  const u = req.currentUser;
  const t = hozir();
  const rol = isAdmin(u) ? 'rahbar (administrator)' : 'xodim';
  const vositalar = userTools.map(x => x.name).join(', ');
  return [
    `Sen "Sellz AI" — "${req.branch?.name || 'do\'kon'}" do'konining POS (savdo) dasturidagi aqlli yordamchisan.`,
    `Foydalanuvchi: ${u.fullname || u.username} (${rol}). Hozir: ${t.matn}, soat ${t.soat}. Bugungi sana: ${t.iso}. Filial: ${req.branch?.name || '—'}.`,
    '',
    'QOIDALAR:',
    "1. Faqat o'zbek tilida, lotin yozuvida javob ber. Javob qisqa va aniq bo'lsin — u ovoz bilan o'qib beriladi: odatda 1–4 gap. Markdown jadval, sarlavha, yulduzcha ishlatma; ro'yxat kerak bo'lsa har bandni yangi qatordan \"- \" bilan yoz.",
    '2. Raqam, summa, qarz, qoldiq kabi HAR QANDAY ma\'lumotni faqat vositalar (funksiyalar) orqali ol. O\'zingdan to\'qima. Vosita xato qaytarsa yoki ma\'lumot bo\'lmasa — shuni ayt.',
    `3. Senga ruxsat berilgan vositalar: ${vositalar}. Boshqa ma'lumot so'ralsa, ruxsat yo'qligini xushmuomala ayt.`,
    "4. Pul birligi so'm. Katta summalarni og'zaki qulay ayt: 3 450 000 → \"3 mln 450 ming so'm\". Foizlarni bir xonagacha yaxlitla.",
    "5. Sana oraliqlarini vositaga YYYY-MM-DD ko'rinishida ber. \"bu hafta\" = joriy haftaning dushanbasidan bugungacha; \"o'tgan hafta\" = o'tgan dushanba–yakshanba; \"bu oy\" = oyning 1-sanasidan bugungacha; \"o'tgan oy\" = o'tgan oyning 1-sanasidan oxirigacha; \"kecha\" = kecha.",
    '6. Foydalanuvchi sahifa ochishni so\'rasa (masalan "qarzdorlarni och") `sahifaga_ot` vositasini chaqir va qisqa tasdiqla.',
    "7. Sen dasturda hech narsani O'ZGARTIRA OLMAYSAN: sotuv, to'lov, kirim yozmaysan, o'chirmaysan. Shunday so'rov kelsa, buni tushuntir va tegishli sahifani ochishni taklif qil.",
    "8. Ovozli xabar (audio) kelsa: javobning BIRINCHI qatorida foydalanuvchi nima deganini aynan shu ko'rinishda yoz: Siz: «...» — keyin yangi qatordan javob ber. Audio tushunarsiz bo'lsa qayta so'ra.",
    "9. Qarzdor haqida eslatma/SMS matni so'ralsa — do'kon nomidan qisqa, hurmatli, aniq summa va muddat bilan yoz.",
    "10. Hisobot so'ralganda eng muhim 2–4 raqamni ayt, keyin qisqa xulosa (yaxshi/yomon tomoni, oldingi davr bilan solishtirish).",
  ].join('\n');
}

function historySteps(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).flatMap(h => {
    const text = String(h?.text || '').trim().slice(0, 2000);
    if (!text) return [];
    return h.role === 'assistant'
      ? [{ type: 'model_output', content: [{ type: 'text', text }] }]
      : [{ type: 'user_input',   content: [{ type: 'text', text }] }];
  });
}

/** Javobning birinchi qatoridan "Siz: «...»" transkripsiyasini ajratish */
function ajratTranskript(text) {
  // Birinchi qator butunligicha olinadi — o'zbekcha matnda apostrof (o', g')
  // ko'p, shuning uchun qo'shtirnoqlar faqat chetlardan kesiladi.
  const m = String(text || '').match(/^\s*Siz\s*:\s*(.+?)\s*(?:\n|$)/i);
  if (!m) return { text, transcript: null };
  const transcript = m[1].replace(/^[«"“'‘\s]+/, '').replace(/[»"”'’\s]+$/, '').trim();
  return { text: text.slice(m[0].length).trim(), transcript };
}

async function ovozlashtir(cfg, text) {
  if (!cfg.ttsModel || cfg.ttsModel === 'browser') return { audio: null };
  try {
    const audio = await gemini.synthesize(text, { apiKey: cfg.apiKey, model: cfg.ttsModel, voice: cfg.voice });
    return { audio };
  } catch (e) {
    console.log('[AI] TTS xatosi:', e.message);
    return { audio: null, ttsError: e.message };
  }
}

class AiController {

  /** GET /api/v1/ai/status — frontend tugmani ko'rsatish-ko'rsatmaslikni hal qiladi */
  status = async (req, res) => {
    const cfg = await gemini.getConfig();
    res.json({
      enabled:    cfg.enabled,
      configured: !!cfg.apiKey,
      model:      cfg.model,
      ttsModel:   cfg.ttsModel,
      voice:      cfg.voice,
      greeting:   cfg.greeting,
      canConfigure: isAdmin(req.currentUser),
      tools:      tools.toolsFor(req.currentUser).map(t => t.name),
    });
  };

  /** GET /api/v1/ai/settings (admin) */
  getSettings = async (req, res) => {
    const cfg = await gemini.getConfig({ fresh: true });
    res.json({
      enabled: cfg.enabled, greeting: cfg.greeting,
      hasKey: !!cfg.apiKey, keyMasked: gemini.maskKey(cfg.apiKey), keyFromEnv: cfg.keyFromEnv,
      model: cfg.model, ttsModel: cfg.ttsModel, voice: cfg.voice, thinking: cfg.thinking,
      models: MODELS, ttsModels: TTS_MODELS, voices: VOICES, thinkingLevels: THINKING,
    });
  };

  /** PUT /api/v1/ai/settings (admin) */
  putSettings = async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.enabled  !== undefined) patch.enabled  = !!b.enabled;
    if (b.greeting !== undefined) patch.greeting = !!b.greeting;
    if (b.model !== undefined) {
      const m = String(b.model || '').trim();
      if (!/^[a-z0-9][a-z0-9.\-]{2,80}$/i.test(m)) throw new HttpException(400, 'Model nomi noto\'g\'ri');
      patch.model = m;
    }
    if (b.ttsModel !== undefined) {
      const m = String(b.ttsModel || '').trim();
      if (m && m !== 'browser' && !/^[a-z0-9][a-z0-9.\-]{2,80}$/i.test(m)) throw new HttpException(400, 'TTS model nomi noto\'g\'ri');
      patch.ttsModel = m || 'browser';
    }
    if (b.voice !== undefined) {
      const v = String(b.voice || '').trim();
      if (!/^[A-Za-z0-9_\-]{2,60}$/.test(v)) throw new HttpException(400, 'Ovoz nomi noto\'g\'ri');
      patch.voice = v;
    }
    if (b.thinking !== undefined) {
      if (!THINKING.includes(b.thinking)) throw new HttpException(400, 'thinking qiymati noto\'g\'ri');
      patch.thinking = b.thinking;
    }
    if (b.apiKey !== undefined) {
      if (b.apiKey === null || b.apiKey === '') { /* o'zgartirilmaydi */ }
      else if (b.apiKey === '__delete__') patch.apiKey = null;
      else {
        const k = String(b.apiKey).trim();
        if (k.includes('•')) { /* yashirilgan ko'rinish qaytib keldi — o'zgartirmaymiz */ }
        else if (k.length < 20 || /\s/.test(k)) throw new HttpException(400, 'API kalit noto\'g\'ri ko\'rinadi');
        else patch.apiKey = k;
      }
    }
    await gemini.saveConfig(patch);
    return this.getSettings(req, res);
  };

  /** POST /api/v1/ai/test (admin) — kalit va modelni tekshirish */
  test = async (req, res) => {
    const cfg = await gemini.getConfig({ fresh: true });
    if (!cfg.apiKey) throw new HttpException(400, 'Avval API kalitini saqlang');
    const t0 = Date.now();
    const data = await gemini.interact({
      model: cfg.model, store: false,
      system_instruction: 'Faqat o\'zbek tilida, bitta qisqa gap bilan javob ber.',
      input: 'Salom! Ishga tayyormisan? Bir gapda javob ber.',
    }, { apiKey: cfg.apiKey, timeoutMs: 30000 });
    const text = gemini.extractText(data?.steps) || '(bo\'sh javob)';
    const out = { ok: true, model: cfg.model, text, ms: Date.now() - t0 };
    if (req.body?.speak !== false) {
      const { audio, ttsError } = await ovozlashtir(cfg, text);
      out.audio = audio; if (ttsError) out.ttsError = ttsError;
    }
    res.json(out);
  };

  /**
   * GET /api/v1/ai/greeting?speak=1
   * Tugma bosilganda aytiladigan qisqa xulosa — LLM'siz, bazadan to'g'ridan-to'g'ri
   * (tez va bepul). speak=1 bo'lsa ovoz ham qaytadi.
   */
  greeting = async (req, res) => {
    const cfg = await gemini.getConfig();
    const u = req.currentUser;
    const bid = requireBranchId();
    const t = hozir();
    const b = new Date(); b.setHours(0, 0, 0, 0);
    const e = new Date(); e.setHours(23, 59, 59, 999);

    const gaplar = [`${salom(t.h)}${ismi(u) ? ', ' + ismi(u) : ''}!`];
    if (canView(u, 'dashboard', 'reports', 'sales')) {
      const [[k]] = await sequelize.query(
        `SELECT COUNT(*) n, SUM(total_sum - COALESCE(discount,0)) s FROM kassa_register
          WHERE branch_id=? AND status='completed' AND sale_id IS NOT NULL AND date BETWEEN ? AND ?`, { replacements: [bid, b, e] });
      const n = Number(k?.n) || 0;
      gaplar.push(n ? `Bugun ${n} ta savdo, tushum ${pulSoz(k.s)}.` : 'Bugun hali savdo bo\'lmadi.');
    }
    if (canView(u, 'partners')) {
      const [[d]] = await sequelize.query(
        `SELECT SUM(due_date <= ?) n, SUM(CASE WHEN due_date <= ? THEN debt_sum - debt_paid ELSE 0 END) s FROM sale
          WHERE branch_id=? AND (debt_sum - debt_paid) > 0.005 AND status <> 'cancelled' AND due_date IS NOT NULL`,
        { replacements: [t.iso, t.iso, bid] });
      if (Number(d?.n) > 0) gaplar.push(`${Number(d.n)} ta mijozning qarz muddati kelgan, jami ${pulSoz(d.s)}.`);
    }
    if (canView(u, 'products', 'purchases')) {
      const [[p]] = await sequelize.query(
        `SELECT SUM(min_qty > 0 AND qty <= min_qty) kam, SUM(qty <= 0) tugagan FROM product WHERE branch_id=? AND active=1 AND is_folder=0`,
        { replacements: [bid] });
      const kam = Number(p?.kam) || 0, tug = Number(p?.tugagan) || 0;
      if (kam || tug) gaplar.push(`${kam ? kam + ' ta tovar kam qoldi' : ''}${kam && tug ? ', ' : ''}${tug ? tug + ' ta tovar tugagan' : ''}.`);
    }
    gaplar.push('Nima bilan yordam beray?');
    const text = gaplar.join(' ');

    const out = { text, configured: !!cfg.apiKey, enabled: cfg.enabled };
    if (req.query.speak === '1' && cfg.apiKey && cfg.enabled) {
      const { audio, ttsError } = await ovozlashtir(cfg, text);
      out.audio = audio; if (ttsError) out.ttsError = ttsError;
    }
    res.json(out);
  };

  /** POST /api/v1/ai/speak { text } → { mime, data } */
  speak = async (req, res) => {
    const cfg = await gemini.getConfig();
    if (!cfg.enabled) throw new HttpException(403, 'AI yordamchi o\'chirilgan');
    if (!cfg.apiKey) throw new HttpException(503, 'Gemini API kaliti kiritilmagan');
    const text = String(req.body?.text || '').trim();
    if (!text) throw new HttpException(400, 'Matn bo\'sh');
    checkLimit(req.currentUser.id);
    const audio = await gemini.synthesize(text, { apiKey: cfg.apiKey, model: cfg.ttsModel === 'browser' ? gemini.DEFAULTS.ttsModel : cfg.ttsModel, voice: cfg.voice });
    res.json(audio);
  };

  /**
   * POST /api/v1/ai/chat
   * body: { text?, audio?: {mime, data(base64)}, history?: [{role,text}], speak?: bool }
   * javob: { text, transcript?, actions[], tools[], audio?, ms }
   */
  chat = async (req, res) => {
    const cfg = await gemini.getConfig();
    if (!cfg.enabled) throw new HttpException(403, 'AI yordamchi o\'chirilgan (Sozlamalar → AI yordamchi)');
    if (!cfg.apiKey) throw new HttpException(503, 'Gemini API kaliti kiritilmagan (Sozlamalar → AI yordamchi)');
    checkLimit(req.currentUser.id);

    const body = req.body || {};
    const text = String(body.text || '').trim().slice(0, 4000);
    const parts = [];
    let hasAudio = false;
    if (text) parts.push({ type: 'text', text });
    if (body.audio?.data) {
      const mime = AUDIO_MIMES[String(body.audio.mime || '').split(';')[0].trim().toLowerCase()];
      if (!mime) throw new HttpException(400, `Audio formati qo'llanmaydi: ${body.audio.mime}`);
      const data = String(body.audio.data);
      if (data.length > MAX_AUDIO_B64) throw new HttpException(413, 'Audio juda katta (maks ~6 MB)');
      parts.push({ type: 'audio', mime_type: mime, data });
      hasAudio = true;
      if (!text) parts.unshift({ type: 'text', text: 'Ovozli xabar. Avval "Siz: «...»" qatorini yoz, keyin javob ber.' });
    }
    if (!parts.length) throw new HttpException(400, 'Savol bo\'sh');

    const userTools = tools.toolsFor(req.currentUser);
    const decls = tools.declarations(userTools);
    const input = [...historySteps(body.history), { type: 'user_input', content: parts }];
    const ctx = { user: req.currentUser, branch: req.branch, actions: [] };
    const used = [];
    const t0 = Date.now();
    let thinking = cfg.thinking;
    let finalText = '';

    for (let i = 0; i < 6; i++) {
      const reqBody = {
        model: cfg.model, store: false,
        system_instruction: systemInstruction(req, userTools),
        input, tools: decls,
        generation_config: { max_output_tokens: 1500, ...(thinking ? { thinking_level: thinking } : {}) },
      };
      let data;
      try {
        data = await gemini.interact(reqBody, { apiKey: cfg.apiKey, timeoutMs: 60000 });
      } catch (e) {
        // Model thinking_level ni qo'llamasa — usiz qayta
        if (thinking && e.status === 502 && /thinking/i.test(e.message)) { thinking = null; i--; continue; }
        throw e;
      }
      const steps = data?.steps || [];
      const calls = gemini.extractCalls(steps);
      finalText = gemini.extractText(steps) || finalText;
      if (!calls.length) break;

      input.push(...steps);
      for (const c of calls) {
        used.push(c.name);
        const result = await tools.runTool(userTools, c.name, c.arguments, ctx);
        input.push({ type: 'function_result', call_id: c.id, name: c.name,
                     result: [{ type: 'text', text: JSON.stringify(result) }] });
      }
    }

    let transcript = null;
    if (hasAudio) ({ text: finalText, transcript } = ajratTranskript(finalText));
    if (!finalText) finalText = used.length ? 'Ma\'lumot olindi, lekin xulosa yozilmadi. Qayta so\'rab ko\'ring.' : 'Javob tayyorlay olmadim. Qayta so\'rab ko\'ring.';

    const out = { text: finalText, transcript, actions: ctx.actions, tools: [...new Set(used)], ms: Date.now() - t0 };
    if (body.speak) {
      const { audio, ttsError } = await ovozlashtir(cfg, finalText);
      out.audio = audio; if (ttsError) out.ttsError = ttsError;
    }
    res.json(out);
  };
}

module.exports = new AiController();
module.exports.ROLLAR = ROLLAR;
