// Mock condivisi: D1 su node:sqlite, R2 in memoria, Google e Giphy finti.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const USERS = {
  'tok-anna': { sub: '1001', name: 'Anna Rossi', picture: 'https://lh3.googleusercontent.com/a/anna' },
  'tok-marco': { sub: '1002', name: 'Marco Bianchi', picture: 'https://lh3.googleusercontent.com/a/marco' },
  'tok-altraapp': { sub: '1003', name: 'Intruso', aud: 'altra-app.apps.googleusercontent.com' },
};

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const plain = (r) => (r ? { ...r } : null);
  const stmt = (sql, params = []) => ({
    sql,
    bind: (...p) => stmt(sql, p),
    first: async () => plain(db.prepare(sql).get(...params)),
    all: async () => ({ results: db.prepare(sql).all(...params).map(plain) }),
    run: async () => (db.prepare(sql).run(...params), { success: true }),
    _exec: () => (/^\s*select/i.test(sql) ? { results: db.prepare(sql).all(...params).map(plain) } : (db.prepare(sql).run(...params), { results: [] })),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    raw: db,
  };
}

export function makeR2() {
  const store = new Map();
  return {
    store,
    put: async (k, v, o) => store.set(k, { body: v, httpMetadata: o?.httpMetadata }),
    get: async (k) => store.get(k) || null,
    delete: async (k) => store.delete(k),
  };
}

export function makeEnv() {
  return { DB: makeD1(), MEDIA: makeR2(), GOOGLE_CLIENT_ID: CLIENT_ID, GIPHY_API_KEY: 'giphy-key' };
}

export const fakeExternalFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'oauth2.googleapis.com') {
    const u = USERS[url.searchParams.get('access_token')];
    if (!u) return new Response('{"error":"invalid_token"}', { status: 400 });
    return Response.json({ sub: u.sub, aud: u.aud || CLIENT_ID, azp: u.aud || CLIENT_ID, expires_in: '3599' });
  }
  if (url.hostname === 'openidconnect.googleapis.com') {
    const tok = (init.headers?.Authorization || '').replace('Bearer ', '');
    const u = USERS[tok];
    if (!u) return new Response('', { status: 401 });
    return Response.json({ sub: u.sub, name: u.name, picture: u.picture });
  }
  if (url.hostname === 'api.giphy.com') {
    assert.equal(url.searchParams.get('api_key'), 'giphy-key');
    return Response.json({
      data: [
        { id: 'g1', title: 'Gatto', images: { fixed_width: { url: 'https://media1.giphy.com/media/g1/200w.gif', width: '200', height: '150' }, fixed_width_small: { url: 'https://media1.giphy.com/media/g1/100w.gif' }, downsized_medium: { url: 'https://media1.giphy.com/media/g1/giphy.gif' } } },
        { id: 'bad', title: 'Malevola', images: { fixed_width: { url: 'https://evil.example/x.gif' } } },
      ],
    });
  }
  throw new Error('fetch inattesa: ' + url);
};

