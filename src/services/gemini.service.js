// Gemini (Google AI) bilan aloqa — Interactions API (GA, 2026).
//
// Nega alohida xizmat: API kaliti faqat serverda saqlanadi, frontend hech
// qachon Google'ga to'g'ridan-to'g'ri murojaat qilmaydi. Sozlamalar
// `app_setting` jadvalida (Sozlamalar → AI yordamchi), bo'lmasa `.env`
// dagi GEMINI_API_KEY ishlatiladi.
//
// Hujjat: https://aistudio.google.com/docs/interactions
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   so'rov:  { model, input, tools, system_instruction, store, generation_config, response_format }
//   javob:   { id, status, steps: [ {type:'model_output', content:[{type:'text',text}]},
//                                   {type:'function_call', id, name, arguments}, ... ] }
const AppSettingModel = require('../models/app_setting.model');
const HttpException   = require('../utils/HttpException.utils');

// Google'ning asl manzili. Server joylashuvi Gemini uchun qo'llanmasa
// (masalan Rossiyadagi VPS: "User location is not supported") so'rovlar
// ruxsat etilgan hududdagi RELAY orqali yuboriladi — manzil Sozlamalarda
// (`ai_endpoint`) yoki GEMINI_ENDPOINT da. Relay `tools/gemini-relay.js`.
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const ENDPOINT = process.env.GEMINI_ENDPOINT || DEFAULT_ENDPOINT;

// Standart qiymatlar — Sozlamalarda o'zgartirilishi mumkin
const DEFAULTS = {
  model:     'gemini-4-hydrogen',        // tez, agentlik vazifalari uchun tavsiya etilgan
  ttsModel:  'gemini-3.8-flash-lite-tts', // o'zbek tilini qo'llaydi, arzon
  voice:     'Kore',
  thinking:  'low',
  enabled:   true,
  greeting:  true,
};

// Sozlamalar kaliti → app_setting.key
const KEYS = {
  enabled:  'ai_enabled',
  apiKey:   'ai_api_key',
  model:    'ai_model',
  ttsModel: 'ai_tts_model',
  voice:    'ai_voice',
  thinking: 'ai_thinking',
  greeting: 'ai_greeting',
  endpoint:   'ai_endpoint',     // relay manzili (bo'sh = Google to'g'ridan-to'g'ri)
  relayToken: 'ai_relay_token',  // relay'ga kirish paroli (x-relay-token)
  // Rejim: 'auto' | 'server' | 'browser'.
  //   server  — Gemini'ga server murojaat qiladi (kalit faqat serverda)
  //   browser — Gemini'ga kassirning BRAUZERI murojaat qiladi, server faqat
  //             vositalarni (bazadan ma'lumot) beradi. Server joylashuvi
  //             Gemini uchun qo'llanmasa (Rossiya) yagona ishlaydigan yo'l.
  //   auto    — server; joylashuv xatosi ko'rilsa o'z-o'zidan browser'ga o'tadi
  mode:            'ai_mode',
  locationBlocked: 'ai_location_blocked',
  // Provayder: 'gemini' (Google) yoki 'openai' (OpenAI-mos: Mistral, DeepSeek, boshqa)
  provider:   'ai_provider',
  oaBaseUrl:  'ai_oa_base_url',
  oaApiKey:   'ai_oa_api_key',
  oaModel:    'ai_oa_model',
  oaAudioModel: 'ai_oa_audio_model',  // ovozli xabar uchun model (Mistral: voxtral-small-latest)
  oaTtsModel: 'ai_oa_tts_model',      // TTS (bo'sh = brauzer ovozi)
  oaTtsVoice: 'ai_oa_tts_voice',
};

let cache = { at: 0, cfg: null };
const CACHE_MS = 15 * 1000;

/** Sozlamalarni o'qish (15 soniya kesh). Kalit bo'lmasa `apiKey` = ''. */
async function getConfig({ fresh = false } = {}) {
  if (!fresh && cache.cfg && Date.now() - cache.at < CACHE_MS) return cache.cfg;
  const rows = await AppSettingModel.findAll({ where: { key: Object.values(KEYS) } }).catch(() => []);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const bool = (v, d) => (v === undefined || v === null || v === '' ? d : v === 'true');
  const cfg = {
    enabled:  bool(m[KEYS.enabled], DEFAULTS.enabled),
    apiKey:   (m[KEYS.apiKey] || process.env.GEMINI_API_KEY || '').trim(),
    model:    (m[KEYS.model]    || process.env.GEMINI_MODEL     || DEFAULTS.model).trim(),
    ttsModel: (m[KEYS.ttsModel] || process.env.GEMINI_TTS_MODEL || DEFAULTS.ttsModel).trim(),
    voice:    (m[KEYS.voice]    || DEFAULTS.voice).trim(),
    thinking: (m[KEYS.thinking] || DEFAULTS.thinking).trim(),
    greeting: bool(m[KEYS.greeting], DEFAULTS.greeting),
    provider:   m[KEYS.provider] === 'openai' ? 'openai' : 'gemini',
    oaBaseUrl:  (m[KEYS.oaBaseUrl] || process.env.AI_OA_BASE_URL || 'https://api.mistral.ai/v1').trim().replace(/\/+$/, ''),
    oaApiKey:   (m[KEYS.oaApiKey]  || process.env.AI_OA_API_KEY || '').trim(),
    oaModel:    (m[KEYS.oaModel]   || process.env.AI_OA_MODEL || 'mistral-small-latest').trim(),
    oaAudioModel: (m[KEYS.oaAudioModel] ?? 'voxtral-small-latest').trim(),
    oaTtsModel: (m[KEYS.oaTtsModel] ?? 'voxtral-mini-tts-3-0').trim(),
    oaTtsVoice: (m[KEYS.oaTtsVoice] || '').trim(),
    mode:       ['auto', 'server', 'browser'].includes(m[KEYS.mode]) ? m[KEYS.mode] : 'auto',
    locationBlocked: m[KEYS.locationBlocked] === 'true',
    endpoint:   (m[KEYS.endpoint] || ENDPOINT).trim(),
    // Relay Sozlamalarda ko'rsatilganmi (bo'lmasa env/standart manzil)
    endpointCustom: !!(m[KEYS.endpoint] || '').trim(),
    relayToken: (m[KEYS.relayToken] || process.env.GEMINI_RELAY_TOKEN || '').trim(),
    // Kalit .env dan kelganmi (UI da "serverda belgilangan" deb ko'rsatiladi)
    keyFromEnv: !m[KEYS.apiKey] && !!process.env.GEMINI_API_KEY,
  };
  // Amaldagi rejim. OpenAI-mos provayderga server o'zi yetadi — doim server.
  cfg.effectiveMode = cfg.provider === 'openai' ? 'server'
                    : cfg.mode === 'browser' ? 'browser'
                    : cfg.mode === 'server'  ? 'server'
                    : (cfg.locationBlocked && !cfg.endpointCustom) ? 'browser' : 'server';
  // Amaldagi kalit/TTS (provayderga qarab) — kontroller shulardan foydalanadi
  cfg.activeKey = cfg.provider === 'openai' ? cfg.oaApiKey : cfg.apiKey;
  cfg.activeTts = cfg.provider === 'openai' ? (cfg.oaTtsModel || 'browser') : cfg.ttsModel;
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** Server joylashuvi Gemini uchun qo'llanmasligi aniqlandi — eslab qolamiz */
async function markLocationBlocked(blocked = true) {
  await AppSettingModel.upsert({ key: KEYS.locationBlocked, value: String(!!blocked) }).catch(() => {});
  cache = { at: 0, cfg: null };
}

/** Sozlamalarni saqlash. `apiKey` bo'sh/undefined bo'lsa o'zgartirilmaydi. */
async function saveConfig(patch) {
  const put = async (key, val) => AppSettingModel.upsert({ key, value: val });
  if (patch.enabled  !== undefined) await put(KEYS.enabled,  String(!!patch.enabled));
  if (patch.greeting !== undefined) await put(KEYS.greeting, String(!!patch.greeting));
  if (patch.model)    await put(KEYS.model,    String(patch.model).trim().slice(0, 100));
  if (patch.ttsModel !== undefined) await put(KEYS.ttsModel, String(patch.ttsModel).trim().slice(0, 100));
  if (patch.voice)    await put(KEYS.voice,    String(patch.voice).trim().slice(0, 60));
  if (patch.thinking) await put(KEYS.thinking, String(patch.thinking).trim().slice(0, 20));
  if (patch.provider !== undefined && ['gemini', 'openai'].includes(patch.provider)) await put(KEYS.provider, patch.provider);
  if (patch.oaBaseUrl !== undefined)    await put(KEYS.oaBaseUrl,    String(patch.oaBaseUrl || '').trim().slice(0, 300));
  if (patch.oaModel !== undefined)      await put(KEYS.oaModel,      String(patch.oaModel || '').trim().slice(0, 100));
  if (patch.oaAudioModel !== undefined) await put(KEYS.oaAudioModel, String(patch.oaAudioModel || '').trim().slice(0, 100));
  if (patch.oaTtsModel !== undefined)   await put(KEYS.oaTtsModel,   String(patch.oaTtsModel || '').trim().slice(0, 100));
  if (patch.oaTtsVoice !== undefined)   await put(KEYS.oaTtsVoice,   String(patch.oaTtsVoice || '').trim().slice(0, 100));
  if (patch.oaApiKey)                   await put(KEYS.oaApiKey,     String(patch.oaApiKey).trim());
  if (patch.oaApiKey === null)          await put(KEYS.oaApiKey,     '');
  if (patch.mode !== undefined && ['auto', 'server', 'browser'].includes(patch.mode)) await put(KEYS.mode, patch.mode);
  // Relay yoki rejim o'zgarsa server yo'lini qayta sinab ko'ramiz
  if (patch.endpoint !== undefined || patch.mode !== undefined) await put(KEYS.locationBlocked, 'false');
  if (patch.endpoint !== undefined)   await put(KEYS.endpoint,   String(patch.endpoint || '').trim().slice(0, 300));
  if (patch.relayToken !== undefined) await put(KEYS.relayToken, String(patch.relayToken || '').trim().slice(0, 200));
  if (patch.apiKey)   await put(KEYS.apiKey,   String(patch.apiKey).trim());
  if (patch.apiKey === null) await put(KEYS.apiKey, ''); // kalitni o'chirish
  cache = { at: 0, cfg: null };
  return getConfig({ fresh: true });
}

/** Kalitni UI uchun yashirish: "AIza••••••••k3Qw" */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/**
 * Interactions API ga bitta so'rov.
 * Xatolarni HttpException ga aylantiradi: 401/403 → kalit noto'g'ri,
 * 429 → limit, 404 → model topilmadi.
 */
async function interact(body, { apiKey, timeoutMs = 60000, endpoint, relayToken } = {}) {
  if (!apiKey) throw new HttpException(503, 'AI sozlanmagan: Gemini API kaliti kiritilmagan');
  const url = (endpoint || ENDPOINT).trim();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        ...(relayToken ? { 'x-relay-token': relayToken } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Gemini javob bermadi (vaqt tugadi)' : `Gemini bilan aloqa yo'q: ${e.message}`;
    throw new HttpException(504, msg);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* matn qoladi */ }

  if (!res.ok) {
    // Google xatoni ba'zan massiv ichida qaytaradi: [{ error: {...} }]
    const errObj = (Array.isArray(data) ? data[0]?.error : data?.error) || null;
    const gm = errObj?.message || text?.slice(0, 300) || res.statusText;
    let msg = `Gemini xatosi (${res.status}): ${gm}`;
    if (/location is not supported/i.test(gm)) {
      // Server joylashuvi qo'llanmaydi — 'auto' rejim brauzerga o'tadi
      if (url === ENDPOINT) await markLocationBlocked(true);
      msg = url === ENDPOINT
        ? 'Gemini bu server joylashuvida ishlamaydi (User location is not supported). Sozlamalar → AI yordamchi → "Ulanish" da relay manzilini ko\'rsating (tools/gemini-relay.js ni ruxsat etilgan hududdagi serverda ishga tushiring).'
        : 'Relay joylashuvi ham Gemini uchun qo\'llanmaydi (User location is not supported). Relay\'ni boshqa hududga ko\'chiring.';
    }
    else if (res.status === 401 && /relay/i.test(gm)) msg = 'Relay token noto\'g\'ri (x-relay-token). Sozlamalardagi relay tokenini tekshiring.';
    else if (res.status === 400 && /API key|api_key/i.test(gm)) msg = 'Gemini API kaliti noto\'g\'ri';
    else if (res.status === 401 || res.status === 403) msg = 'Gemini API kaliti rad etildi (noto\'g\'ri yoki ruxsati yo\'q)';
    else if (res.status === 404) msg = url === ENDPOINT || /model/i.test(gm)
      ? `Model topilmadi: ${body.model}. Sozlamalarda boshqa modelni tanlang`
      : `Relay manzili topilmadi (404): ${url}`;
    else if (res.status === 429) msg = 'Gemini limiti tugadi (429). Bir ozdan keyin qayta urinib ko\'ring';
    const err = new HttpException(res.status === 429 ? 429 : 502, msg);
    err.gemini = errObj;
    err.locationBlocked = /location is not supported/i.test(gm);
    throw err;
  }
  return data;
}

/** Javob qadamlaridan matnni yig'ish */
function extractText(steps = []) {
  const out = [];
  for (const s of steps) {
    if (s?.type !== 'model_output') continue;
    for (const c of s.content || []) if (c?.type === 'text' && c.text) out.push(c.text);
  }
  return out.join('\n').trim();
}

/** Javob qadamlaridan funksiya chaqiruvlari */
function extractCalls(steps = []) {
  return steps.filter(s => s?.type === 'function_call' && s.name);
}

/** Javobdan audio (base64) olish */
function extractAudio(steps = []) {
  for (const s of steps) {
    if (s?.type !== 'model_output') continue;
    for (const c of s.content || []) {
      if (c?.type === 'audio' && c.data) return { mime: c.mime_type || 'audio/wav', data: c.data };
    }
  }
  return null;
}

/**
 * Matnni ovozga aylantirish (TTS). Natija: { mime, data(base64) }.
 * Avval mp3 so'raladi (hajmi 5-6 marta kichik), server rad etsa wav.
 */
async function synthesize(text, { apiKey, model, voice, endpoint, relayToken } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!clean) return null;
  const base = {
    model: model || DEFAULTS.ttsModel,
    input: [{ type: 'user_input', content: [{ type: 'text', text: clean }] }],
    store: false,
    generation_config: { speech_config: [{ voice: voice || DEFAULTS.voice }] },
  };
  let data;
  try {
    data = await interact({ ...base, response_format: { type: 'audio', mime_type: 'audio/mp3' } }, { apiKey, timeoutMs: 45000, endpoint, relayToken });
  } catch (e) {
    if (e.status !== 502) throw e;
    // mime_type qabul qilinmadi — standart (wav)
    data = await interact({ ...base, response_format: { type: 'audio' } }, { apiKey, timeoutMs: 45000, endpoint, relayToken });
  }
  const audio = extractAudio(data?.steps);
  if (!audio) throw new HttpException(502, 'Gemini ovoz qaytarmadi');
  return audio;
}

module.exports = {
  DEFAULTS, KEYS, ENDPOINT, DEFAULT_ENDPOINT,
  getConfig, saveConfig, maskKey, markLocationBlocked,
  interact, extractText, extractCalls, extractAudio, synthesize,
};
