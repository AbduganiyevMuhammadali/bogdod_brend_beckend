// Gemini RELAY — Cloudflare Workers varianti (o'z serveringiz bo'lmasa).
// dash.cloudflare.com → Workers & Pages → Create → Hello World → kodni shu
// bilan almashtiring → Settings → Variables: RELAY_TOKEN → Deploy.
// POS Sozlamalar → AI yordamchi → Ulanish:
//   manzil  https://<worker-nomi>.<akkaunt>.workers.dev/v1beta/interactions
//   token   RELAY_TOKEN qiymati
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (request.method !== 'POST' || !url.pathname.startsWith('/v1beta/'))
      return Response.json({ error: { code: 404, message: 'relay: faqat POST /v1beta/*' } }, { status: 404 });
    if ((request.headers.get('x-relay-token') || '') !== (env.RELAY_TOKEN || '__unset__'))
      return Response.json({ error: { code: 401, message: 'relay: token noto\'g\'ri' } }, { status: 401 });
    const key = request.headers.get('x-goog-api-key');
    if (!key) return Response.json({ error: { code: 400, message: 'relay: x-goog-api-key yo\'q' } }, { status: 400 });
    const headers = { 'content-type': request.headers.get('content-type') || 'application/json', 'x-goog-api-key': key };
    const rev = request.headers.get('api-revision'); if (rev) headers['api-revision'] = rev;
    const up = await fetch('https://generativelanguage.googleapis.com' + url.pathname + url.search, {
      method: 'POST', headers, body: request.body,
    });
    return new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json' } });
  },
};
