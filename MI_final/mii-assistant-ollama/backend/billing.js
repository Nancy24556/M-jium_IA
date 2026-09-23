// billing.js — Essai gratuit de 7 jours + abonnement Premium.
//
// Si STRIPE_SECRET_KEY est défini dans .env, ce module utilise réellement
// Stripe pour créer une session de paiement. Sinon, il fonctionne en "mode
// simulation" : l'abonnement est activé immédiatement, ce qui permet de
// tester tout le parcours de monétisation sans compte Stripe.
//
// ⚠️ Play Store : pour une app Android publiée, la vente d'un abonnement
// numérique DOIT passer par Google Play Billing (règle du Play Store), pas
// par Stripe directement dans l'app. Voir le README, section "Conformité
// Play Store". Ce module Stripe reste pertinent pour une version web.

const db = require("./db");
const { PREMIUM_PRICE_CENTS, PREMIUM_CURRENCY } = require("./config");

const TRIAL_DAYS = parseInt(process.env.TRIAL_DURATION_DAYS || "7", 10);
const REFERRAL_BONUS_DAYS = parseInt(process.env.REFERRAL_BONUS_DAYS || "7", 10);

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn(
      "[billing] STRIPE_SECRET_KEY est défini mais le package 'stripe' n'est pas installé. " +
        "Lancez `npm install stripe` ou laissez STRIPE_SECRET_KEY vide pour rester en mode simulation."
    );
  }
}

function todayISO() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Calcule le statut d'accès EFFECTIF d'un utilisateur au moment présent :
 * 'trial' | 'premium' | 'free'. Ne modifie pas la base ; purement une lecture.
 */
function computeEffectiveStatus(user) {
  // Le compte administrateur a un accès Premium permanent, sans exception.
  if (user.role === "admin") return "premium";

  const now = new Date();
  if (user.trial_end_at && now < new Date(user.trial_end_at)) {
    return "trial";
  }
  if (user.premium_until && now < new Date(user.premium_until)) {
    return "premium";
  }
  return "free";
}

function trialDaysLeft(user) {
  if (!user.trial_end_at) return 0;
  const diffMs = new Date(user.trial_end_at) - new Date();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/** Initialise l'essai gratuit pour un nouvel utilisateur (appelé à l'inscription). */
function startTrial() {
  return addDays(new Date(), TRIAL_DAYS).toISOString();
}

/**
 * Enregistre une transaction (paiement Premium) pour l'historique et le
 * tableau de bord administrateur. `amountCents` en centimes de `currency`.
 */
function recordTransaction({
  userId,
  amountCents,
  currency = PREMIUM_CURRENCY,
  provider,
  providerRef = null,
  status = "succeeded",
  description = "Abonnement Premium",
}) {
  db.prepare(
    `INSERT INTO transactions (user_id, amount_cents, currency, provider, provider_ref, status, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, amountCents, currency, provider, providerRef, status, description, new Date().toISOString());
}

/**
 * Démarre un abonnement Premium. En mode simulation, l'accès est débloqué
 * immédiatement pour `days` jours. En mode Stripe réel, retourne une URL de
 * paiement Stripe Checkout à ouvrir côté client.
 */
async function subscribe(userId, { days = 30 } = {}) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("Utilisateur introuvable");

  if (stripe && process.env.STRIPE_PRICE_ID_PREMIUM) {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID_PREMIUM, quantity: 1 }],
      success_url: process.env.STRIPE_SUCCESS_URL || "https://example.com/success",
      cancel_url: process.env.STRIPE_CANCEL_URL || "https://example.com/cancel",
      client_reference_id: userId,
    });
    return { mode: "stripe", checkoutUrl: session.url };
  }

  // --- Mode simulation (par défaut) ---
  const base =
    user.premium_until && new Date(user.premium_until) > new Date()
      ? new Date(user.premium_until)
      : new Date();
  const newUntil = addDays(base, days).toISOString();

  db.prepare(
    `UPDATE users SET subscription_status = 'premium', premium_until = ? WHERE id = ?`
  ).run(newUntil, userId);

  recordTransaction({
    userId,
    amountCents: PREMIUM_PRICE_CENTS,
    currency: PREMIUM_CURRENCY,
    provider: "simulation",
    description: `Abonnement Premium (${days} jours, mode simulation)`,
  });

  applyReferralRewardIfNeeded(userId);

  return { mode: "simulation", premiumUntil: newUntil };
}

/** Annule le renouvellement automatique (résiliation "en un clic"). */
function cancelSubscription(userId) {
  // En mode simulation : l'accès premium reste actif jusqu'à premium_until,
  // mais on marque explicitement le statut pour ne pas renouveler ensuite.
  db.prepare(`UPDATE users SET subscription_status = 'free' WHERE id = ?`).run(userId);
  return { canceled: true };
}

/**
 * Quand un utilisateur parrainé souscrit pour la première fois, crédite le
 * parrain ET le filleul de REFERRAL_BONUS_DAYS jours de Premium (une seule
 * fois, grâce à referral_reward_granted).
 */
function applyReferralRewardIfNeeded(referredUserId) {
  const referred = db.prepare("SELECT * FROM users WHERE id = ?").get(referredUserId);
  if (!referred || !referred.referred_by || referred.referral_reward_granted) return;

  const referrer = db.prepare("SELECT * FROM users WHERE id = ?").get(referred.referred_by);
  if (!referrer) return;

  const grant = (u) => {
    const base =
      u.premium_until && new Date(u.premium_until) > new Date()
        ? new Date(u.premium_until)
        : new Date();
    const newUntil = addDays(base, REFERRAL_BONUS_DAYS).toISOString();
    db.prepare(
      `UPDATE users SET premium_until = ?, subscription_status = 'premium' WHERE id = ?`
    ).run(newUntil, u.id);
  };

  grant(referred);
  grant(referrer);

  db.prepare(`UPDATE users SET referral_reward_granted = 1 WHERE id = ?`).run(referred.id);
}

/**
 * Active le Premium d'un utilisateur suite à un paiement Stripe confirmé
 * (appelé depuis le webhook /api/billing/webhook) et journalise la
 * transaction réelle (montant/devise renvoyés par Stripe).
 */
function activatePremiumFromStripe({ userId, days = 30, amountCents, currency, sessionId }) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return;

  const base =
    user.premium_until && new Date(user.premium_until) > new Date()
      ? new Date(user.premium_until)
      : new Date();
  const newUntil = addDays(base, days).toISOString();

  db.prepare(
    `UPDATE users SET subscription_status = 'premium', premium_until = ? WHERE id = ?`
  ).run(newUntil, userId);

  recordTransaction({
    userId,
    amountCents: amountCents ?? PREMIUM_PRICE_CENTS,
    currency: currency || PREMIUM_CURRENCY,
    provider: "stripe",
    providerRef: sessionId,
    description: "Abonnement Premium (paiement Stripe)",
  });

  applyReferralRewardIfNeeded(userId);
}

module.exports = {
  TRIAL_DAYS,
  computeEffectiveStatus,
  trialDaysLeft,
  startTrial,
  subscribe,
  cancelSubscription,
  applyReferralRewardIfNeeded,
  recordTransaction,
  activatePremiumFromStripe,
  stripe,
  todayISO,
};
