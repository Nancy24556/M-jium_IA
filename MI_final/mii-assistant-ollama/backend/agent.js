// agent.js — Logique conversationnelle de Mïjium : utilise l'API Gemini dans le Cloud.

const db = require("./db");
const { buildSystemPrompt } = require("./prompts");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// On utilise le modèle gratuit et rapide "gemini-1.5-flash"
const MODEL = "gemini-1.5-flash";
const MAX_HISTORY_MESSAGES = 24;

/**
 * Récupère l'historique d'une session, au format attendu par l'API Gemini ({role, parts: [{text}]}).
 */
function getHistory(sessionId) {
  const rows = db
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(sessionId, MAX_HISTORY_MESSAGES);
  
  // L'API Gemini attend les rôles "user" et "model" (au lieu de "assistant")
  return rows.reverse().map((r) => ({
    role: r.role === "assistant" ? "model" : "user",
    parts: [{ text: r.content }],
  }));
}

function saveMessage({ sessionId, userId, role, content }) {
  db.prepare(
    `INSERT INTO messages (session_id, user_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, userId, role, content, new Date().toISOString());
}

function guessActivity(sessionId) {
  const row = db
    .prepare(`SELECT activity FROM sessions WHERE id = ?`)
    .get(sessionId);
  return row ? row.activity : null;
}

/**
 * Envoie le message de l'utilisateur à Mïjium via l'API Gemini et renvoie la réponse.
 */
async function askMii({ sessionId, userId, userMessage, user }) {
  if (!GEMINI_API_KEY) {
    throw new Error("La clé GEMINI_API_KEY n'est pas configurée dans le fichier .env");
  }

  const history = getHistory(sessionId);
  const systemPrompt = buildSystemPrompt({
    displayName: user.display_name,
    knownActivity: guessActivity(sessionId),
    subscriptionStatus: user.subscription_status,
    aiTone: user.ai_tone,
  });

  // URL officielle de l'API Gemini pour le chat
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Construction de la structure de la requête pour Gemini
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userMessage }] }
  ];

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: contents,
    generationConfig: {
      maxOutputTokens: 1024,
    }
  };

  let response;
  try {
    response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    throw Object.assign(
      new Error(`Impossible de joindre l'API Gemini. Vérifiez votre connexion internet.`),
      { code: "GEMINI_UNREACHABLE", cause: networkErr }
    );
  }

  if (!response.ok) {
    const errText = await response.text();
    throw Object.assign(
      new Error(`Erreur API Gemini (${response.status}) : ${errText}`),
      { code: "GEMINI_ERROR", status: response.status }
    );
  }

  const data = await response.json();
  
  // Extraction du texte de la réponse renvoyée par Gemini
  const replyText = 
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;

  if (!replyText) {
    throw new Error("Réponse vide reçue de l'API Gemini.");
  }

  // Enregistre les messages en base de données
  saveMessage({ sessionId, userId, role: "user", content: userMessage });
  saveMessage({ sessionId, userId, role: "assistant", content: replyText });

  return replyText;
}

module.exports = { askMii, getHistory, saveMessage };