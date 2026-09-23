// routes/admin.js — Tableau de bord réservé au compte administrateur
// (voir config.js ADMIN_EMAIL). Toutes les routes exigent requireAuth PUIS
// requireAdmin : un utilisateur normal ou Premium reçoit un 403, quelle que
// soit l'interface qui appelle l'API. Cette fenêtre n'existe nulle part
// ailleurs dans l'app pour les comptes non-admin.

const express = require("express");
const db = require("../db");
const billing = require("../billing");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/overview
 * Chiffres clés + revenu des 6 derniers mois (pour le diagramme).
 */
router.get("/overview", (req, res) => {
  const totalUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const premiumUsers = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE subscription_status = 'premium'`)
    .get().n;
  const trialUsers = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE subscription_status = 'trial'`)
    .get().n;

  const revenueRow = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE status = 'succeeded'`)
    .get();

  // Revenu regroupé par mois (YYYY-MM), 6 derniers mois glissants.
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS month, SUM(amount_cents) AS total
       FROM transactions WHERE status = 'succeeded' GROUP BY month`
    )
    .all();
  const byMonth = Object.fromEntries(rows.map((r) => [r.month, r.total]));
  const revenueByMonth = months.map((m) => ({ month: m, totalCents: byMonth[m] || 0 }));

  res.json({
    totalUsers,
    premiumUsers,
    trialUsers,
    totalRevenueCents: revenueRow.total,
    revenueByMonth,
  });
});

/**
 * GET /api/admin/transactions
 * Historique complet des transactions, avec l'e-mail de l'utilisateur.
 */
router.get("/transactions", (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.amount_cents, t.currency, t.provider, t.status, t.description, t.created_at,
              u.email AS user_email
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT 200`
    )
    .all();
  res.json({ transactions: rows });
});

/**
 * GET /api/admin/users
 * Liste de tous les comptes (pour gestion : accorder/révoquer le Premium).
 */
router.get("/users", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, email, display_name, role, subscription_status, premium_until, created_at
       FROM users ORDER BY created_at DESC LIMIT 500`
    )
    .all();
  res.json({ users: rows });
});

/**
 * PATCH /api/admin/users/:id
 * Body: { grantPremiumDays } ou { revokePremium: true }
 * Permet à l'administrateur de modifier l'accès Premium de n'importe quel
 * compte manuellement (support client, geste commercial, etc.).
 */
router.patch("/users/:id", (req, res) => {
  const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

  const { grantPremiumDays, revokePremium } = req.body || {};

  if (revokePremium) {
    db.prepare(
      `UPDATE users SET subscription_status = 'free', premium_until = NULL WHERE id = ?`
    ).run(target.id);
  }

  if (grantPremiumDays && Number.isFinite(Number(grantPremiumDays))) {
    const days = Math.max(1, Math.min(3650, Number(grantPremiumDays)));
    const base =
      target.premium_until && new Date(target.premium_until) > new Date()
        ? new Date(target.premium_until)
        : new Date();
    const newUntil = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE users SET subscription_status = 'premium', premium_until = ? WHERE id = ?`
    ).run(newUntil, target.id);
    billing.recordTransaction({
      userId: target.id,
      amountCents: 0,
      provider: "simulation",
      status: "succeeded",
      description: `Premium offert manuellement par l'administrateur (${days} jours)`,
    });
  }

  res.json({ ok: true });
});

module.exports = router;
