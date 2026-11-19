#!/usr/bin/env node
// Gemini RELAY — ruxsat etilgan hududdagi serverda ishlaydi va POS backend'dan
// kelgan so'rovlarni Google'ga o'tkazadi.
//
// Nega kerak: Gemini API ba'zi hududlarda (masalan Rossiya) ishlamaydi —
// "User location is not supported". POS serveri shunday joyda bo'lsa,
// so'rovlar O'zbekiston/Yevropadagi shu relay orqali yuboriladi.
//
// Ishga tushirish (relay serverida):
//   RELAY_TOKEN=uzun-maxfiy-parol PORT=3977 node gemini-relay.js
//   yoki: pm2 start gemini-relay.js --name gemini-relay --update-env
// POS serverida: Sozlamalar → AI yordamchi → Ulanish:
//   manzil  http://RELAY_IP:3977/v1beta/interactions
//   token   uzun-maxfiy-parol
//
// Xavfsizlik: faqat `x-relay-token` to'g'ri bo'lgan so'rovlar o'tadi; Gemini
// kaliti relay'da saqlanmaydi, har so'rov bilan `x-goog-api-key` da keladi.
// Hech qanday matn yoki kalit logga yozilmaydi.
const http  = require('http');
const https = require('https');

const PORT   = Number(process.env.PORT || 3977);
const TOKEN  = (process.env.RELAY_TOKEN || '').trim();
const TARGET = new URL(process.env.RELAY_TARGET || 'https://generativelanguage.googleapis.com');
const MAX_BODY = 25 * 1024 * 1024; // Gemini inline limiti 20 MB

if (!TOKEN || TOKEN.length < 8) {
  console.error('RELAY_TOKEN (kamida 8 belgi) berilishi shart');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  if (req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: true, target: TARGET.host })); }
  if (req.method !== 'POST' || !req.url.startsWith('/v1beta/')) {
    res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 404, message: 'relay: faqat POST /v1beta/*' } }));
  }
  if ((req.headers['x-relay-token'] || '') !== TOKEN) {
    res.statusCode = 401; return res.end(JSON.stringify({ error: { code: 401, message: 'relay: token noto\'g\'ri' } }));
  }
  if (!req.headers['x-goog-api-key']) {
    res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 400, message: 'relay: x-goog-api-key yo\'q' } }));
  }

  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const lib = TARGET.protocol === 'https:' ? https : http;
    const up = lib.request({
      protocol: TARGET.protocol, hostname: TARGET.hostname, port: TARGET.port || undefined,
      path: req.url, method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        'content-length': body.length,
        'x-goog-api-key': req.headers['x-goog-api-key'],
        ...(req.headers['api-revision'] ? { 'api-revision': req.headers['api-revision'] } : {}),
        'accept': 'application/json',
        'user-agent': 'sellz-gemini-relay/1.0',
      },
      timeout: 120000,
    }, upRes => {
      res.statusCode = upRes.statusCode;
      res.setHeader('content-type', upRes.headers['content-type'] || 'application/json');
      upRes.pipe(res);
      upRes.on('end', () => console.log(`${new Date().toISOString()} ${upRes.statusCode} ${req.url} ${body.length}b ${Date.now() - t0}ms`));
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', e => {
      console.log(`${new Date().toISOString()} ERR ${req.url} ${e.message}`);
      if (!res.headersSent) { res.statusCode = 502; res.setHeader('content-type', 'application/json'); }
      res.end(JSON.stringify({ error: { code: 502, message: 'relay: Google bilan aloqa yo\'q: ' + e.message } }));
    });
    up.end(body);
  });
});

server.listen(PORT, () => console.log(`gemini-relay :${PORT} → ${TARGET.origin}`));
