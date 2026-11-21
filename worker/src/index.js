/**
 * Idealista Commenti — backend (Cloudflare Worker + D1 + R2)
 *
 * Rotte:
 *   GET    /api/comments?listing=it:12345678    commenti di un annuncio (lettura pubblica)
 *   GET    /api/counts?listings=it:1,it:2        numero di commenti per più annunci
 *   POST   /api/comments                         nuovo commento o risposta         (auth)
 *   PATCH  /api/comments/:id                     modifica testo del proprio commento (auth)
 *   DELETE /api/comments/:id                     elimina il proprio commento        (auth)
 *   PUT    /api/comments/:id/reaction            imposta/rimuove la propria reazione (auth)
 *   POST   /api/upload                           carica un'immagine (corpo binario) (auth)
 *   GET    /api/gifs?q=...&offset=0              ricerca GIF su Giphy (proxy)       (auth)
 *   GET    /api/me                               profilo Google dell'utente         (auth)
 *   GET    /media/:key                           immagini caricate
 *
 * L'autenticazione usa il token OAuth che l'estensione ottiene da Chrome
 * (chrome.identity.getAuthToken): il Worker lo verifica presso Google e
 * controlla che sia stato emesso per il client ID dell'estensione.
 */

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const MAX_TEXT = 2000;
const MAX_UPLOAD = 5 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const LISTING_RE = /^(es|it|pt):\d{4,12}$/;
const ID_RE = /^[0-9a-f-]{36}$/;
const MEDIA_KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const GIPHY_URL_RE = /^https:\/\/(media\d*|i)\.giphy\.com\/[^\s"'<>\\]+$/;

const tokenCache = new Map(); // token -> { sub, exp }

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    try {
      return withCors(await route(request, env, ctx));
    } catch (err) {
      if (err instanceof HttpError) return withCors(json({ error: err.message }, err.status));
      console.error(err);
      return withCors(json({ error: 'Errore interno del server' }, 500));
    }
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/' && method === 'GET') return json({ ok: true, service: 'idealista-commenti' });

  if (path === '/api/comments' && method === 'GET') return listComments(request, env, url);
  if (path === '/api/counts' && method === 'GET') return countComments(env, url);
  if (path === '/api/comments' && method === 'POST') return createComment(request, env, url);
  if (path === '/api/upload' && method === 'POST') return uploadImage(request, env, url);
  if (path === '/api/gifs' && method === 'GET') return searchGifs(request, env, url, ctx);
  if (path === '/api/me' && method === 'GET') {
    const user = await requireUser(request, env, { refresh: true });
    return json({ user: publicUser(user) });
  }

  let m = path.match(/^\/api\/comments\/([^/]+)$/);
  if (m && method === 'PATCH') return editComment(request, env, url, m[1]);
  if (m && method === 'DELETE') return deleteComment(request, env, m[1]);

  m = path.match(/^\/api\/comments\/([^/]+)\/reaction$/);
  if (m && method === 'PUT') return setReaction(request, env, m[1]);

  m = path.match(/^\/media\/([^/]+)$/);
  if (m && method === 'GET') return serveMedia(env, m[1]);

  throw new HttpError(404, 'Rotta non trovata');
}

/* ------------------------------------------------------------------ auth */

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/);
  return m ? m[1] : null;
}

async function verifyToken(token, env) {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.exp > now) return cached;

  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!r.ok) throw new HttpError(401, 'Sessione Google non valida o scaduta');
  const info = await r.json();
  const allowed = String(env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(info.aud) && !allowed.includes(info.azp)) {
    throw new HttpError(401, "Token emesso per un'altra applicazione");
  }
  if (!info.sub) throw new HttpError(401, 'Token senza identità utente');

  const ttl = Math.max(30, Math.min(Number(info.expires_in) || 300, 3600));
  const entry = { sub: String(info.sub), exp: now + ttl * 1000 };
  if (tokenCache.size > 2000) tokenCache.clear();
  tokenCache.set(token, entry);
  return entry;
}

async function fetchGoogleProfile(env, token, sub) {
  const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new HttpError(401, 'Impossibile leggere il profilo Google');
  const p = await r.json();
  if (String(p.sub) !== sub) throw new HttpError(401, 'Profilo Google non corrispondente');
  const name = String(p.name || p.given_name || 'Utente').trim().slice(0, 80) || 'Utente';
  const picture = typeof p.picture === 'string' && p.picture.startsWith('https://') ? p.picture.slice(0, 500) : null;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, name, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at`
  )
    .bind(sub, name, picture, now, now)
    .run();
  return env.DB.prepare('SELECT id, name, picture, banned FROM users WHERE id = ?').bind(sub).first();
}

async function optionalUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  try {
    return await requireUser(request, env);
  } catch {
    return null; // in lettura un token scaduto non deve bloccare
  }
}

async function requireUser(request, env, { refresh = false } = {}) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Accedi con il tuo profilo Chrome per continuare');
  const { sub } = await verifyToken(token, env);
  let user = refresh ? null : await env.DB.prepare('SELECT id, name, picture, banned FROM users WHERE id = ?').bind(sub).first();
  if (!user) user = await fetchGoogleProfile(env, token, sub);
  if (user.banned) throw new HttpError(403, 'Il tuo account è stato sospeso');
  return user;
}

function publicUser(u) {
  return { id: u.id, name: u.name, picture: u.picture || null };
}

/* -------------------------------------------------------------- comments */

function mediaUrl(url, key) {
  return key ? `${url.origin}/media/${key}` : null;
}

function rowToComment(row, url, reactions, mine) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    parentId: row.parent_id || null,
    user: deleted ? null : { id: row.user_id, name: row.user_name, picture: row.user_picture || null },
    text: deleted ? '' : row.body,
    gifUrl: deleted ? null : row.gif_url || null,
    imageUrl: deleted ? null : mediaUrl(url, row.image_key),
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deleted,
    reactions: reactions || {},
    myReaction: mine || null,
  };
}

function parseListing(value) {
  const listing = String(value || '').trim().toLowerCase();
  if (!LISTING_RE.test(listing)) throw new HttpError(400, 'Identificativo annuncio non valido');
  return listing;
}

const SELECT_COMMENT = `SELECT c.id, c.parent_id, c.body, c.gif_url, c.image_key, c.created_at, c.edited_at, c.deleted_at,
  u.id AS user_id, u.name AS user_name, u.picture AS user_picture
  FROM comments c JOIN users u ON u.id = c.user_id`;

async function listComments(request, env, url) {
  const listing = parseListing(url.searchParams.get('listing'));
  const user = await optionalUser(request, env);

  const stmts = [
    env.DB.prepare(`${SELECT_COMMENT} WHERE c.listing = ? ORDER BY c.created_at ASC LIMIT 3000`).bind(listing),
    env.DB.prepare(
      `SELECT r.comment_id, r.emoji, COUNT(*) AS n FROM reactions r JOIN comments c ON c.id = r.comment_id
       WHERE c.listing = ? GROUP BY r.comment_id, r.emoji`
    ).bind(listing),
  ];
  if (user) {
    stmts.push(
      env.DB.prepare(
        `SELECT r.comment_id, r.emoji FROM reactions r JOIN comments c ON c.id = r.comment_id
         WHERE c.listing = ? AND r.user_id = ?`
      ).bind(listing, user.id)
    );
  }
  const [rows, reacts, mine] = await env.DB.batch(stmts);

  const counts = {};
  for (const r of reacts.results) (counts[r.comment_id] ||= {})[r.emoji] = Number(r.n);
  const my = {};
  if (mine) for (const r of mine.results) my[r.comment_id] = r.emoji;

  const comments = rows.results.map((row) => rowToComment(row, url, counts[row.id], my[row.id]));
  return json({ listing, comments, me: user ? publicUser(user) : null, reactions: REACTIONS });
}

async function countComments(env, url) {
  const raw = String(url.searchParams.get('listings') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => LISTING_RE.test(s));
  const listings = [...new Set(raw)].slice(0, 100);
  const counts = Object.fromEntries(listings.map((l) => [l, 0]));
  if (listings.length) {
    const ph = listings.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT listing, COUNT(*) AS n FROM comments WHERE deleted_at IS NULL AND listing IN (${ph}) GROUP BY listing`
    )
      .bind(...listings)
      .all();
    for (const r of results) counts[r.listing] = Number(r.n);
  }
  return json({ counts });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Corpo della richiesta non valido');
  }
}

function cleanText(value) {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (text.length > MAX_TEXT) throw new HttpError(400, `Il commento supera i ${MAX_TEXT} caratteri`);
  return text;
}

async function rateLimit(env, userId) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS minute, COUNT(*) AS day
     FROM comments WHERE user_id = ? AND created_at > ?`
  )
    .bind(now - 60_000, userId, now - 86_400_000)
    .first();
  if (Number(row?.minute) >= 8) throw new HttpError(429, 'Stai commentando troppo velocemente, riprova tra poco');
  if (Number(row?.day) >= 300) throw new HttpError(429, 'Hai raggiunto il limite giornaliero di commenti');
}

async function createComment(request, env, url) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const listing = parseListing(body.listing);
  const text = cleanText(body.text);

  let gifUrl = null;
  if (body.gifUrl) {
    gifUrl = String(body.gifUrl);
    if (gifUrl.length > 600 || !GIPHY_URL_RE.test(gifUrl)) throw new HttpError(400, 'GIF non valida');
  }

  let imageKey = null;
  if (body.imageKey) {
    imageKey = String(body.imageKey);
    if (!MEDIA_KEY_RE.test(imageKey)) throw new HttpError(400, 'Immagine non valida');
    const up = await env.DB.prepare('SELECT user_id, comment_id FROM uploads WHERE key = ?').bind(imageKey).first();
    if (!up || up.user_id !== user.id || up.comment_id) throw new HttpError(400, 'Immagine non disponibile');
  }

  if (!text && !gifUrl && !imageKey) throw new HttpError(400, 'Il commento è vuoto');
  if (gifUrl && imageKey) throw new HttpError(400, 'Puoi allegare una GIF oppure un’immagine, non entrambe');

  let parentId = null;
  if (body.parentId) {
    parentId = String(body.parentId);
    if (!ID_RE.test(parentId)) throw new HttpError(400, 'Commento di riferimento non valido');
    const parent = await env.DB.prepare('SELECT listing, deleted_at FROM comments WHERE id = ?').bind(parentId).first();
    if (!parent || parent.listing !== listing) throw new HttpError(404, 'Il commento a cui rispondi non esiste');
    if (parent.deleted_at) throw new HttpError(400, 'Non puoi rispondere a un commento eliminato');
  }

  await rateLimit(env, user.id);

  const id = crypto.randomUUID();
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO comments (id, listing, parent_id, user_id, body, gif_url, image_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, listing, parentId, user.id, text, gifUrl, imageKey, now),
  ];
  if (imageKey) stmts.push(env.DB.prepare('UPDATE uploads SET comment_id = ? WHERE key = ?').bind(id, imageKey));
  await env.DB.batch(stmts);

  const row = await env.DB.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).bind(id).first();
  return json({ comment: rowToComment(row, url, {}, null) }, 201);
}

async function ownComment(env, id, user) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Commento non valido');
  const row = await env.DB.prepare('SELECT id, user_id, gif_url, image_key, deleted_at FROM comments WHERE id = ?').bind(id).first();
  if (!row || row.deleted_at) throw new HttpError(404, 'Commento non trovato');
  if (row.user_id !== user.id) throw new HttpError(403, 'Puoi modificare solo i tuoi commenti');
  return row;
}

async function editComment(request, env, url, id) {
  const user = await requireUser(request, env);
  const row = await ownComment(env, id, user);
  const body = await readJson(request);
  const text = cleanText(body.text);
  if (!text && !row.gif_url && !row.image_key) throw new HttpError(400, 'Il commento è vuoto');
  await env.DB.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').bind(text, Date.now(), id).run();

  const [full, reacts, mine] = await env.DB.batch([
    env.DB.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).bind(id),
    env.DB.prepare('SELECT emoji, COUNT(*) AS n FROM reactions WHERE comment_id = ? GROUP BY emoji').bind(id),
    env.DB.prepare('SELECT emoji FROM reactions WHERE comment_id = ? AND user_id = ?').bind(id, user.id),
  ]);
  const counts = Object.fromEntries(reacts.results.map((r) => [r.emoji, Number(r.n)]));
  return json({ comment: rowToComment(full.results[0], url, counts, mine.results[0]?.emoji) });
}

async function deleteComment(request, env, id) {
  const user = await requireUser(request, env);
  const row = await ownComment(env, id, user);
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE comments SET body = \'\', gif_url = NULL, image_key = NULL, deleted_at = ? WHERE id = ?'
    ).bind(Date.now(), id),
    env.DB.prepare('DELETE FROM reactions WHERE comment_id = ?').bind(id),
  ]);
  if (row.image_key) {
    await env.MEDIA.delete(row.image_key);
    await env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(row.image_key).run();
  }
  return json({ ok: true });
}

async function setReaction(request, env, id) {
  const user = await requireUser(request, env);
  if (!ID_RE.test(id)) throw new HttpError(400, 'Commento non valido');
  const body = await readJson(request);
  const emoji = body.emoji == null ? null : String(body.emoji);
  if (emoji !== null && !REACTIONS.includes(emoji)) throw new HttpError(400, 'Reazione non supportata');

  const c = await env.DB.prepare('SELECT deleted_at FROM comments WHERE id = ?').bind(id).first();
  if (!c || c.deleted_at) throw new HttpError(404, 'Commento non trovato');

  if (emoji === null) {
    await env.DB.prepare('DELETE FROM reactions WHERE comment_id = ? AND user_id = ?').bind(id, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(comment_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`
    )
      .bind(id, user.id, emoji, Date.now())
      .run();
  }
  const { results } = await env.DB.prepare('SELECT emoji, COUNT(*) AS n FROM reactions WHERE comment_id = ? GROUP BY emoji')
    .bind(id)
    .all();
  return json({ reactions: Object.fromEntries(results.map((r) => [r.emoji, Number(r.n)])), myReaction: emoji });
}

/* ----------------------------------------------------------------- media */

function sniffImage(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  return null;
}

async function uploadImage(request, env, url) {
  const user = await requireUser(request, env);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_UPLOAD) throw new HttpError(413, 'Immagine troppo grande (max 5 MB)');

  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ? AND created_at > ?')
    .bind(user.id, Date.now() - 3_600_000)
    .first();
  if (Number(recent?.n) >= 30) throw new HttpError(429, 'Troppi caricamenti, riprova più tardi');

  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'File vuoto');
  if (buf.length > MAX_UPLOAD) throw new HttpError(413, 'Immagine troppo grande (max 5 MB)');
  const type = sniffImage(buf);
  if (!type) throw new HttpError(415, 'Formato non supportato: usa JPG, PNG, WebP o GIF');

  const key = `${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  await env.DB.prepare('INSERT INTO uploads (key, user_id, created_at) VALUES (?, ?, ?)').bind(key, user.id, Date.now()).run();
  return json({ key, url: mediaUrl(url, key) }, 201);
}

async function serveMedia(env, key) {
  if (!MEDIA_KEY_RE.test(key)) throw new HttpError(404, 'File non trovato');
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new HttpError(404, 'File non trovato');
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

/* ----------------------------------------------------------------- giphy */

async function searchGifs(request, env, url, ctx) {
  await requireUser(request, env);
  if (!env.GIPHY_API_KEY) throw new HttpError(503, 'GIF non configurate sul server');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 50);
  const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset')) || 0, 499));

  const api = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
  api.searchParams.set('api_key', env.GIPHY_API_KEY);
  api.searchParams.set('limit', '24');
  api.searchParams.set('offset', String(offset));
  api.searchParams.set('rating', 'pg-13');
  api.searchParams.set('bundle', 'messaging_non_clips');
  if (q) {
    api.searchParams.set('q', q);
    api.searchParams.set('lang', 'it');
  }

  const cacheKey = new Request(`https://giphy-cache.internal/${q ? 's' : 't'}?q=${encodeURIComponent(q)}&o=${offset}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const r = await fetch(api.toString());
  if (!r.ok) throw new HttpError(502, 'Giphy non risponde, riprova');
  const data = await r.json();
  const gifs = (data.data || [])
    .map((g) => {
      const im = g.images || {};
      const full = im.downsized_medium?.url || im.fixed_height?.url || im.original?.url;
      const preview = im.fixed_width_small?.url || im.fixed_width?.url || full;
      return {
        id: g.id,
        title: String(g.title || '').slice(0, 120),
        url: full,
        preview,
        width: Number(im.fixed_width?.width) || 200,
        height: Number(im.fixed_width?.height) || 200,
      };
    })
    .filter((g) => g.url && GIPHY_URL_RE.test(g.url) && GIPHY_URL_RE.test(g.preview));

  const res = json({ gifs, nextOffset: offset + 24 }, 200, { 'Cache-Control': 'public, max-age=300' });
  if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* --------------------------------------------------------------- helpers */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function withCors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
