// agent.js — Logique conversationnelle de Mï : construit l'historique,
// appelle un modèle Ollama en local, et renvoie la réponse. C'est le seul
// fichier qui parle au modèle de langage.

const db = require("./db");
const { buildSystemPrompt } = require("./prompts");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_API_URL = `${OLLAMA_BASE_URL}/api/chat`;
const MODEL = process.env.OLLAMA_MODEL || "llama3";
const MAX_HISTORY_MESSAGES = 24; // fenêtre de mémoire envoyée au modèle à chaque appel

/**
 * Récupère l'historique d'une session, dans l'ordre chronologique,
 * au format attendu par l'API Ollama ({role, content}).
 */
function getHistory(sessionId) {
  // On récupère les N DERNIERS messages (ORDER BY id DESC + LIMIT), puis on
  // remet l'ordre chronologique : sinon, une fois la limite dépassée, Mï
  // resterait bloquée sur les tout premiers messages de la conversation au
  // lieu de se souvenir des plus récents.
  const rows = db
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(sessionId, MAX_HISTORY_MESSAGES);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

function saveMessage({ sessionId, userId, role, content }) {
  db.prepare(
    `INSERT INTO messages (session_id, user_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, userId, role, content, new Date().toISOString());
}

/**
 * Devine l'activité en cours à partir des tout premiers messages de la
 * session (utilisé seulement pour affichage / statistiques, jamais bloquant).
 */
function guessActivity(sessionId) {
  const row = db
    .prepare(`SELECT activity FROM sessions WHERE id = ?`)
    .get(sessionId);
  return row ? row.activity : null;
}

/**
 * Envoie le message de l'utilisateur à Mï (via Ollama, en local) et renvoie
 * la réponse texte. Lève une erreur si Ollama n'est pas joignable ou si
 * l'appel échoue.
 */
async function askMii({ sessionId, userId, userMessage, user }) {
  const history = getHistory(sessionId);
  const systemPrompt = buildSystemPrompt({
    displayName: user.display_name,
    knownActivity: guessActivity(sessionId),
    subscriptionStatus: user.subscription_status,
  });

  // Ollama attend un message "system" au sein du même tableau `messages`
  // (contrairement à l'API Anthropic qui a un champ `system` séparé).
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  let response;
  try {
    response = await fetch(OLLAMA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options: {
          num_predict: 1024,
        },
      }),
    });
  } catch (networkErr) {
    // fetch échoue (ECONNREFUSED, etc.) quand le serveur Ollama n'est pas
    // lancé ou n'est pas joignable à OLLAMA_BASE_URL.
    throw Object.assign(
      new Error(
        `Impossible de joindre Ollama sur ${OLLAMA_BASE_URL}. Vérifiez qu'il est lancé (\`ollama serve\`) et que le modèle "${MODEL}" est bien téléchargé (\`ollama pull ${MODEL}\`).`
      ),
      { code: "OLLAMA_UNREACHABLE", cause: networkErr }
    );
  }

  if (!response.ok) {
    const errText = await response.text();
    throw Object.assign(
      new Error(`Erreur API Ollama (${response.status}) : ${errText}`),
      { code: "OLLAMA_ERROR", status: response.status }
    );
  }

  const data = await response.json();
  const replyText = (data.message && data.message.content) || "";

  // Persiste les deux messages pour que la mémoire fonctionne au tour suivant
  saveMessage({ sessionId, userId, role: "user", content: userMessage });
  saveMessage({ sessionId, userId, role: "assistant", content: replyText });

  return replyText;
}

module.exports = { askMii, getHistory, saveMessage };
