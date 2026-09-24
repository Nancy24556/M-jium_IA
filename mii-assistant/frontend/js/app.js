// js/app.js — Logique de l'application (état, navigation, chat).

(function () {
  "use strict";

  const state = {
    user: null,
    sessionId: null,
    sending: false,
    sessions: [],
  };

  const AVATAR_OPTIONS = ["🙂", "😎", "🚀", "🌟", "🦊", "🐼", "🎯", "🌈", "🔥", "🧠"];

  const el = (id) => document.getElementById(id);

  function show(elm) { elm.classList.remove("hidden"); }
  function hide(elm) { elm.classList.add("hidden"); }

  // ---------------------------------------------------------------
  // Toasts (petites notifications éphémères : bienvenue, paiement...)
  // ---------------------------------------------------------------
  function showToast(message, { type = "info", icon = "🎉", duration = 5000 } = {}) {
    const container = el("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML =
      `<span class="toast-icon">${icon}</span>` +
      `<span class="toast-body"></span>` +
      `<button type="button" class="toast-close" aria-label="Fermer">✕</button>`;
    toast.querySelector(".toast-body").textContent = message;

    const remove = () => {
      toast.classList.remove("toast-show");
      setTimeout(() => toast.remove(), 250);
    };
    toast.querySelector(".toast-close").addEventListener("click", remove);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast-show"));
    if (duration > 0) setTimeout(remove, duration);
  }

  // ---------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    const splashStart = Date.now();
    // Capture un éventuel lien de parrainage (?ref=CODE) dans le formulaire d'inscription
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      document.querySelector('#form-register input[name="referralCode"]').value = ref;
    }

    // Retour depuis Stripe Checkout (paiement réel) : ?premium=success|cancel
    const premiumParam = params.get("premium");
    if (premiumParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    wireAuthForms();
    wireTabs();
    wireChat();
    wireRewardsView();
    wireProfileView();
    wirePaywall();
    wireHistorySidebar();
    wireTheme();
    wireExportMenu();
    wireAdminView();

    const token = Api.TokenStore.get();
    if (!token) {
      await revealApp(splashStart);
      goToAuth();
      return;
    }

    try {
      await loadProfile();
      await revealApp(splashStart);
      goToMain();
      await resumeOrStartSession();
      if (premiumParam === "success") {
        showToast("Paiement confirmé, ton abonnement Premium est actif 🎉", { type: "success", icon: "💳" });
      } else if (premiumParam === "cancel") {
        showToast("Paiement annulé — tu peux réessayer à tout moment depuis ton profil.", { type: "info", icon: "ℹ️" });
      }
    } catch (err) {
      Api.TokenStore.clear();
      await revealApp(splashStart);
      goToAuth();
    }
  }

  /** Laisse le petit logo « poper » au moins un court instant avant de le retirer. */
  async function revealApp(startedAt) {
    const minDelay = 550;
    const elapsed = Date.now() - startedAt;
    if (elapsed < minDelay) {
      await new Promise((r) => setTimeout(r, minDelay - elapsed));
    }
    el("splash").classList.add("splash-out");
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
        await loadSession(saved, { silent: true });
        return;
      } catch (e) {
        // La session sauvegardée n'existe plus côté serveur : on repart proprement.
      }
    }
    await startNewSession();
  }

  /** Charge une conversation existante (depuis la sidebar ou une reprise). */
  async function loadSession(sessionId, { silent = false } = {}) {
    const { history } = await Api.history(sessionId);
    state.sessionId = sessionId;
    saveSessionRef(sessionId);
    el("chat-log").innerHTML = "";
    if (history.length === 0) {
      appendAssistantMessage(
        "Salut, je suis Mïjium 👋 Sur quelle activité veux-tu qu'on avance aujourd'hui, et où en es-tu déjà ?"
      );
    } else {
      history.forEach((m) =>
        appendMessage(m.content, m.role === "user" ? "msg-user" : "msg-assistant")
      );
    }
    closeHistorySidebar();
    await refreshHistoryList();
    if (!silent) el("view-chat").scrollTop = 0;
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
        const name = res.user && res.user.displayName;
        showToast(
          `Bienvenue${name ? " " + name : ""} ! Ton essai Premium de 7 jours vient de commencer 🎉`,
          { type: "success", icon: "🎉", duration: 6000 }
        );
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
    el("tab-admin").classList.toggle("hidden", state.user.role !== "admin");
  }

  // ---------------------------------------------------------------
  // Navigation par onglets (Guidage / Progrès / Profil)
  // ---------------------------------------------------------------
  function wireTabs() {
    document.querySelectorAll(".tab-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        ["chat", "rewards", "profile", "admin"].forEach((v) => {
          el(`view-${v}`).classList.toggle("hidden", v !== btn.dataset.view);
        });
        if (btn.dataset.view === "admin") loadAdminData();
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
        "Salut, je suis Mïjium 👋 Sur quelle activité veux-tu qu'on avance aujourd'hui, et où en es-tu déjà ?"
      );
      await loadProfile();
      await refreshHistoryList();
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
    const typingNode = appendSystemMessage("Mïjium réfléchit…");
    try {
      const res = await Api.sendMessage(state.sessionId, text);
      typingNode.remove();
      appendAssistantMessage(res.reply);
      await refreshHistoryList();
    } catch (err) {
      typingNode.remove();
      appendSystemMessage(err.error || "Mïjium n'a pas pu répondre. Réessaie.");
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
    el("vip-badge").classList.toggle("hidden", u.subscriptionStatus !== "premium");

    const list = el("unlocked-list");
    list.innerHTML = "";
    if (u.rewards.unlocked.length === 0) {
      list.innerHTML = `<li class="reward-empty">Rien débloqué pour l'instant — continue chaque jour !</li>`;
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
      const pct = Math.min(100, Math.round((u.rewards.streak / u.rewards.nextMilestone.daysNeeded) * 100));
      el("streak-progress-fill").style.width = `${pct}%`;
      const remaining = Math.max(0, u.rewards.nextMilestone.daysNeeded - u.rewards.streak);
      el("streak-progress-text").textContent =
        remaining === 0
          ? "Palier atteint 🎉"
          : `Encore ${remaining} jour(s) d'affilée pour : ${u.rewards.nextMilestone.label}`;
    } else {
      hide(el("next-milestone"));
      el("streak-progress-fill").style.width = "100%";
      el("streak-progress-text").textContent = "Tous les paliers sont débloqués — bravo !";
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

    const picker = el("avatar-picker");
    AVATAR_OPTIONS.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-opt";
      btn.textContent = emoji;
      btn.dataset.avatar = emoji;
      btn.addEventListener("click", () => {
        picker.querySelectorAll(".avatar-opt").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.pendingAvatarPhoto = null; // choisir un emoji annule la photo en attente
        el("avatar-preview").textContent = emoji;
        hide(el("btn-remove-photo"));
      });
      picker.appendChild(btn);
    });

    el("btn-upload-photo").addEventListener("click", () => el("input-avatar-photo").click());

    el("input-avatar-photo").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageToDataUrl(file, 256);
        state.pendingAvatarPhoto = dataUrl;
        el("avatar-preview").innerHTML = `<img src="${dataUrl}" alt="Aperçu" />`;
        show(el("btn-remove-photo"));
        picker.querySelectorAll(".avatar-opt").forEach((b) => b.classList.remove("active"));
      } catch (err) {
        alert("Impossible de lire cette image. Essaie un autre fichier.");
      } finally {
        e.target.value = "";
      }
    });

    el("btn-remove-photo").addEventListener("click", () => {
      state.pendingAvatarPhoto = "REMOVE";
      const fallback = state.user && state.user.avatar ? state.user.avatar : "🙂";
      el("avatar-preview").textContent = fallback;
      hide(el("btn-remove-photo"));
      picker.querySelectorAll(".avatar-opt").forEach((b) => b.classList.toggle("active", b.dataset.avatar === fallback));
    });

    el("btn-save-profile").addEventListener("click", async () => {
      const selectedAvatar = picker.querySelector(".avatar-opt.active");
      try {
        const payload = {
          displayName: el("profile-display-name").value.trim(),
          avatar: selectedAvatar ? selectedAvatar.dataset.avatar : undefined,
          aiTone: el("profile-ai-tone").value,
        };
        if (state.pendingAvatarPhoto === "REMOVE") {
          payload.avatarPhoto = null;
        } else if (state.pendingAvatarPhoto) {
          payload.avatarPhoto = state.pendingAvatarPhoto;
        }
        await Api.updateMe(payload);
        state.pendingAvatarPhoto = undefined;
        await loadProfile();
        const hint = el("profile-save-hint");
        show(hint);
        setTimeout(() => hide(hint), 1800);
      } catch (err) {
        alert(err.error || "Impossible d'enregistrer le profil pour le moment.");
      }
    });
  }

  /** Redimensionne/compresse une image choisie par l'utilisateur avant envoi. */
  function resizeImageToDataUrl(file, size) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Lecture impossible"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Image invalide"));
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
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
    el("profile-display-name").value = u.displayName || "";
    el("profile-ai-tone").value = u.aiTone || "bienveillant";
    document.querySelectorAll("#avatar-picker .avatar-opt").forEach((b) => {
      b.classList.toggle("active", !u.avatarPhoto && b.dataset.avatar === (u.avatar || "🙂"));
    });
    renderAvatarPreview(u);

    const statusText = el("subscription-status-text");
    const btnSub = el("btn-subscribe");
    const btnCancel = el("btn-cancel");
    const trustPanel = el("trust-panel");

    if (u.subscriptionStatus === "trial") {
      statusText.textContent = `Essai Premium actif — ${u.trialDaysLeft} jour(s) restant(s).`;
      show(btnSub); hide(btnCancel); show(trustPanel);
      btnSub.textContent = "Passer Premium dès maintenant";
    } else if (u.subscriptionStatus === "premium") {
      statusText.textContent = `Abonnement Premium actif${u.premiumUntil ? " jusqu'au " + formatDate(u.premiumUntil) : ""}.`;
      hide(btnSub); show(btnCancel); hide(trustPanel);
    } else {
      statusText.textContent = `Offre gratuite — ${u.freeSessionsUsedToday}/${u.freeSessionsPerDay} sessions utilisées aujourd'hui.`;
      show(btnSub); hide(btnCancel); show(trustPanel);
      btnSub.textContent = "Passer Premium";
    }
  }

  /** Affiche la photo de profil si elle existe, sinon l'emoji choisi. */
  function renderAvatarPreview(u) {
    const preview = el("avatar-preview");
    const removeBtn = el("btn-remove-photo");
    if (u.avatarPhoto) {
      preview.innerHTML = `<img src="${u.avatarPhoto}" alt="Photo de profil" />`;
      show(removeBtn);
    } else {
      preview.textContent = u.avatar || "🙂";
      hide(removeBtn);
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

  // ---------------------------------------------------------------
  // Historique des conversations (barre latérale)
  // ---------------------------------------------------------------
  function wireHistorySidebar() {
    el("btn-open-history").addEventListener("click", async () => {
      show(el("history-overlay"));
      show(el("history-sidebar"));
      await refreshHistoryList();
    });
    el("btn-close-history").addEventListener("click", closeHistorySidebar);
    el("history-overlay").addEventListener("click", closeHistorySidebar);
    el("btn-history-new").addEventListener("click", async () => {
      el("chat-log").innerHTML = "";
      await startNewSession();
      closeHistorySidebar();
    });
  }

  function closeHistorySidebar() {
    hide(el("history-overlay"));
    hide(el("history-sidebar"));
  }

  async function refreshHistoryList() {
    try {
      const { sessions } = await Api.listSessions();
      state.sessions = sessions;
      renderHistoryList();
      const current = sessions.find((s) => s.id === state.sessionId);
      el("chat-title").textContent = current ? current.title : "Nouvelle conversation";
    } catch (e) { /* pas bloquant */ }
  }

  function renderHistoryList() {
    const list = el("history-list");
    list.innerHTML = "";
    if (state.sessions.length === 0) {
      list.innerHTML = `<li class="history-empty">Aucune conversation pour l'instant.</li>`;
      return;
    }
    state.sessions.forEach((s) => {
      const li = document.createElement("li");
      li.className = "history-item" + (s.id === state.sessionId ? " active" : "");

      const titleSpan = document.createElement("span");
      titleSpan.className = "history-item-title";
      titleSpan.textContent = s.title;
      titleSpan.addEventListener("click", () => loadSession(s.id));

      const actions = document.createElement("span");
      actions.className = "history-item-actions";

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>';
      renameBtn.title = "Renommer";
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newTitle = prompt("Renommer la conversation :", s.title);
        if (newTitle && newTitle.trim()) {
          await Api.renameSession(s.id, newTitle.trim());
          await refreshHistoryList();
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1a1.5 1.5 0 0 1-1.5 1.4H8.3a1.5 1.5 0 0 1-1.5-1.4L6 7"/></svg>';
      deleteBtn.title = "Supprimer";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Supprimer « ${s.title} » ? Cette action est définitive.`)) return;
        await Api.deleteSession(s.id);
        if (s.id === state.sessionId) {
          try {
            localStorage.removeItem("mii_session_id");
            localStorage.removeItem("mii_session_date");
          } catch (err) { /* ignore */ }
          el("chat-log").innerHTML = "";
          await startNewSession();
        }
        await refreshHistoryList();
      });

      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(titleSpan);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------
  // Thème clair / sombre
  // ---------------------------------------------------------------
  function wireTheme() {
    const saved = (() => {
      try { return localStorage.getItem("mii_theme") || "auto"; } catch (e) { return "auto"; }
    })();
    applyTheme(saved);

    el("btn-theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "auto";
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const effectiveDark = current === "dark" || (current === "auto" && prefersDark);
      applyTheme(effectiveDark ? "light" : "dark");
    });

    document.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
    });
  }

  function applyTheme(mode) {
    if (mode === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", mode);
    }
    try { localStorage.setItem("mii_theme", mode); } catch (e) { /* ignore */ }

    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = mode === "dark" || (mode === "auto" && prefersDark);
    el("theme-icon-moon").classList.toggle("hidden", isDark);
    el("theme-icon-sun").classList.toggle("hidden", !isDark);

    document.querySelectorAll(".theme-opt").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === mode);
    });
  }

  // ---------------------------------------------------------------
  // Export de la conversation (.txt / .md / PDF via impression)
  // ---------------------------------------------------------------
  function wireExportMenu() {
    el("btn-export").addEventListener("click", (e) => {
      e.stopPropagation();
      el("export-menu").classList.toggle("hidden");
    });
    document.addEventListener("click", () => hide(el("export-menu")));

    document.querySelectorAll("#export-menu [data-export]").forEach((btn) => {
      btn.addEventListener("click", () => {
        hide(el("export-menu"));
        exportConversation(btn.dataset.export);
      });
    });
  }

  function getConversationText() {
    const lines = [];
    document.querySelectorAll("#chat-log .msg:not(.msg-system)").forEach((node) => {
      const who = node.classList.contains("msg-user") ? "Moi" : "Mïjium";
      lines.push(`${who} : ${node.textContent}`);
    });
    return lines.join("\n\n");
  }

  function exportConversation(format) {
    const title = el("chat-title").textContent || "Conversation Mïjium";
    if (format === "pdf") {
      const win = window.open("", "_blank");
      if (!win) { alert("Autorise les fenêtres popup pour exporter en PDF."); return; }
      const escaped = getConversationText()
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>");
      win.document.write(
        `<html><head><title>${title}</title><style>body{font-family:sans-serif;padding:32px;line-height:1.5;} h1{font-size:1.3rem;}</style></head><body><h1>${title}</h1><p>${escaped}</p></body></html>`
      );
      win.document.close();
      win.focus();
      win.print();
      return;
    }

    const content = format === "md"
      ? `# ${title}\n\n` + getConversationText().replace(/^(Moi|Mïjium) : /gm, "**$1 :** ")
      : `${title}\n\n${getConversationText()}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------
  // Administration (visible uniquement pour le compte admin)
  // ---------------------------------------------------------------
  function wireAdminView() {
    // Rien à câbler ici au chargement : les données sont chargées à
    // l'ouverture de l'onglet (voir wireTabs → loadAdminData()).
  }

  function formatCents(cents, currency) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: (currency || "eur").toUpperCase() })
      .format((cents || 0) / 100);
  }

  async function loadAdminData() {
    try {
      const [overview, { transactions }, { users }] = await Promise.all([
        Api.adminOverview(),
        Api.adminTransactions(),
        Api.adminUsers(),
      ]);
      renderAdminOverview(overview);
      renderAdminTransactions(transactions);
      renderAdminUsers(users);
    } catch (e) {
      // Accès refusé ou erreur réseau : on ignore silencieusement, l'onglet
      // n'est de toute façon visible que pour l'admin.
    }
  }

  function renderAdminOverview(o) {
    el("admin-total-users").textContent = o.totalUsers;
    el("admin-premium-users").textContent = o.premiumUsers;
    el("admin-revenue").textContent = formatCents(o.totalRevenueCents, "eur");

    const chart = el("admin-chart");
    chart.innerHTML = "";
    const max = Math.max(1, ...o.revenueByMonth.map((m) => m.totalCents));
    o.revenueByMonth.forEach((m) => {
      const col = document.createElement("div");
      col.className = "admin-chart-col";
      const bar = document.createElement("div");
      bar.className = "admin-chart-bar";
      bar.style.height = `${Math.max(3, (m.totalCents / max) * 100)}px`;
      const label = document.createElement("span");
      label.className = "admin-chart-label";
      label.textContent = m.month.slice(5);
      col.appendChild(bar);
      col.appendChild(label);
      chart.appendChild(col);
    });
  }

  function renderAdminTransactions(rows) {
    const tbody = document.querySelector("#admin-transactions-table tbody");
    tbody.innerHTML = "";
    rows.slice(0, 30).forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${formatDate(t.created_at)}</td><td>${t.user_email}</td>` +
        `<td>${formatCents(t.amount_cents, t.currency)}</td><td>${t.provider}</td><td>${t.status}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderAdminUsers(rows) {
    const tbody = document.querySelector("#admin-users-table tbody");
    tbody.innerHTML = "";
    rows.forEach((u) => {
      const tr = document.createElement("tr");
      const email = document.createElement("td");
      email.textContent = u.email;
      const role = document.createElement("td");
      role.textContent = u.role;
      const status = document.createElement("td");
      status.textContent = u.subscription_status;
      const actions = document.createElement("td");

      const grantBtn = document.createElement("button");
      grantBtn.type = "button";
      grantBtn.textContent = "+30j Premium";
      grantBtn.addEventListener("click", async () => {
        await Api.adminGrantPremium(u.id, 30);
        await loadAdminData();
      });

      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = "Révoquer";
      revokeBtn.addEventListener("click", async () => {
        if (!confirm(`Révoquer le Premium de ${u.email} ?`)) return;
        await Api.adminRevokePremium(u.id);
        await loadAdminData();
      });

      actions.appendChild(grantBtn);
      if (u.role !== "admin") actions.appendChild(revokeBtn);

      tr.appendChild(email);
      tr.appendChild(role);
      tr.appendChild(status);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
  }
})();
