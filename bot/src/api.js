/**
 * Do'kon serveri bilan aloqa.
 *
 * Har do'kon o'z portida ishlaydi (3003, 3004...), shuning uchun
 * manzil har chatga alohida saqlanadi.
 */
const TIMEOUT = 15000

async function so(url, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { /* JSON emas */ }

    if (!res.ok) {
      const msg = data?.message || `Server xatosi (${res.status})`
      throw new Error(msg)
    }
    // Portda API emas, frontend (HTML) turgan bo'lsa ham 200 qaytadi —
    // buni muvaffaqiyat deb qabul qilmaymiz
    if (text && data === null) throw new Error("Bu manzilda do'kon API si yo'q")
    return data
  } catch (e) {
    if (e.name === 'AbortError') throw new Error("Server javob bermadi (vaqt tugadi)")
    // Tarmoq xatosi — do'kon serveri o'chiq bo'lishi mumkin
    const kod = e.cause?.code
    if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ENOTFOUND'].includes(kod)) {
      throw new Error(`Do'kon serveriga ulanib bo'lmadi (${kod})`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

module.exports = {
  /** Kod bilan bog'lanish — token oladi */
  async pair(apiUrl, { code, chatId, chatName, chatUsername }) {
    const r = await so(`${apiUrl}/bot/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, chat_id: chatId,
        chat_name: chatName,
        chat_username: chatUsername,
      }),
    })
    // Token kelmasa — bazaga NULL yozib yiqilmasin
    if (!r?.token) throw new Error("Server token qaytarmadi")
    return r
  },

  summary(shop)       { return this._get(shop, '/bot/summary') },
  debtors(shop)       { return this._get(shop, '/bot/debtors') },
  // Faqat bugun to'lashi kerak bo'lganlar va kechikkanlar
  debtorsToday(shop)  { return this._get(shop, '/bot/debtors?bugun=1') },
  lowStock(shop)      { return this._get(shop, '/bot/low-stock') },
  period(shop, p)     { return this._get(shop, `/bot/period?p=${p}`) },
  top(shop, p)        { return this._get(shop, `/bot/top?p=${p}`) },
  cashiers(shop, p)   { return this._get(shop, `/bot/cashiers?p=${p}`) },
  cash(shop)          { return this._get(shop, '/bot/cash') },
  findProduct(shop, q){ return this._get(shop, `/bot/find-product?q=${encodeURIComponent(q)}`) },
  findClient(shop, q) { return this._get(shop, `/bot/find-client?q=${encodeURIComponent(q)}`) },

  _get(shop, yol) {
    return so(`${shop.api_url}${yol}`, {
      headers: { 'X-Bot-Token': shop.token },
    })
  },
}
