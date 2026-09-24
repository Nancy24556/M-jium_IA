// routes/rewards.js — Résumé du parrainage et de la gamification.

const express = require("express");
const rewards = require("../rewards");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/summary", requireAuth, (req, res) => {
  const summary = rewards.getRewardsSummary(req.user.id);
  res.json({
    ...summary,
    referralLink: rewards.referralLinkFor(req.user.referral_code, req.headers.origin),
  });
});

module.exports = router;
