-- Schema D1 per Idealista Commenti
-- Applica con: npx wrangler d1 execute idealista-commenti --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- "sub" dell'account Google
  name        TEXT NOT NULL,
  picture     TEXT,
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  listing     TEXT NOT NULL,             -- es. "it:12345678"
  parent_id   TEXT REFERENCES comments(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL DEFAULT '',
  gif_url     TEXT,
  image_key   TEXT,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comments_listing ON comments(listing, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

CREATE TABLE IF NOT EXISTS reactions (
  comment_id  TEXT NOT NULL REFERENCES comments(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  emoji       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS uploads (
  key         TEXT PRIMARY KEY,          -- chiave dell'oggetto su R2
  user_id     TEXT NOT NULL REFERENCES users(id),
  comment_id  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at);
