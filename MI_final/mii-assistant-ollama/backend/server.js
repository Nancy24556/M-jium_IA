// server.js — Point d'entrée du backend Mïjium.
//
// Lance un serveur Express qui :
//  1) sert l'API REST (auth, chat, billing, rewards) utilisée par l'app,
//  2) sert aussi les fichiers statiques du frontend (../frontend), pour
//     pouvoir tester toute l'application avec un seul `npm start`.

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const chatRoutes = require("./routes/chat");
const billingRoutes = require("./routes/billing");
const rewardsRoutes = require("./routes/rewards");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Vérifications de démarrage ---
if (!process.env.JWT_SECRET) {
  console.error(
    "❌ JWT_SECRET manquant. Copiez backend/.env.example en backend/.env et renseignez-le."
  );
  process.exit(1);
}
console.warn(
  `ℹ️  Mïjium utilise Ollama en local (${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}, modèle "${process.env.OLLAMA_MODEL || "llama3"}"). ` +
    "Vérifiez qu'Ollama est lancé (`ollama serve`) et que le modèle est téléchargé (`ollama pull llama3`), sinon Mïjium ne pourra pas répondre."
);

// --- Middlewares globaux ---
app.use(
  cors({
    origin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*"
      ? process.env.CORS_ORIGIN.split(",")
      : true,
  })
);
// Le webhook Stripe a besoin du corps brut (non parsé) pour vérifier la
// signature — on exclut son chemin du parseur JSON global (voir
// routes/billing.js, qui applique son propre express.raw() sur cette route).
app.use((req, res, next) => {
  if (req.path === "/api/billing/webhook") return next();
  express.json({ limit: "2mb" })(req, res, next);
});

// Limite le rythme des requêtes pour éviter les abus (protège la clé API)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, réessayez dans un instant." },
});
app.use("/api", apiLimiter);

// --- Routes API ---
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/rewards", rewardsRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, name: "mii-assistant-backend" }));

// --- Fichiers statiques du frontend (pratique pour tester en local) ---
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// --- Gestion d'erreurs générique ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur inattendue." });
});

app.listen(PORT, () => {
  console.log(`✅ Mïjium backend démarré sur http://localhost:${PORT}`);
});
