// Integrazione: service worker dell'estensione (background.js) ↔ Worker, con chrome.* simulato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, fakeExternalFetch } from './helpers.js';

const env = makeEnv();
const store = { sync: { apiUrl: 'https://api.test' }, local: {} };
const area = (name) => ({
  get: async (k) => (typeof k === 'string' ? (k in store[name] ? { [k]: store[name][k] } : {}) : { ...store[name] }),
  set: async (o) => void Object.assign(store[name], o),
  remove: async (k) => [].concat(k).forEach((x) => delete store[name][x]),
});

let tokens = ['tok-anna'];
const removed = [];
let listener;
globalThis.chrome = {
  runtime: { id: 'aplgnmljckfoihjdcfkckkhcalkkjbdh', onMessage: { addListener: (fn) => (listener = fn) } },
  storage: { sync: area('sync'), local: area('local') },
  identity: {
    getAuthToken: async ({ interactive }) => {
      if (!tokens.length && interactive) tokens = ['tok-marco']; // l'utente approva nella finestra di Google
      if (!tokens.length) throw new Error('The user is not signed in.');
      return { token: tokens[0] };
    },
    removeCachedAuthToken: async ({ token }) => {
      removed.push(token);
      if (tokens[0] === token) tokens.shift();
    },
    clearAllCachedAuthTokens: async () => {},
  },
};

const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === 'api.test') return worker.fetch(new Request(url, init), env, { waitUntil() {} });
  if (url.pathname === '/revoke') return new Response('');
  if (url.hostname.endsWith('giphy.com') && url.hostname !== 'api.giphy.com')
    return new Response(GIF_BYTES, { headers: { 'Content-Type': 'image/gif' } });
  return fakeExternalFetch(input, init);
};

await import('../../extension/background.js');
const send = (msg) =>
  new Promise((resolve) => {
    assert.equal(listener(msg, {}, resolve), true);
  });

const L = 'it:12345678';

test('flusso completo dal service worker', async () => {
  let r = await send({ type: 'login' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.user.name, 'Anna Rossi');
  assert.equal(store.local.me.name, 'Anna Rossi');

  r = await send({ type: 'postComment', listing: L, text: 'Ciao dal background' });
  assert.equal(r.ok, true, r.error);
  const id = r.data.comment.id;

  r = await send({ type: 'react', id, emoji: '😮' });
  assert.deepEqual(r.data.reactions, { '😮': 1 });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]).toString('base64');
  r = await send({ type: 'upload', base64: png, contentType: 'image/png' });
  assert.equal(r.ok, true, r.error);
  r = await send({ type: 'postComment', listing: L, parentId: id, text: '', imageKey: r.data.key });
  assert.equal(r.ok, true, r.error);
  assert.match(r.data.comment.imageUrl, /^https:\/\/api\.test\/media\//);

  r = await send({ type: 'fetchImage', url: r.data.comment.imageUrl });
  assert.match(r.data.dataUrl, /^data:image\/png;base64,/);
  r = await send({ type: 'fetchImage', url: 'https://media1.giphy.com/media/x/giphy.gif' });
  assert.equal(r.data.dataUrl, 'data:image/gif;base64,' + Buffer.from(GIF_BYTES).toString('base64'));
  r = await send({ type: 'fetchImage', url: 'https://evil.example/a.png' });
  assert.equal(r.ok, false);

  r = await send({ type: 'gifs', q: 'casa' });
  assert.equal(r.data.gifs.length, 1);

  r = await send({ type: 'getComments', listing: L });
  assert.equal(r.data.comments.length, 2);
  assert.equal(r.data.me.name, 'Anna Rossi');
  assert.equal(r.data.comments[0].myReaction, '😮');

  r = await send({ type: 'getCounts', listings: [L, 'it:7777777'] });
  assert.deepEqual(r.data.counts, { [L]: 2, 'it:7777777': 0 });
});

test('token scaduto: viene scartato e si riprova con uno nuovo', async () => {
  tokens = ['tok-scaduto', 'tok-marco'];
  const r = await send({ type: 'postComment', listing: L, text: 'Dopo il refresh' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.comment.user.name, 'Marco Bianchi');
  assert.ok(removed.includes('tok-scaduto'));
});

test('logout: lettura anonima, scrittura bloccata', async () => {
  tokens = ['tok-marco'];
  let r = await send({ type: 'logout' });
  assert.equal(r.ok, true);
  assert.equal(store.local.loggedOut, true);

  r = await send({ type: 'getComments', listing: L });
  assert.equal(r.ok, true);
  assert.equal(r.data.me, null);
  assert.equal(r.data.comments.length, 3);

  r = await send({ type: 'postComment', listing: L, text: 'non dovrei' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_LOGGED_IN');

  r = await send({ type: 'login' });
  assert.equal(r.ok, true);
  assert.equal(store.local.loggedOut, undefined);
});

test('configurazione del server', async () => {
  let r = await send({ type: 'setConfig', apiUrl: 'http://insicuro.example' });
  assert.equal(r.ok, false);
  r = await send({ type: 'setConfig', apiUrl: 'https://api.test/' });
  assert.equal(r.data.apiUrl, 'https://api.test');
  r = await send({ type: 'ping' });
  assert.equal(r.data.ok, true);
  r = await send({ type: 'setConfig', apiUrl: '' });
  assert.match(r.data.apiUrl, /INSERISCI/);
  r = await send({ type: 'getComments', listing: L });
  assert.equal(r.code, 'NO_BACKEND');
  await send({ type: 'setConfig', apiUrl: 'https://api.test' });
});
