// Service worker: autenticazione con il profilo Chrome e chiamate al backend.
import { DEFAULT_API_URL } from './config.js';

async function apiBase() {
  const { apiUrl } = await chrome.storage.sync.get('apiUrl');
  return String(apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
}

/* ------------------------------------------------------------ identity */

async function getToken(interactive) {
  if (!interactive) {
    const { loggedOut } = await chrome.storage.local.get('loggedOut');
    if (loggedOut) return null;
  }
  try {
    const res = await chrome.identity.getAuthToken({ interactive });
    const token = typeof res === 'string' ? res : res?.token;
    if (token && interactive) await chrome.storage.local.remove('loggedOut');
    return token || null;
  } catch (err) {
    if (interactive) throw new ApiError(friendlyAuthError(err), 0, 'AUTH_FAILED');
    return null;
  }
}

function friendlyAuthError(err) {
  const msg = String(err?.message || err);
  if (/did not approve|canceled|cancelled|user denied/i.test(msg)) return 'Accesso annullato';
  if (/bad client id|invalid client|OAuth2 not granted|client_id/i.test(msg))
    return 'Client ID OAuth non configurato correttamente (vedi README)';
  if (/not signed in|sign in/i.test(msg)) return 'Accedi a Chrome con un account Google per commentare';
  return 'Accesso non riuscito: ' + msg;
}

async function dropToken(token) {
  if (!token) return;
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch {}
}

async function logout() {
  const token = await getToken(false);
  if (token) {
    await dropToken(token);
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => {});
  }
  try {
    await chrome.identity.clearAllCachedAuthTokens();
  } catch {}
  await chrome.storage.local.set({ loggedOut: true });
  await chrome.storage.local.remove('me');
}

/* ----------------------------------------------------------------- api */

class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(method, path, { body, raw, contentType, auth = 'optional', retry = true } = {}) {
  const base = await apiBase();
  if (/INSERISCI/.test(base)) throw new ApiError('Backend non configurato: imposta l’indirizzo nel popup dell’estensione', 0, 'NO_BACKEND');

  const token = auth ? await getToken(false) : null;
  if (auth === 'required' && !token) throw new ApiError('Accedi con il tuo profilo Chrome per continuare', 401, 'NOT_LOGGED_IN');

  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (raw) {
    payload = raw;
    headers['Content-Type'] = contentType || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(base + path, { method, headers, body: payload });
  } catch {
    throw new ApiError('Impossibile contattare il server dei commenti', 0, 'NETWORK');
  }

  if (res.status === 401 && token && retry) {
    // token scaduto o revocato: lo scartiamo e riproviamo una volta
    await dropToken(token);
    return api(method, path, { body, raw, contentType, auth, retry: false });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new ApiError(data?.error || `Errore ${res.status}`, res.status, res.status === 401 ? 'NOT_LOGGED_IN' : '');
  }
  return data;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// Scarica un'immagine (avatar Google o GIF) e la restituisce come data URL.
// Serve quando la Content-Security-Policy della pagina blocca le immagini esterne.
const ALLOWED_IMAGE_HOSTS = /(^|\.)(googleusercontent\.com|giphy\.com)$/;
async function fetchImage(url) {
  const u = new URL(url);
  const base = new URL(await apiBase());
  if (u.protocol !== 'https:' || !(ALLOWED_IMAGE_HOSTS.test(u.hostname) || u.origin === base.origin)) {
    throw new ApiError('Origine immagine non consentita');
  }
  const res = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new ApiError('Immagine non disponibile', res.status);
  const type = res.headers.get('Content-Type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new ApiError('Non è un’immagine');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new ApiError('Immagine troppo grande');
  return `data:${type};base64,${bytesToBase64(buf)}`;
}

/* ------------------------------------------------------------ messages */

const handlers = {
  async getComments({ listing }) {
    return api('GET', `/api/comments?listing=${encodeURIComponent(listing)}`);
  },
  async getCounts({ listings }) {
    return api('GET', `/api/counts?listings=${encodeURIComponent(listings.join(','))}`, { auth: null });
  },
  async postComment({ listing, parentId, text, gifUrl, imageKey }) {
    return api('POST', '/api/comments', { auth: 'required', body: { listing, parentId, text, gifUrl, imageKey } });
  },
  async editComment({ id, text }) {
    return api('PATCH', `/api/comments/${encodeURIComponent(id)}`, { auth: 'required', body: { text } });
  },
  async deleteComment({ id }) {
    return api('DELETE', `/api/comments/${encodeURIComponent(id)}`, { auth: 'required' });
  },
  async react({ id, emoji }) {
    return api('PUT', `/api/comments/${encodeURIComponent(id)}/reaction`, { auth: 'required', body: { emoji } });
  },
  async upload({ base64, contentType }) {
    return api('POST', '/api/upload', { auth: 'required', raw: base64ToBytes(base64), contentType });
  },
  async gifs({ q, offset }) {
    const qs = new URLSearchParams({ q: q || '', offset: String(offset || 0) });
    return api('GET', `/api/gifs?${qs}`, { auth: 'required' });
  },
  async me() {
    const token = await getToken(false);
    if (!token) return { user: null };
    const data = await api('GET', '/api/me', { auth: 'required' });
    await chrome.storage.local.set({ me: data.user });
    return data;
  },
  async login() {
    await getToken(true);
    const data = await api('GET', '/api/me', { auth: 'required' });
    await chrome.storage.local.set({ me: data.user });
    return data;
  },
  async logout() {
    await logout();
    return { ok: true };
  },
  async fetchImage({ url }) {
    return { dataUrl: await fetchImage(url) };
  },
  async getConfig() {
    return { apiUrl: await apiBase(), extensionId: chrome.runtime.id };
  },
  async setConfig({ apiUrl }) {
    const clean = String(apiUrl || '').trim().replace(/\/+$/, '');
    if (clean && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(clean)) throw new ApiError('Indirizzo non valido: deve iniziare con https://');
    if (clean) await chrome.storage.sync.set({ apiUrl: clean });
    else await chrome.storage.sync.remove('apiUrl');
    return { apiUrl: await apiBase() };
  },
  async ping() {
    const base = await apiBase();
    const res = await fetch(base + '/').catch(() => null);
    if (!res?.ok) throw new ApiError('Il server non risponde a ' + base);
    return res.json();
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err), status: err?.status || 0, code: err?.code || '' }));
  return true; // risposta asincrona
});
