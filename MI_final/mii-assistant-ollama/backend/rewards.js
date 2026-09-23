// rewards.js — Parrainage et gamification (paliers d'activité).

const crypto = require("crypto");
const db = require("./db");

const MILESTONES = [
  { days: 5, reward: "theme_aurore", label: "Thème \"Aurore\" débloqué" },
  { days: 10, reward: "theme_foret", label: "Thème \"Forêt\" débloqué" },
  { days: 30, reward: "guide_exclusif_avance", label: "Guide exclusif « Aller plus loin » débloqué" },
];

function generateReferralCode() {
  return crypto.randomBytes(4).toString("hex"); // ex: "a1b2c3d4"
}

function referralLinkFor(code, baseUrl) {
  const origin = baseUrl || process.env.PUBLIC_APP_URL || "https://mon-app-mii.example.com";
  return `${origin}/register?ref=${code}`;
}

/**
 * À appeler une fois par jour d'activité (ex: au premier message de la
 * journée). Met à jour la série (streak) et débloque les paliers atteints.
 */
function registerDailyActivity(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return;

  const today = new Date().toISOString().slice(0, 10);
  if (user.last_active_date === today) return; // déjà comptabilisé aujourd'hui

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = user.last_active_date === yesterday ? user.streak_count + 1 : 1;

  const unlocked = JSON.parse(user.unlocked_rewards || "[]");
  for (const milestone of MILESTONES) {
    if (newStreak >= milestone.days && !unlocked.includes(milestone.reward)) {
      unlocked.push(milestone.reward);
    }
  }

  db.prepare(
    `UPDATE users SET streak_count = ?, last_active_date = ?, unlocked_rewards = ? WHERE id = ?`
  ).run(newStreak, today, JSON.stringify(unlocked), userId);

  return { streak: newStreak, unlocked };
}

function getRewardsSummary(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  const unlocked = JSON.parse(user.unlocked_rewards || "[]");
  const next = MILESTONES.find((m) => !unlocked.includes(m.reward));
  return {
    streak: user.streak_count,
    unlocked: unlocked.map((code) => MILESTONES.find((m) => m.reward === code)?.label || code),
    nextMilestone: next ? { daysNeeded: next.days, label: next.label } : null,
    referralCode: user.referral_code,
  };
}

module.exports = {
  MILESTONES,
  generateReferralCode,
  referralLinkFor,
  registerDailyActivity,
  getRewardsSummary,
};
