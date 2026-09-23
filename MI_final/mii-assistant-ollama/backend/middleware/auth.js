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

// Réservé aux routes d'administration : à utiliser TOUJOURS après
// requireAuth (qui attache req.user). Renvoie 403 pour tout compte dont le
// rôle n'est pas 'admin' — le contrôle est fait côté serveur, jamais
// seulement dans l'interface, pour que le tableau de bord admin reste
// réellement privé même si quelqu'un modifie le frontend.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Accès réservé à l'administrateur." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
