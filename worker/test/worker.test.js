// Test del Worker con D1 simulato (node:sqlite), R2 in memoria e Google/Giphy finti.
// Esegui con: node --test test/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { USERS, makeEnv, fakeExternalFetch } from './helpers.js';

let env;
beforeEach(() => {
  env = makeEnv();
});
globalThis.fetch = fakeExternalFetch;

const BASE = 'https://api.test';
async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  let b;
  if (raw) b = raw;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: b }), env, { waitUntil() {} });
  const ct = res.headers.get('Content-Type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.arrayBuffer() };
}

const L = 'it:34567890';

test('lettura pubblica di un annuncio senza commenti', async () => {
  const r = await call('GET', `/api/comments?listing=${L}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.comments, []);
  assert.equal(r.data.me, null);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('identificativo annuncio non valido', async () => {
  const r = await call('GET', '/api/comments?listing=fr:1');
  assert.equal(r.status, 400);
});

test('scrivere senza login è vietato', async () => {
  const r = await call('POST', '/api/comments', { body: { listing: L, text: 'ciao' } });
  assert.equal(r.status, 401);
});

test('token di un’altra app rifiutato', async () => {
  const r = await call('POST', '/api/comments', { token: 'tok-altraapp', body: { listing: L, text: 'ciao' } });
  assert.equal(r.status, 401);
});

test('commento, risposta, reazioni e profilo Google', async () => {
  const c1 = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: '  Bella casa, ma il prezzo? ' } });
  assert.equal(c1.status, 201);
  assert.equal(c1.data.comment.text, 'Bella casa, ma il prezzo?');
  assert.equal(c1.data.comment.user.name, 'Anna Rossi');
  assert.equal(c1.data.comment.user.picture, USERS['tok-anna'].picture);

  const rep = await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, text: 'Trattabile!', parentId: c1.data.comment.id } });
  assert.equal(rep.status, 201);
  assert.equal(rep.data.comment.parentId, c1.data.comment.id);

  // risposta alla risposta
  const rep2 = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: 'Grazie', parentId: rep.data.comment.id } });
  assert.equal(rep2.status, 201);

  // risposta su un annuncio diverso dal padre → 404
  const wrong = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: 'it:999999', text: 'x', parentId: c1.data.comment.id } });
  assert.equal(wrong.status, 404);

  let r = await call('PUT', `/api/comments/${c1.data.comment.id}/reaction`, { token: 'tok-marco', body: { emoji: '❤️' } });
  assert.deepEqual(r.data.reactions, { '❤️': 1 });
  r = await call('PUT', `/api/comments/${c1.data.comment.id}/reaction`, { token: 'tok-anna', body: { emoji: '😂' } });
  // cambio reazione: sempre una sola per utente
  r = await call('PUT', `/api/comments/${c1.data.comment.id}/reaction`, { token: 'tok-anna', body: { emoji: '👍' } });
  assert.deepEqual(r.data.reactions, { '❤️': 1, '👍': 1 });
  assert.equal(r.data.myReaction, '👍');

  const bad = await call('PUT', `/api/comments/${c1.data.comment.id}/reaction`, { token: 'tok-anna', body: { emoji: '💩' } });
  assert.equal(bad.status, 400);

  const list = await call('GET', `/api/comments?listing=${L}`, { token: 'tok-anna' });
  assert.equal(list.data.comments.length, 3);
  assert.equal(list.data.me.name, 'Anna Rossi');
  const top = list.data.comments.find((c) => c.id === c1.data.comment.id);
  assert.deepEqual(top.reactions, { '❤️': 1, '👍': 1 });
  assert.equal(top.myReaction, '👍');

  // rimozione reazione
  r = await call('PUT', `/api/comments/${c1.data.comment.id}/reaction`, { token: 'tok-anna', body: { emoji: null } });
  assert.deepEqual(r.data.reactions, { '❤️': 1 });

  const counts = await call('GET', `/api/counts?listings=${L},it:111111,xx:1`);
  assert.deepEqual(counts.data.counts, { [L]: 3, 'it:111111': 0 });
});

test('modifica ed eliminazione solo dei propri commenti', async () => {
  const c = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: 'prima' } });
  const id = c.data.comment.id;
  const other = await call('PATCH', `/api/comments/${id}`, { token: 'tok-marco', body: { text: 'hack' } });
  assert.equal(other.status, 403);
  const ed = await call('PATCH', `/api/comments/${id}`, { token: 'tok-anna', body: { text: 'dopo' } });
  assert.equal(ed.status, 200);
  assert.equal(ed.data.comment.text, 'dopo');
  assert.ok(ed.data.comment.editedAt);

  const delOther = await call('DELETE', `/api/comments/${id}`, { token: 'tok-marco' });
  assert.equal(delOther.status, 403);
  const del = await call('DELETE', `/api/comments/${id}`, { token: 'tok-anna' });
  assert.equal(del.status, 200);
  const list = await call('GET', `/api/comments?listing=${L}`);
  assert.equal(list.data.comments[0].deleted, true);
  assert.equal(list.data.comments[0].text, '');
  assert.equal(list.data.comments[0].user, null);

  const replyDeleted = await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, text: 'x', parentId: id } });
  assert.equal(replyDeleted.status, 400);
});

test('GIF da Giphy: ricerca filtrata e validazione URL', async () => {
  const noAuth = await call('GET', '/api/gifs?q=gatto');
  assert.equal(noAuth.status, 401);
  const g = await call('GET', '/api/gifs?q=gatto', { token: 'tok-anna' });
  assert.equal(g.status, 200);
  assert.equal(g.data.gifs.length, 1, 'la GIF con URL esterno a giphy deve essere scartata');
  const gif = g.data.gifs[0];

  const ok = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: '', gifUrl: gif.url } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.comment.gifUrl, gif.url);

  const evil = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, gifUrl: 'javascript:alert(1)' } });
  assert.equal(evil.status, 400);
  const evil2 = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, gifUrl: 'https://giphy.com.evil.example/a.gif' } });
  assert.equal(evil2.status, 400);
});

test('upload immagine: formato, proprietà, servizio e cancellazione', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const up = await call('POST', '/api/upload', { token: 'tok-anna', raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 201);
  assert.match(up.data.key, /\.png$/);

  const html = new TextEncoder().encode('<html><script>alert(1)</script>');
  const bad = await call('POST', '/api/upload', { token: 'tok-anna', raw: html, headers: { 'Content-Type': 'image/png' } });
  assert.equal(bad.status, 415);

  // Marco non può usare l'immagine di Anna
  const steal = await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, imageKey: up.data.key } });
  assert.equal(steal.status, 400);

  const c = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: 'foto', imageKey: up.data.key } });
  assert.equal(c.status, 201);
  assert.equal(c.data.comment.imageUrl, `${BASE}/media/${up.data.key}`);

  // la stessa immagine non si riusa
  const reuse = await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, imageKey: up.data.key } });
  assert.equal(reuse.status, 400);

  const media = await call('GET', `/media/${up.data.key}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('Content-Type'), 'image/png');
  assert.equal(media.headers.get('X-Content-Type-Options'), 'nosniff');

  await call('DELETE', `/api/comments/${c.data.comment.id}`, { token: 'tok-anna' });
  assert.equal(env.MEDIA.store.size, 0);
  const gone = await call('GET', `/media/${up.data.key}`);
  assert.equal(gone.status, 404);
});

test('limiti: testo vuoto, troppo lungo, troppi commenti al minuto', async () => {
  assert.equal((await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: '   ' } })).status, 400);
  assert.equal((await call('POST', '/api/comments', { token: 'tok-anna', body: { listing: L, text: 'a'.repeat(2001) } })).status, 400);
  for (let i = 0; i < 8; i++) {
    assert.equal((await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, text: 'spam ' + i } })).status, 201);
  }
  assert.equal((await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, text: 'troppo' } })).status, 429);
});

test('utente sospeso', async () => {
  await call('GET', '/api/me', { token: 'tok-marco' });
  env.DB.raw.prepare('UPDATE users SET banned = 1 WHERE id = ?').run('1002');
  const r = await call('POST', '/api/comments', { token: 'tok-marco', body: { listing: L, text: 'ciao' } });
  assert.equal(r.status, 403);
});

test('preflight CORS', async () => {
  const r = await call('OPTIONS', '/api/comments');
  assert.equal(r.status, 204);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});
