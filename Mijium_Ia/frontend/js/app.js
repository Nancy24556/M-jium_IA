// js/app.js — Logique de l'application (état, navigation, chat).

(function () {
  "use strict";

  const state = {
    user: null,
    sessionId: null,
    sending: false,
  };

  const el = (id) => document.getElementById(id);

  function show(elm) { elm.classList.remove("hidden"); }
  function hide(elm) { elm.classList.add("hidden"); }

  // ---------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    // Capture un éventuel lien de parrainage (?ref=CODE) dans le formulaire d'inscription
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      document.querySelector('#form-register input[name="referralCode"]').value = ref;
    }

    wireAuthForms();
    wireTabs();
    wireChat();
    wireRewardsView();
    wireProfileView();
    wirePaywall();

    const token = Api.TokenStore.get();
    if (!token) {
      goToAuth();
      return;
    }

    try {
      await loadProfile();
      goToMain();
      await resumeOrStartSession();
    } catch (err) {
      Api.TokenStore.clear();
      goToAuth();
    }
  }

  // ---------------------------------------------------------------
  // Persistance de la session en cours (évite de consommer le quota
  // gratuit à chaque simple rechargement de la page/app)
  // ---------------------------------------------------------------
  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function saveSessionRef(sessionId) {
    try {
      localStorage.setItem("mii_session_id", sessionId);
      localStorage.setItem("mii_session_date", todayKey());
    } catch (e) { /* stockage indisponible : tant pis, pas bloquant */ }
  }

  function getSavedSessionRef() {
    try {
      const id = localStorage.getItem("mii_session_id");
      const date = localStorage.getItem("mii_session_date");
      if (id && date === todayKey()) return id;
    } catch (e) { /* ignore */ }
    return null;
  }

  async function resumeOrStartSession() {
    const saved = getSavedSessionRef();
    if (saved) {
      try {
        const { history } = await Api.history(saved);
        state.sessionId = saved;
        el("chat-log").innerHTML = "";
        if (history.length === 0) {
          appendAssistantMessage(
            "Salut, je suis Mï 👋 Sur quelle activité veux-tu qu'on avance aujourd'hui, et où en es-tu déjà ?"
          );
        } else {
          history.forEach((m) =>
            appendMessage(m.content, m.role === "user" ? "msg-user" : "msg-assistant")
          );
        }
        return;
      } catch (e) {
        // La session sauvegardée n'existe plus côté serveur : on repart proprement.
      }
    }
    await startNewSession();
  }

  function goToAuth() {
    hide(el("screen-loading"));
    hide(el("screen-main"));
    show(el("screen-auth"));
  }

  function goToMain() {
    hide(el("screen-loading"));
    hide(el("screen-auth"));
    show(el("screen-main"));
  }

  // ---------------------------------------------------------------
  // Authentification
  // ---------------------------------------------------------------
  function wireAuthForms() {
    document.querySelectorAll(".tab[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab[data-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const isLogin = btn.dataset.tab === "login";
        el("form-login").classList.toggle("hidden", !isLogin);
        el("form-register").classList.toggle("hidden", isLogin);
      });
    });

    el("form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errBox = document.querySelector('[data-error-for="login"]');
      errBox.textContent = "";
      const fd = new FormData(e.target);
      try {
        const res = await Api.login({ email: fd.get("email"), password: fd.get("password") });
        Api.TokenStore.set(res.token);
        await loadProfile();
        goToMain();
        await resumeOrStartSession();
      } catch (err) {
        errBox.textContent = err.error || "Connexion impossible.";
      }
    });

    el("form-register").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errBox = document.querySelector('[data-error-for="register"]');
      errBox.textContent = "";
      const fd = new FormData(e.target);
      try {
        const res = await Api.register({
          displayName: fd.get("displayName"),
          email: fd.get("email"),
          password: fd.get("password"),
          referralCode: fd.get("referralCode") || undefined,
        });
        Api.TokenStore.set(res.token);
        await loadProfile();
        goToMain();
        await startNewSession();
      } catch (err) {
        errBox.textContent = err.error || "Inscription impossible.";
      }
    });
  }

  async function loadProfile() {
    state.user = await Api.me();
    renderStatusPill();
    renderProfileView();
    renderRewardsView();
  }

  // ---------------------------------------------------------------
  // Navigation par onglets (Guidage / Progrès / Profil)
  // ---------------------------------------------------------------
  function wireTabs() {
    document.querySelectorAll(".tab-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        ["chat", "rewards", "profile"].forEach((v) => {
          el(`view-${v}`).classList.toggle("hidden", v !== btn.dataset.view);
        });
      });
    });
  }

  function renderStatusPill() {
    const pill = el("status-pill");
    const u = state.user;
    if (!u) return;
    if (u.subscriptionStatus === "trial") {
      pill.textContent = `Essai · ${u.trialDaysLeft} j restant(s)`;
    } else if (u.subscriptionStatus === "premium") {
      pill.textContent = "Premium";
    } else {
      pill.textContent = `Gratuit · ${u.freeSessionsUsedToday}/${u.freeSessionsPerDay} aujourd'hui`;
    }
  }

  // ---------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------
  function wireChat() {
    el("form-chat").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = el("chat-input");
      const text = input.value.trim();
      if (!text || state.sending) return;
      input.value = "";
      await sendChatMessage(text);
    });

    el("btn-new-session").addEventListener("click", async () => {
      el("chat-log").innerHTML = "";
      await startNewSession();
    });
  }

  async function startNewSession() {
    appendSystemMessage("Nouvelle session…");
    try {
      const res = await Api.startSession();
      state.sessionId = res.sessionId;
      saveSessionRef(res.sessionId);
      clearSystemMessages();
      appendAssistantMessage(
        "Salut, je suis Mï 👋 Sur quelle activité veux-tu qu'on avance aujourd'hui, et où en es-tu déjà ?"
      );
      await loadProfile();
    } catch (err) {
      clearSystemMessages();
      if (err.status === 402) {
        openPaywall(err.message);
      } else {
        appendSystemMessage(err.error || "Impossible de démarrer une session.");
      }
    }
  }

  async function sendChatMessage(text) {
    appendUserMessage(text);
    state.sending = true;
    const typingNode = appendSystemMessage("Mï réfléchit…");
    try {
      const res = await Api.sendMessage(state.sessionId, text);
      typingNode.remove();
      appendAssistantMessage(res.reply);
    } catch (err) {
      typingNode.remove();
      appendSystemMessage(err.error || "Mï n'a pas pu répondre. Réessaie.");
    } finally {
      state.sending = false;
    }
  }

  function appendUserMessage(text) { appendMessage(text, "msg-user"); }
  function appendAssistantMessage(text) { appendMessage(text, "msg-assistant"); }
  function appendSystemMessage(text) { return appendMessage(text, "msg-system"); }

  function appendMessage(text, cls) {
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    div.textContent = text;
    el("chat-log").appendChild(div);
    el("chat-log").scrollTop = el("chat-log").scrollHeight;
    return div;
  }

  function clearSystemMessages() {
    document.querySelectorAll(".msg-system").forEach((n) => n.remove());
  }

  // ---------------------------------------------------------------
  // Progrès / Récompenses / Parrainage
  // ---------------------------------------------------------------
  function wireRewardsView() {
    el("btn-copy-referral").addEventListener("click", async () => {
      const input = el("referral-link");
      input.select();
      try {
        await navigator.clipboard.writeText(input.value);
        el("btn-copy-referral").textContent = "Copié !";
        setTimeout(() => (el("btn-copy-referral").textContent = "Copier"), 1500);
      } catch (e) { /* clipboard indisponible : la sélection reste visible */ }
    });
  }

  function renderRewardsView() {
    const u = state.user;
    if (!u || !u.rewards) return;
    el("streak-number").textContent = u.rewards.streak;
    el("referral-link").value = u.referralLink;

    const list = el("unlocked-list");
    list.innerHTML = "";
    if (u.rewards.unlocked.length === 0) {
      list.innerHTML = `<li class="muted">Rien débloqué pour l'instant — continue chaque jour !</li>`;
    } else {
      u.rewards.unlocked.forEach((label) => {
        const li = document.createElement("li");
        li.textContent = label;
        list.appendChild(li);
      });
    }

    if (u.rewards.nextMilestone) {
      show(el("next-milestone"));
      el("next-milestone-text").textContent =
        `${u.rewards.nextMilestone.label} à ${u.rewards.nextMilestone.daysNeeded} jours d'affilée`;
    } else {
      hide(el("next-milestone"));
    }
  }

  // ---------------------------------------------------------------
  // Profil / Abonnement
  // ---------------------------------------------------------------
  function wireProfileView() {
    el("btn-subscribe").addEventListener("click", doSubscribe);
    el("btn-cancel").addEventListener("click", async () => {
      await Api.cancelSubscription();
      await loadProfile();
    });
    el("btn-logout").addEventListener("click", () => {
      Api.TokenStore.clear();
      try {
        localStorage.removeItem("mii_session_id");
        localStorage.removeItem("mii_session_date");
      } catch (e) { /* ignore */ }
      window.location.reload();
    });
  }

  async function doSubscribe() {
    const res = await Api.subscribe();
    if (res.mode === "stripe" && res.checkoutUrl) {
      window.location.href = res.checkoutUrl;
      return;
    }
    await loadProfile();
    closePaywall();
  }

  function renderProfileView() {
    const u = state.user;
    if (!u) return;
    el("profile-email").textContent = u.email;

    const statusText = el("subscription-status-text");
    const btnSub = el("btn-subscribe");
    const btnCancel = el("btn-cancel");

    if (u.subscriptionStatus === "trial") {
      statusText.textContent = `Essai Premium actif — ${u.trialDaysLeft} jour(s) restant(s).`;
      show(btnSub); hide(btnCancel);
      btnSub.textContent = "Passer Premium dès maintenant";
    } else if (u.subscriptionStatus === "premium") {
      statusText.textContent = `Abonnement Premium actif${u.premiumUntil ? " jusqu'au " + formatDate(u.premiumUntil) : ""}.`;
      hide(btnSub); show(btnCancel);
    } else {
      statusText.textContent = `Offre gratuite — ${u.freeSessionsUsedToday}/${u.freeSessionsPerDay} sessions utilisées aujourd'hui.`;
      show(btnSub); hide(btnCancel);
      btnSub.textContent = "Passer Premium";
    }
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString("fr-FR"); } catch (e) { return iso; }
  }

  // ---------------------------------------------------------------
  // Paywall (modale)
  // ---------------------------------------------------------------
  function wirePaywall() {
    el("btn-paywall-subscribe").addEventListener("click", doSubscribe);
    el("btn-paywall-close").addEventListener("click", closePaywall);
  }

  function openPaywall(message) {
    el("paywall-message").textContent =
      message || "Tu as atteint la limite de sessions gratuites pour aujourd'hui.";
    show(el("modal-paywall"));
  }
  function closePaywall() { hide(el("modal-paywall")); }
})();
