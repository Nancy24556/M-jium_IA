// routes/chat.js — Démarrage de session (avec application du quota
// freemium) et échange de messages avec Mï.

const express = require("express");
const { v4: uuidv4 } = require("uuid");

const db = require("../db");
const billing = require("../billing");
const rewards = require("../rewards");
const agent = require("../agent");
const { requireAuth } = require("../middleware/auth");
const { FREE_SESSIONS_PER_DAY } = require("../config");

const router = express.Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /api/chat/session/start
 * Crée une nouvelle "session de guidage". C'est ICI que la règle freemium
 * ("3 sessions par jour après l'essai") est appliquée : un compte 'trial'
 * ou 'premium' n'a aucune limite, un compte 'free' est bloqué au-delà du
 * quota journalier.
 */
router.post("/session/start", requireAuth, (req, res) => {
  const user = req.user;
  const status = billing.computeEffectiveStatus(user);
  const today = todayStr();

  if (status === "free") {
    const usedToday = user.free_sessions_date === today ? user.free_sessions_used : 0;
    if (usedToday >= FREE_SESSIONS_PER_DAY) {
      return res.status(402).json({
        error: "paywall",
        message:
          "Tu as atteint la limite de sessions gratuites pour aujourd'hui. Passe en Premium pour continuer sans limite.",
        freeSessionsPerDay: FREE_SESSIONS_PER_DAY,
      });
    }
    db.prepare(
      `UPDATE users SET free_sessions_used = ?, free_sessions_date = ? WHERE id = ?`
    ).run(usedToday + 1, today, user.id);
  }

  const sessionId = uuidv4();
  db.prepare(
    `INSERT INTO sessions (id, user_id, activity, created_at, counted_date)
     VALUES (?, ?, NULL, ?, ?)`
  ).run(sessionId, user.id, new Date().toISOString(), today);

  rewards.registerDailyActivity(user.id);

  res.status(201).json({ sessionId, subscriptionStatus: status });
});

/**
 * POST /api/chat/message
 * Body: { sessionId, message }
 * Envoie le message à Mï et renvoie sa réponse. La mémoire de conversation
 * est gérée automatiquement par agent.js à partir de sessionId.
 */
router.post("/message", requireAuth, async (req, res) => {
  const { sessionId, message } = req.body || {};

  if (!sessionId || !message || !message.trim()) {
    return res.status(400).json({ error: "sessionId et message sont requis." });
  }

  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session introuvable. Démarrez une nouvelle session." });
  }

  try {
    const reply = await agent.askMii({
      sessionId,
      userId: req.user.id,
      userMessage: message.trim(),
      user: {
        display_name: req.user.display_name,
        subscription_status: billing.computeEffectiveStatus(req.user),
      },
    });
    res.json({ reply });
  } catch (err) {
    console.error(err);
    if (err.code === "OLLAMA_UNREACHABLE") {
      return res.status(500).json({
        error:
          "Impossible de joindre Ollama en local. Lancez `ollama serve` et vérifiez que le modèle est téléchargé (`ollama pull llama3`).",
      });
    }
    res.status(502).json({ error: "Mï n'a pas pu répondre pour le moment. Réessayez." });
  }
});

/**
 * GET /api/chat/session/:id/history
 * Renvoie l'historique d'une session (pour réafficher la conversation).
 */
router.get("/session/:id/history", requireAuth, (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: "Session introuvable." });

  const history = agent.getHistory(req.params.id);
  res.json({ history });
});

/**
 * GET /api/chat/sessions
 * Liste les sessions récentes de l'utilisateur (pour un historique dans l'app).
 */
router.get("/sessions", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, activity, created_at FROM sessions
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(req.user.id);
  res.json({ sessions: rows });
});

module.exports = router;
