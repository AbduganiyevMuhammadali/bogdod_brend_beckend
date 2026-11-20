// OpenAI-mos provayderlar (Mistral, DeepSeek va h.k.) bilan aloqa.
//
// Nega kerak: do'kon serveri Rossiyada, u yerdan Google Gemini, OpenAI,
// Anthropic, OpenRouter, Groq bloklangan; Mistral va DeepSeek esa ochiq.
// Ikkalasi ham OpenAI formatidagi `/chat/completions` ni qo'llaydi
// (tools/function calling bilan), shuning uchun bitta umumiy klient yetadi.
//
// Mistral qo'shimcha: ovozli xabar (`voxtral-small-latest` modeli,
// `input_audio` content qismi) va TTS (`/audio/speech`, voxtral-mini-tts).
const HttpException = require('../utils/HttpException.utils');

// Tayyor provayderlar (Sozlamalarda tanlanadi). Boshqa manzilni qo'lda ham yozish mumkin.
const PRESETS = {
  mistral: {
    label: 'Mistral (bepul tarif bor, ovozli xabar + TTS)',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    audioModel: 'voxtral-small-latest',
    ttsModel: 'voxtral-mini-tts-3-0',
    ttsVoice: '',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    label: 'DeepSeek (arzon, faqat matn)',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    audioModel: '',
    ttsModel: '',
    ttsVoice: '',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
};

function presetOf(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('mistral.ai')) return 'mistral';
  if (u.includes('deepseek.com')) return 'deepseek';
  return 'custom';
}

/** Gemini (Interactions) deklaratsiyasi → OpenAI `tools` formati */
function toOpenAiTools(decls = []) {
  return decls.map(d => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.parameters || { type: 'object', properties: {} } },
  }));
}

/** Umumiy POST (JSON). Xatolarni odam tiliga o'giradi. */
async function post(path, body, { baseUrl, apiKey, timeoutMs = 60000, raw = false } = {}) {
  if (!apiKey) throw new HttpException(503, 'AI sozlanmagan: provayder API kaliti kiritilmagan');
  const url = String(baseUrl || '').replace(/\/+$/, '') + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, buf;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': raw ? '*/*' : 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new HttpException(504, e.name === 'AbortError' ? 'AI provayderi javob bermadi (vaqt tugadi)' : `AI provayderi bilan aloqa yo'q: ${e.message}`);
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    let data = null; const text = buf.toString('utf8');
    try { data = JSON.parse(text); } catch { /* matn */ }
    const gm = data?.error?.message || data?.message || data?.detail?.[0]?.msg || data?.detail || text.slice(0, 300) || res.statusText;
    const gms = typeof gm === 'string' ? gm : JSON.stringify(gm).slice(0, 300);
    let msg = `AI provayderi xatosi (${res.status}): ${gms}`;
    if (res.status === 401) msg = 'API kaliti rad etildi (401). Sozlamalardagi provayder kalitini tekshiring';
    else if (res.status === 403 && /country|region|location/i.test(gms)) msg = 'Bu provayder server joylashuvida ishlamaydi (hudud cheklovi)';
    else if (res.status === 404) msg = `Model yoki manzil topilmadi (404): ${body?.model || url}`;
    else if (res.status === 429) msg = 'Provayder limiti tugadi (429). Bir ozdan keyin qayta urinib ko\'ring';
    else if (res.status === 422 || res.status === 400) msg = `So'rov qabul qilinmadi (${res.status}): ${gms}`;
    const err = new HttpException(res.status === 429 ? 429 : 502, msg);
    err.provider = data;
    throw err;
  }
  if (raw) return { buf, contentType: res.headers.get('content-type') || '' };
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpException(502, 'AI provayderi noto\'g\'ri javob qaytardi'); }
}

/** Ovozli xabar content qismi — Mistral satr, boshqalar (OpenAI) obyekt */
function audioPart(audio, baseUrl) {
  const mime = String(audio.mime || 'audio/wav').toLowerCase();
  const format = mime.includes('wav') ? 'wav' : mime.includes('mp3') || mime.includes('mpeg') ? 'mp3'
               : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('m4a') || mime.includes('mp4') ? 'm4a' : 'wav';
  return presetOf(baseUrl) === 'mistral'
    ? { type: 'input_audio', input_audio: audio.data }
    : { type: 'input_audio', input_audio: { data: audio.data, format } };
}

/**
 * Agent sikli (function calling). Gemini variantidagi (ai.controller.chat) bilan bir xil natija.
 * cfg: { baseUrl, apiKey, model, audioModel }
 * input: { systemInstruction, history:[{role,text}], text, audio, decls (Gemini formatida) }
 * runTool(name, args) → natija (JSON)
 */
async function runAgent(cfg, { systemInstruction, history = [], text = '', audio = null, decls = [] }, runTool) {
  const messages = [{ role: 'system', content: systemInstruction }];
  for (const h of history.slice(-12)) {
    const t = String(h?.text || '').trim().slice(0, 2000);
    if (t) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: t });
  }
  const t = String(text || '').trim().slice(0, 4000);
  if (audio?.data) {
    const parts = [];
    parts.push({ type: 'text', text: t || 'Ovozli xabar. Avval "Siz: «...»" qatorini yoz, keyin javob ber.' });
    parts.push(audioPart(audio, cfg.baseUrl));
    messages.push({ role: 'user', content: parts });
  } else {
    if (!t) throw new HttpException(400, 'Savol bo\'sh');
    messages.push({ role: 'user', content: t });
  }

  const model = audio?.data && cfg.audioModel ? cfg.audioModel : cfg.model;
  const tools = toOpenAiTools(decls);
  const used = [];
  let finalText = '';

  for (let i = 0; i < 6; i++) {
    const body = { model, messages, temperature: 0.3, max_tokens: 1500, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) };
    const data = await post('/chat/completions', body, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
    const msg = data?.choices?.[0]?.message || {};
    const content = typeof msg.content === 'string' ? msg.content
                  : Array.isArray(msg.content) ? msg.content.filter(c => c?.type === 'text').map(c => c.text).join('\n') : '';
    if (content) finalText = content.trim();
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(c => c?.function?.name) : [];
    if (!calls.length) break;

    // Model javobini (tool_calls bilan) tarixga qo'shamiz, keyin har natijani
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments || '{}' } })) });
    for (const c of calls) {
      let args = {};
      try { args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function.arguments || {}); } catch { args = {}; }
      used.push(c.function.name);
      const result = await runTool(c.function.name, args);
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: JSON.stringify(result) });
    }
  }
  return { text: finalText, used };
}

/** Bitta qisqa sinov so'rovi */
async function ping(cfg) {
  const data = await post('/chat/completions', {
    model: cfg.model, temperature: 0.2, max_tokens: 80,
    messages: [{ role: 'system', content: 'Faqat o\'zbek tilida, bitta qisqa gap bilan javob ber.' },
               { role: 'user', content: 'Salom! Ishga tayyormisan? Bir gapda javob ber.' }],
  }, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, timeoutMs: 30000 });
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

/**
 * TTS: OpenAI-mos `/audio/speech` ({model, input, voice, response_format}) →
 * { mime, data(base64) }. Provayder qo'llamasa xato (chaqiruvchi brauzer ovoziga o'tadi).
 */
async function speech(cfg, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!clean || !cfg.ttsModel) return null;
  // Mistral: `voice_id`, javob JSON { audio_data: base64 }. OpenAI-mos boshqalar: `voice`, javob ikkilik audio.
  const mistral = presetOf(cfg.baseUrl) === 'mistral';
  const body = { model: cfg.ttsModel, input: clean, response_format: 'mp3',
                 ...(cfg.ttsVoice ? (mistral ? { voice_id: cfg.ttsVoice } : { voice: cfg.ttsVoice }) : {}) };
  const { buf, contentType } = await post('/audio/speech', body, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, timeoutMs: 45000, raw: true });
  if (!buf?.length) throw new HttpException(502, 'Provayder ovoz qaytarmadi');
  // JSON (base64) qaytargan bo'lsa
  if (/json/i.test(contentType)) {
    try { const j = JSON.parse(buf.toString('utf8')); const d = j.audio_data || j.audio || j.data || j.b64_json; if (d) return { mime: j.mime_type || 'audio/mpeg', data: d }; } catch { /* pastga */ }
    throw new HttpException(502, 'Provayder ovoz qaytarmadi');
  }
  const mime = /wav/i.test(contentType) ? 'audio/wav' : /ogg|opus/i.test(contentType) ? 'audio/ogg' : 'audio/mpeg';
  return { mime, data: buf.toString('base64') };
}

module.exports = { PRESETS, presetOf, toOpenAiTools, runAgent, ping, speech };
