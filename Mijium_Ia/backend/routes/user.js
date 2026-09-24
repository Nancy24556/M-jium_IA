// routes/user.js — Profil de l'utilisateur connecté (statut, essai, quota).

const express = require("express");
const db = require("../db");
const billing = require("../billing");
const rewards = require("../rewards");
const { requireAuth } = require("../middleware/auth");
const { FREE_SESSIONS_PER_DAY } = require("../config");

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
  const { displayName } = req.body || {};
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
    displayName || null,
    req.user.id
  );
  res.json({ ok: true });
});

module.exports = router;
