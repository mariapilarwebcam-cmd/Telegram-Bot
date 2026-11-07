-- Data-free local schema fixture for outfit transaction tests.
-- Only reviewed definitions required by checkGiftSchema; not a remote export.
-- Applied exclusively to the test's in-memory connection, never to Turso.
CREATE TABLE conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  character_id INTEGER NOT NULL REFERENCES user_characters(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, reaction TEXT DEFAULT NULL);

CREATE TABLE gacha_outfits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_tag TEXT NOT NULL, -- Lo que se inyecta en Runware
  image_url TEXT,
  rarity TEXT NOT NULL
);

CREATE TABLE generated_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_key TEXT NOT NULL,
  archetype TEXT NOT NULL,
  gender TEXT NOT NULL,
  mood TEXT DEFAULT 'default',
  level_bucket TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  blur_r2_key TEXT,
  r2_url TEXT,
  prompt_used TEXT,
  times_used INTEGER DEFAULT 0,
  first_user_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  max_level INTEGER,
  character_key TEXT,
  status TEXT DEFAULT 'candidate'
);

CREATE TABLE user_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  archetype TEXT NOT NULL,
  personality TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, equipped_outfit TEXT, owned_outfits TEXT DEFAULT '[]');

CREATE TABLE user_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL, -- 'outfit', 'fantasy_pass', 'gacha_character'
  item_key TEXT NOT NULL,  -- 'lace_lingerie_red', 'succubus', 'level_5_pass'
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  language TEXT DEFAULT 'es',
  gems INTEGER DEFAULT 10,
  purchased_gems INTEGER DEFAULT 0,
  paying_referrals_count INTEGER DEFAULT 0,
  hook_messages_remaining INTEGER DEFAULT 0,
  hook_used INTEGER DEFAULT 0,
  age_verified INTEGER DEFAULT 0,
  age_verified_at TEXT,
  pending_referral_code TEXT,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  total_referrals INTEGER DEFAULT 0,
  bonus_gems_from_referrals INTEGER DEFAULT 0,
  streak_count INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_daily_claim TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, gender TEXT, interested_in TEXT, onboarding_complete INTEGER DEFAULT 0, bot_blocked INTEGER DEFAULT 0, last_proactive_at TEXT, proactive_count INTEGER DEFAULT 0, last_active TEXT, photo_tokens INTEGER DEFAULT 1, photo_tokens_at TEXT, audio_tokens INTEGER DEFAULT 1, audio_last_refill_at TEXT, bonus_gems INTEGER NOT NULL DEFAULT 0);

CREATE INDEX idx_conv_history_char              ON conversation_history(character_id);
CREATE INDEX idx_conv_history_created           ON conversation_history(created_at DESC);
CREATE INDEX idx_conv_history_telegram          ON conversation_history(telegram_id);
CREATE INDEX idx_user_characters_active         ON user_characters(telegram_id, is_active);
CREATE INDEX idx_user_characters_telegram_id    ON user_characters(telegram_id);
CREATE INDEX idx_users_age_verified             ON users(age_verified);
CREATE INDEX idx_users_referral_code            ON users(referral_code);
CREATE INDEX idx_users_telegram_id              ON users(telegram_id);
CREATE INDEX idx_users_username                 ON users(LOWER(username));