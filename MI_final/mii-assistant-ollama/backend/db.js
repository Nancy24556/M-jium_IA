// db.js — Gestion de la base de données (SQLite)
// Toute la persistance de l'application passe par ce module : utilisateurs,
// messages de conversation, parrainages. Utilise better-sqlite3 (API
// synchrone, simple et fiable, adaptée à une application de cette taille).

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "mii.sqlite3");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  display_name      TEXT,
  created_at        TEXT NOT NULL,

  -- Rôle (utilisateur normal ou administrateur — voir config.js/ADMIN_EMAIL)
  role              TEXT NOT NULL DEFAULT 'user',       -- 'user' | 'admin'

  -- Personnalisation
  avatar            TEXT NOT NULL DEFAULT '🙂',
  ai_tone           TEXT NOT NULL DEFAULT 'bienveillant', -- bienveillant | professionnel | cash

  -- Monétisation
  subscription_status TEXT NOT NULL DEFAULT 'trial', -- trial | premium | free
  trial_end_at      TEXT NOT NULL,
  premium_until     TEXT,                             -- date de fin du Premium payé/offert (NULL si aucun)

  -- Quota freemium
  free_sessions_used INTEGER NOT NULL DEFAULT 0,
  free_sessions_date  TEXT,                            -- date (YYYY-MM-DD) du compteur ci-dessus

  -- Gamification / streak
  streak_count      INTEGER NOT NULL DEFAULT 0,
  last_active_date  TEXT,
  unlocked_rewards  TEXT NOT NULL DEFAULT '[]',        -- JSON array de badges/thèmes débloqués

  -- Parrainage
  referral_code     TEXT UNIQUE NOT NULL,
  referred_by       TEXT,                              -- id de l'utilisateur parrain (NULL si aucun)
  referral_reward_granted INTEGER NOT NULL DEFAULT 0    -- 0/1, évite un double crédit
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,     -- id de session côté client (une "session de guidage" / conversation)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT,                 -- titre affiché dans l'historique (renommable par l'utilisateur)
  activity      TEXT,                 -- activité détectée/choisie pour cette session
  created_at    TEXT NOT NULL,
  counted_date  TEXT NOT NULL         -- date (YYYY-MM-DD) utilisée pour le quota
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,        -- 'user' | 'assistant'
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Historique des transactions (Premium payé, essai converti, etc.), utilisé
-- par le tableau de bord administrateur (montants, diagrammes de revenus).
CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'EUR',
  provider       TEXT NOT NULL,        -- 'stripe' | 'simulation'
  provider_ref   TEXT,                 -- id de session/paiement Stripe si applicable
  status         TEXT NOT NULL DEFAULT 'succeeded', -- 'succeeded' | 'refunded' | 'failed'
  description    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
`);

// --- Migrations légères pour les bases déjà existantes (créées avant ces
// colonnes) : on tente d'ajouter chaque colonne et on ignore l'erreur si
// elle existe déjà. Nécessaire car SQLite ne supporte pas
// "ADD COLUMN IF NOT EXISTS".
function ensureColumn(table, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (e) {
    // colonne déjà présente : rien à faire
  }
}
ensureColumn("users", "role TEXT NOT NULL DEFAULT 'user'");
ensureColumn("users", "avatar TEXT NOT NULL DEFAULT '🙂'");
ensureColumn("users", "ai_tone TEXT NOT NULL DEFAULT 'bienveillant'");
ensureColumn("users", "avatar_photo TEXT");
ensureColumn("sessions", "title TEXT");

module.exports = db;
