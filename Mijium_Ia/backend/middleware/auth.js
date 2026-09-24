// middleware/auth.js — Vérifie le jeton JWT envoyé par le client
// (en-tête Authorization: Bearer <token>) et attache l'utilisateur à req.user.

const jwt = require("jsonwebtoken");
const db = require("../db");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Non authentifié. Veuillez vous connecter." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter." });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expirée. Veuillez vous reconnecter." });
  }
}

module.exports = { requireAuth };
