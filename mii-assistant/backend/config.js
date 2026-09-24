// config.js — Constantes partagées, dérivées des variables d'environnement.

module.exports = {
  FREE_SESSIONS_PER_DAY: parseInt(process.env.FREE_SESSIONS_PER_DAY || "3", 10),

  // Compte administrateur unique : cette adresse est automatiquement
  // promue au rôle 'admin' (accès total, Premium illimité, tableau de
  // bord des transactions) dès son inscription ou sa connexion.
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || "anayamite@gmail.com").toLowerCase(),

  // Prix affiché/facturé pour l'abonnement Premium (utilisé en mode
  // simulation pour enregistrer une transaction réaliste, et comme
  // référence si vous n'utilisez pas un Price ID Stripe).
  PREMIUM_PRICE_CENTS: parseInt(process.env.PREMIUM_PRICE_CENTS || "999", 10),
  PREMIUM_CURRENCY: (process.env.PREMIUM_CURRENCY || "eur").toLowerCase(),

  AI_TONES: ["bienveillant", "professionnel", "cash"],
};
