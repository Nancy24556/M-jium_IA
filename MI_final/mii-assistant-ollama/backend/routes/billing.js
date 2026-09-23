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
// Actif uniquement si STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont définis
// dans .env (voir README, "Passer en paiement Stripe réel").
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!billing.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    // Mode simulation : rien à traiter, on répond simplement 200.
    return res.json({ received: true });
  }

  let event;
  try {
    const signature = req.headers["stripe-signature"];
    event = billing.stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[billing] Signature webhook Stripe invalide :", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id;
    if (userId) {
      billing.activatePremiumFromStripe({
        userId,
        days: 30,
        amountCents: session.amount_total,
        currency: session.currency,
        sessionId: session.id,
      });
    }
  }

  res.json({ received: true });
});

module.exports = router;
