// routes/user.js — Profil de l'utilisateur connecté (statut, essai, quota).

const express = require("express");
const db = require("../db");
const billing = require("../billing");
const rewards = require("../rewards");
const { requireAuth } = require("../middleware/auth");
const { FREE_SESSIONS_PER_DAY, AI_TONES } = require("../config");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  const user = req.user;
  const effectiveStatus = billing.computeEffectiveStatus(user);

  const today = new Date().toISOString().slice(0, 10);
  const sessionsToday =
    user.free_sessions_date === today ? user.free_sessions_used : 0;

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatar: user.avatar || "🙂",
    avatarPhoto: user.avatar_photo || null,
    aiTone: user.ai_tone || "bienveillant",
    role: user.role || "user",
    subscriptionStatus: effectiveStatus,
    trialDaysLeft: billing.trialDaysLeft(user),
    premiumUntil: user.premium_until,
    freeSessionsUsedToday: sessionsToday,
    freeSessionsPerDay: FREE_SESSIONS_PER_DAY,
    rewards: rewards.getRewardsSummary(user.id),
    referralLink: rewards.referralLinkFor(user.referral_code, req.headers.origin),
  });
});

router.patch("/me", requireAuth, (req, res) => {
  const { displayName, avatar, aiTone, avatarPhoto } = req.body || {};

  if (aiTone !== undefined && aiTone !== null && !AI_TONES.includes(aiTone)) {
    return res.status(400).json({ error: "Ton d'IA invalide." });
  }
  // avatarPhoto : chaîne data URL (image) pour la définir, null pour la
  // retirer (retour à l'emoji), undefined pour ne rien changer. On limite
  // grossièrement la taille pour éviter d'abuser du stockage en base.
  if (
    avatarPhoto !== undefined &&
    avatarPhoto !== null &&
    (typeof avatarPhoto !== "string" ||
      !avatarPhoto.startsWith("data:image/") ||
      avatarPhoto.length > 700_000)
  ) {
    return res.status(400).json({ error: "Photo de profil invalide ou trop volumineuse." });
  }

  const current = req.user;
  db.prepare(
    `UPDATE users SET display_name = ?, avatar = ?, ai_tone = ?, avatar_photo = ? WHERE id = ?`
  ).run(
    displayName !== undefined ? displayName || null : current.display_name,
    avatar !== undefined ? avatar || "🙂" : current.avatar,
    aiTone !== undefined ? aiTone : current.ai_tone,
    avatarPhoto !== undefined ? avatarPhoto : current.avatar_photo,
    current.id
  );
  res.json({ ok: true });
});

module.exports = router;
