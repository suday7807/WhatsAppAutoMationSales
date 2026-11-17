-- All timestamps are epoch milliseconds (UTC). Phones are E.164 (+919876543210).

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  name        TEXT,
  business    TEXT,
  category    TEXT,
  city        TEXT,
  source      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS list_contacts (
  list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, contact_id)
);

CREATE TABLE IF NOT EXISTS optouts (
  phone       TEXT PRIMARY KEY,
  reason      TEXT NOT NULL,            -- stop | manual
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_kits (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL UNIQUE,
  demo_url    TEXT NOT NULL,
  image1      TEXT,                     -- file name inside UPLOAD_DIR
  image2      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',   -- draft | running | paused | completed | stopped
  demo_kit_id       INTEGER REFERENCES demo_kits(id) ON DELETE SET NULL,
  intro_variations  TEXT NOT NULL,                   -- JSON string[]
  link_variations   TEXT NOT NULL,                   -- JSON string[]
  rotation          TEXT NOT NULL DEFAULT 'order',   -- order | random
  message_mode      TEXT NOT NULL DEFAULT 'separate', -- combined (one text + images) | separate (intro, link, images)
  send_images       INTEGER NOT NULL DEFAULT 1,
  min_gap_s         INTEGER NOT NULL,
  max_gap_s         INTEGER NOT NULL,
  break_every       INTEGER NOT NULL DEFAULT 0,
  break_len_s       INTEGER NOT NULL DEFAULT 0,
  max_per_day       INTEGER NOT NULL,
  part_gap_min_s    INTEGER NOT NULL,
  part_gap_max_s    INTEGER NOT NULL,
  start_time        TEXT NOT NULL,                   -- HH:MM (local TZ)
  stop_time         TEXT NOT NULL,
  start_date        TEXT,                            -- YYYY-MM-DD or NULL
  days              TEXT NOT NULL,                   -- JSON number[] 0=Sun..6=Sat
  dedupe            TEXT NOT NULL DEFAULT 'skip_ever_messaged',
  next_send_at      INTEGER NOT NULL DEFAULT 0,
  sent_since_break  INTEGER NOT NULL DEFAULT 0,
  rotation_cursor   INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  completed_at      INTEGER
);

CREATE TABLE IF NOT EXISTS recipients (
  id             INTEGER PRIMARY KEY,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone          TEXT NOT NULL,
  name           TEXT,
  business       TEXT,
  category       TEXT,
  city           TEXT,
  position       INTEGER NOT NULL,
  -- pending | sending | sent | failed | not_on_wa | skipped_optout | skipped_duplicate | cancelled
  status         TEXT NOT NULL DEFAULT 'pending',
  chat_id        TEXT,
  variation_idx  INTEGER,
  intro_text     TEXT,
  link_text      TEXT,
  parts_done     INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     INTEGER,
  sent_at        INTEGER,                -- when the first part (intro) went out
  replied_at     INTEGER,
  UNIQUE (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_recipients_queue ON recipients (campaign_id, status, position);
CREATE INDEX IF NOT EXISTS idx_recipients_phone ON recipients (phone);
CREATE INDEX IF NOT EXISTS idx_recipients_chat ON recipients (chat_id);
CREATE INDEX IF NOT EXISTS idx_recipients_sent ON recipients (sent_at);

CREATE TABLE IF NOT EXISTS wa_messages (
  id            INTEGER PRIMARY KEY,
  recipient_id  INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  part          TEXT NOT NULL,           -- intro | link | img1 | img2
  wa_id         TEXT UNIQUE,
  ack           INTEGER NOT NULL DEFAULT 0,  -- -1 error, 0 pending, 1 server, 2 delivered, 3 read, 4 played
  sent_at       INTEGER NOT NULL,
  delivered_at  INTEGER,
  read_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_recipient ON wa_messages (recipient_id);

CREATE TABLE IF NOT EXISTS replies (
  id            INTEGER PRIMARY KEY,
  phone         TEXT NOT NULL,
  recipient_id  INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  campaign_id   INTEGER,
  body          TEXT,
  wa_id         TEXT UNIQUE,
  is_optout     INTEGER NOT NULL DEFAULT 0,
  received_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
