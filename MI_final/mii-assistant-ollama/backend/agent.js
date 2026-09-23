// agent.js — Logique conversationnelle de Mïjium avec l'API Gemini.

const { GoogleGenerativeAI } = require("@google/generative-ai");
const db = require("./db");
const { buildSystemPrompt } = require("./prompts");

// Initialisation avec la classe correcte
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-1.5-flash";
const MAX_HISTORY_MESSAGES = 24;

function getHistory(sessionId) {
  const rows = db
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(sessionId, MAX_HISTORY_MESSAGES);
  
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

async function askMii({ sessionId, userId, userMessage, user }) {
  const history = getHistory(sessionId);
  const systemPrompt = buildSystemPrompt({
    displayName: user.display_name,
    knownActivity: guessActivity(sessionId),
    subscriptionStatus: user.subscription_status,
    aiTone: user.ai_tone,
  });

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: systemPrompt,
    });

    const chat = model.startChat({
      history: history,
    });

    const result = await chat.sendMessage(userMessage);
    const replyText = result.response.text() || "";

    saveMessage({ sessionId, userId, role: "user", content: userMessage });
    saveMessage({ sessionId, userId, role: "assistant", content: replyText });

    return replyText;
  } catch (err) {
    console.error("Erreur Gemini:", err);
    throw Object.assign(
      new Error(`Impossible de contacter Gemini : ${err.message}`),
      { code: "GEMINI_ERROR", cause: err }
    );
  }
}

module.exports = { askMii, getHistory, saveMessage };