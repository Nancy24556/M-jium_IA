// config.js — Constantes partagées, dérivées des variables d'environnement.

module.exports = {
  FREE_SESSIONS_PER_DAY: parseInt(process.env.FREE_SESSIONS_PER_DAY || "3", 10),
};
