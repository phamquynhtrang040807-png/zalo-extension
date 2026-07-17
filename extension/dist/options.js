"use strict";
(() => {
  // src/options.ts
  var backendUrl = document.querySelector("#backendUrl");
  var apiToken = document.querySelector("#apiToken");
  var statusBox = document.querySelector("#status");
  var zaloLoginStatus = document.querySelector("#zaloLoginStatus");
  var zaloQr = document.querySelector("#zaloQr");
  var zaloPollTimer;
  void load();
  document.querySelector("#save").addEventListener("click", save);
  document.querySelector("#test").addEventListener("click", () => request({ type: "health" }));
  document.querySelector("#googleConnect").addEventListener("click", connectGoogle);
  document.querySelector("#googleTest").addEventListener("click", () => request({ type: "google-sheets-test" }));
  document.querySelector("#zaloLogin").addEventListener("click", startZaloLogin);
  document.querySelector("#zaloRefresh").addEventListener("click", () => refreshZaloLogin());
  document.querySelector("#pause").addEventListener("click", () => request({ type: "zalo-control", enabled: false }));
  document.querySelector("#resume").addEventListener("click", () => request({ type: "zalo-control", enabled: true }));
  async function load() {
    const stored = await chrome.storage.local.get({
      backendUrl: "http://localhost:8000",
      apiToken: "change-me-to-a-long-random-token"
    });
    backendUrl.value = stored.backendUrl;
    apiToken.value = stored.apiToken;
    await refreshZaloLogin(false);
  }
  async function save() {
    const url = backendUrl.value.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) {
      statusBox.textContent = "Backend URL ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://";
      return;
    }
    await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
    statusBox.textContent = "\u0110\xE3 l\u01B0u c\u1EA5u h\xECnh.";
    await refreshZaloLogin(false);
  }
  async function sendRuntime(message) {
    return await chrome.runtime.sendMessage(message);
  }
  async function request(message) {
    statusBox.textContent = "\u0110ang x\u1EED l\xFD\u2026";
    const response = await sendRuntime(message);
    statusBox.textContent = response.ok ? JSON.stringify(response.data, null, 2) : `L\u1ED7i: ${response.error || "Kh\xF4ng x\xE1c \u0111\u1ECBnh"}`;
  }
  var zaloStateLabels = {
    logged_out: "Ch\u01B0a \u0111\u0103ng nh\u1EADp",
    restoring_session: "\u0110ang kh\xF4i ph\u1EE5c phi\xEAn\u2026",
    session_expired: "Phi\xEAn \u0111\xE3 h\u1EBFt h\u1EA1n \u2014 h\xE3y t\u1EA1o QR m\u1EDBi",
    generating_qr: "\u0110ang t\u1EA1o m\xE3 QR\u2026",
    waiting_for_scan: "H\xE3y qu\xE9t m\xE3 QR b\xEAn d\u01B0\u1EDBi",
    waiting_for_confirmation: "\u0110\xE3 qu\xE9t \u2014 h\xE3y x\xE1c nh\u1EADn tr\xEAn \u0111i\u1EC7n tho\u1EA1i",
    qr_expired: "QR \u0111\xE3 h\u1EBFt h\u1EA1n \u2014 h\xE3y t\u1EA1o QR m\u1EDBi",
    qr_declined: "\u0110\u0103ng nh\u1EADp \u0111\xE3 b\u1ECB t\u1EEB ch\u1ED1i",
    finishing_login: "\u0110ang ho\xE0n t\u1EA5t \u0111\u0103ng nh\u1EADp\u2026",
    authenticated: "\u0110\xE3 \u0111\u0103ng nh\u1EADp",
    login_failed: "\u0110\u0103ng nh\u1EADp th\u1EA5t b\u1EA1i"
  };
  async function startZaloLogin() {
    window.clearTimeout(zaloPollTimer);
    zaloLoginStatus.className = "";
    zaloLoginStatus.textContent = "\u0110ang y\xEAu c\u1EA7u m\xE3 QR\u2026";
    zaloQr.style.display = "none";
    const response = await sendRuntime({ type: "zalo-login-start" });
    if (!response.ok) {
      renderZaloError(response.error || "Kh\xF4ng th\u1EC3 b\u1EAFt \u0111\u1EA7u \u0111\u0103ng nh\u1EADp Zalo");
      return;
    }
    await refreshZaloLogin(true);
  }
  async function refreshZaloLogin(keepPolling = false) {
    window.clearTimeout(zaloPollTimer);
    const response = await sendRuntime({ type: "zalo-login-status" });
    if (!response.ok || !response.data) {
      renderZaloError(response.error || "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c tr\u1EA1ng th\xE1i Zalo");
      return;
    }
    const state = response.data;
    const accountName = state.account?.display_name ? ` \u2014 ${state.account.display_name}` : "";
    const safety = state.force_recipient_enabled ? `; \u0111ang kh\xF3a ng\u01B0\u1EDDi nh\u1EADn \u2026${state.force_recipient_last4 || ""}` : "; \u0111ang d\xF9ng s\u1ED1 c\u1EE7a t\u1EEBng lead";
    zaloLoginStatus.textContent = `${zaloStateLabels[state.state] || state.state}${accountName}${safety}`;
    zaloLoginStatus.className = state.logged_in ? "ok" : state.error ? "error" : "";
    if (state.error) zaloLoginStatus.textContent += ` \u2014 ${state.error}`;
    if (state.qr_ready) {
      const qrResponse = await sendRuntime({ type: "zalo-login-qr" });
      if (qrResponse.ok && qrResponse.data?.image_data_url) {
        zaloQr.src = qrResponse.data.image_data_url;
        zaloQr.style.display = "block";
      }
    } else {
      zaloQr.style.display = "none";
      zaloQr.removeAttribute("src");
    }
    const activeLogin = [
      "generating_qr",
      "waiting_for_scan",
      "waiting_for_confirmation",
      "finishing_login",
      "restoring_session"
    ].includes(state.state);
    if (keepPolling && activeLogin) {
      zaloPollTimer = window.setTimeout(() => refreshZaloLogin(true), 1500);
    }
  }
  function renderZaloError(message) {
    zaloLoginStatus.className = "error";
    zaloLoginStatus.textContent = `L\u1ED7i: ${message}`;
    zaloQr.style.display = "none";
  }
  async function connectGoogle() {
    statusBox.textContent = "\u0110ang t\u1EA1o li\xEAn k\u1EBFt c\u1EA5p quy\u1EC1n Google\u2026";
    const response = await chrome.runtime.sendMessage({
      type: "google-auth-start"
    });
    if (!response.ok || !response.data?.authorization_url) {
      statusBox.textContent = `L\u1ED7i: ${response.error || "Kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c li\xEAn k\u1EBFt Google"}`;
      return;
    }
    statusBox.textContent = `\u0110ang m\u1EDF Google. Redirect URI \u0111\xE3 c\u1EA5u h\xECnh: ${response.data.redirect_uri}`;
    await chrome.tabs.create({ url: response.data.authorization_url });
  }
})();
