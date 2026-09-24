// routes/chat.js — Démarrage de session (avec application du quota
// freemium) et échange de messages avec Mïjium.

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
    `INSERT INTO sessions (id, user_id, title, activity, created_at, counted_date)
     VALUES (?, ?, NULL, NULL, ?, ?)`
  ).run(sessionId, user.id, new Date().toISOString(), today);

  rewards.registerDailyActivity(user.id);

  res.status(201).json({ sessionId, subscriptionStatus: status });
});

/**
 * POST /api/chat/message
 * Body: { sessionId, message }
 * Envoie le message à Mïjium et renvoie sa réponse. La mémoire de conversation
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
        ai_tone: req.user.ai_tone,
      },
    });

    // Première fois qu'on répond dans cette conversation : on lui donne un
    // titre par défaut (basé sur le message de l'utilisateur) pour la
    // barre latérale d'historique, sauf si l'utilisateur l'a déjà renommée.
    if (!session.title) {
      const autoTitle = message.trim().slice(0, 60);
      db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(autoTitle, sessionId);
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    if (err.code === "GEMINI_ERROR") {
      return res.status(502).json({
        error:
          "Mïjium n'a pas pu contacter l'IA (Gemini) pour le moment. Vérifiez que GEMINI_API_KEY est correctement configurée et réessayez.",
      });
    }
    res.status(502).json({ error: "Mïjium n'a pas pu répondre pour le moment. Réessayez." });
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
 * Liste les conversations récentes de l'utilisateur (pour la barre latérale
 * d'historique dans l'app), avec un titre par défaut basé sur la date si
 * l'utilisateur n'a pas renommé la conversation.
 */
router.get("/sessions", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, activity, created_at FROM sessions
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      title: r.title || r.activity || `Conversation du ${new Date(r.created_at).toLocaleDateString("fr-FR")}`,
      createdAt: r.created_at,
    })),
  });
});

/**
 * PATCH /api/chat/session/:id
 * Renomme une conversation (barre latérale d'historique).
 */
router.patch("/session/:id", requireAuth, (req, res) => {
  const { title } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Un titre est requis." });
  }
  const result = db
    .prepare(`UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?`)
    .run(title.trim().slice(0, 80), req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Conversation introuvable." });
  }
  res.json({ ok: true });
});

/**
 * DELETE /api/chat/session/:id
 * Supprime une conversation et tous ses messages (ON DELETE CASCADE).
 */
router.delete("/session/:id", requireAuth, (req, res) => {
  const result = db
    .prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`)
    .run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Conversation introuvable." });
  }
  res.json({ ok: true });
});

module.exports = router;
