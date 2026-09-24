// routes/billing.js — Abonnement Premium (simulation ou Stripe réel selon .env).

const express = require("express");
const billing = require("../billing");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    const result = await billing.subscribe(req.user.id, { days: 30 });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossible de démarrer l'abonnement pour le moment." });
  }
});

router.post("/cancel", requireAuth, (req, res) => {
  const result = billing.cancelSubscription(req.user.id);
  res.json(result);
});

// Point d'entrée pour les webhooks Stripe réels (paiement confirmé, échec, etc.)
// À brancher uniquement si vous passez en mode Stripe réel (voir README).
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  // Implémentation à compléter avec stripe.webhooks.constructEvent(...)
  // en utilisant STRIPE_WEBHOOK_SECRET, si vous activez Stripe en production.
  res.json({ received: true });
});

module.exports = router;
