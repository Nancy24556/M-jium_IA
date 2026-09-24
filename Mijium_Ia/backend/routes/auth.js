// routes/auth.js — Inscription et connexion.

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const db = require("../db");
const billing = require("../billing");
const rewards = require("../rewards");

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/register", async (req, res) => {
  try {
    const { email, password, displayName, referralCode } = req.body || {};

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Adresse e-mail invalide." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "Un compte existe déjà avec cet e-mail." });
    }

    let referredBy = null;
    if (referralCode) {
      const referrer = db
        .prepare("SELECT id FROM users WHERE referral_code = ?")
        .get(referralCode.trim());
      if (referrer) referredBy = referrer.id;
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const ownReferralCode = rewards.generateReferralCode();

    db.prepare(
      `INSERT INTO users
        (id, email, password_hash, display_name, created_at,
         subscription_status, trial_end_at, referral_code, referred_by)
       VALUES (?, ?, ?, ?, ?, 'trial', ?, ?, ?)`
    ).run(
      id,
      email.toLowerCase(),
      passwordHash,
      displayName || null,
      new Date().toISOString(),
      billing.startTrial(),
      ownReferralCode,
      referredBy
    );

    const token = signToken(id);
    return res.status(201).json({
      token,
      user: { id, email: email.toLowerCase(), displayName: displayName || null },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur lors de l'inscription." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "E-mail et mot de passe requis." });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "E-mail ou mot de passe incorrect." });
    }

    const token = signToken(user.id);
    return res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur lors de la connexion." });
  }
});

module.exports = router;
