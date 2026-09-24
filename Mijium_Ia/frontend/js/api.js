// js/api.js — Petit client HTTP pour parler au backend Mï.
// Toute l'app appelle des chemins relatifs ("/api/...") : en local et une
// fois publiée, le frontend est servi par le même serveur que l'API. Si vous
// hébergez le frontend ailleurs (ex: dans l'app Android via Capacitor),
// changez API_BASE_URL ci-dessous pour l'URL complète de votre backend.

const API_BASE_URL = window.MII_API_BASE_URL || "";

const TokenStore = {
  get() {
    try { return localStorage.getItem("mii_token"); } catch (e) { return null; }
  },
  set(token) {
    try { localStorage.setItem("mii_token", token); } catch (e) { /* stockage indisponible */ }
  },
  clear() {
    try { localStorage.removeItem("mii_token"); } catch (e) { /* ignore */ }
  },
};

async function apiRequest(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = TokenStore.get();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw { status: 0, error: "Impossible de contacter le serveur. Vérifie ta connexion." };
  }

  let data = {};
  try { data = await response.json(); } catch (e) { /* réponse vide */ }

  if (!response.ok) {
    throw { status: response.status, ...data };
  }
  return data;
}

const Api = {
  register: (payload) => apiRequest("/api/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => apiRequest("/api/auth/login", { method: "POST", body: payload, auth: false }),

  me: () => apiRequest("/api/user/me"),
  updateMe: (payload) => apiRequest("/api/user/me", { method: "PATCH", body: payload }),

  startSession: () => apiRequest("/api/chat/session/start", { method: "POST" }),
  sendMessage: (sessionId, message) =>
    apiRequest("/api/chat/message", { method: "POST", body: { sessionId, message } }),
  history: (sessionId) => apiRequest(`/api/chat/session/${sessionId}/history`),

  subscribe: () => apiRequest("/api/billing/subscribe", { method: "POST" }),
  cancelSubscription: () => apiRequest("/api/billing/cancel", { method: "POST" }),

  rewardsSummary: () => apiRequest("/api/rewards/summary"),

  TokenStore,
};
