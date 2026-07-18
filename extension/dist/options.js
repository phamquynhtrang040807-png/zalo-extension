"use strict";
(() => {
  // src/options.ts
  var backendUrl = document.querySelector("#backendUrl");
  var apiToken = document.querySelector("#apiToken");
  var statusBox = document.querySelector("#status");
  var zaloLoginStatus = document.querySelector("#zaloLoginStatus");
  var zaloQr = document.querySelector("#zaloQr");
  var zaloMessages = document.querySelector("#zaloMessages");
  var zaloTestPhone = document.querySelector("#zaloTestPhone");
  var testZaloAutomationButton = document.querySelector("#testZaloAutomation");
  var zaloPollTimer;
  var DEFAULT_AUTOMATION = {
    friend_request_message: "Kh\xF4ng s\u1EED d\u1EE5ng l\u1EDDi m\u1EDDi k\u1EBFt b\u1EA1n",
    messages: ["Ch\xE0o b\u1EA1n, m\xECnh l\xE0 Trang Ph\u1EA1m, \u0111\u1EBFn t\u1EEB JUSTDUN - brand chuy\xEAn v\u1EC1 th\u1EDDi trang n\u1EEF"]
  };
  void load();
  document.querySelector("#save").addEventListener("click", save);
  document.querySelector("#test").addEventListener("click", () => request({ type: "health" }));
  document.querySelector("#googleConnect").addEventListener("click", connectGoogle);
  document.querySelector("#googleTest").addEventListener("click", () => request({ type: "google-sheets-test" }));
  document.querySelector("#zaloLogin").addEventListener("click", startZaloLogin);
  document.querySelector("#zaloRefresh").addEventListener("click", () => refreshZaloLogin());
  document.querySelector("#addZaloMessage").addEventListener("click", () => addMessageRow(""));
  testZaloAutomationButton.addEventListener("click", testZaloAutomation);
  document.querySelector("#pause").addEventListener("click", () => request({ type: "zalo-control", enabled: false }));
  document.querySelector("#resume").addEventListener("click", () => request({ type: "zalo-control", enabled: true }));
  async function load() {
    const stored = await chrome.storage.local.get({
      backendUrl: "https://kol.aipencil.name.vn",
      apiToken: "change-me-to-a-long-random-token"
    });
    if (stored.backendUrl === "http://localhost:8000") {
      stored.backendUrl = "http://localhost:8001";
      await chrome.storage.local.set({ backendUrl: stored.backendUrl });
    }
    backendUrl.value = stored.backendUrl;
    apiToken.value = stored.apiToken;
    await loadAutomationConfig();
    await refreshZaloLogin(false);
  }
  async function save() {
    const url = backendUrl.value.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) {
      statusBox.textContent = "Backend URL ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://";
      return;
    }
    await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
    const automation = readAutomationConfig();
    if (!automation) return;
    const response = await sendRuntime({
      type: "zalo-automation-config-save",
      config: automation
    });
    if (!response.ok) {
      statusBox.textContent = `L\u1ED7i l\u01B0u automation: ${response.error || "Kh\xF4ng x\xE1c \u0111\u1ECBnh"}`;
      return;
    }
    statusBox.textContent = `\u0110\xE3 l\u01B0u c\u1EA5u h\xECnh v\u1EDBi ${automation.messages.length} tin nh\u1EAFn t\u1EF1 \u0111\u1ED9ng.`;
    await refreshZaloLogin(false);
  }
  async function loadAutomationConfig() {
    const response = await sendRuntime({ type: "zalo-automation-config-get" });
    renderAutomationConfig(response.ok && response.data ? response.data : DEFAULT_AUTOMATION);
    if (!response.ok) {
      statusBox.textContent = `Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c automation t\u1EEB backend: ${response.error || "Kh\xF4ng x\xE1c \u0111\u1ECBnh"}`;
    }
  }
  function renderAutomationConfig(config) {
    zaloMessages.replaceChildren();
    for (const message of config.messages) addMessageRow(message);
  }
  function addMessageRow(value) {
    if (zaloMessages.querySelectorAll("textarea").length >= 20) {
      statusBox.textContent = "Ch\u1EC9 \u0111\u01B0\u1EE3c c\u1EA5u h\xECnh t\u1ED1i \u0111a 20 tin nh\u1EAFn t\u1EF1 \u0111\u1ED9ng.";
      return;
    }
    const row = document.createElement("div");
    row.className = "message-row";
    const textarea = document.createElement("textarea");
    textarea.maxLength = 5e3;
    textarea.placeholder = "Nh\u1EADp n\u1ED9i dung tin nh\u1EAFn t\u1EF1 \u0111\u1ED9ng";
    textarea.value = value;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "X\xF3a";
    remove.title = "X\xF3a tin nh\u1EAFn n\xE0y";
    remove.addEventListener("click", () => row.remove());
    row.append(textarea, remove);
    zaloMessages.append(row);
  }
  function readAutomationConfig() {
    const textareas = Array.from(zaloMessages.querySelectorAll("textarea"));
    const messages = textareas.map((textarea) => textarea.value.trim());
    const emptyIndex = messages.findIndex((message) => !message);
    if (emptyIndex >= 0) {
      statusBox.textContent = "Tin nh\u1EAFn t\u1EF1 \u0111\u1ED9ng kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng; h\xE3y nh\u1EADp n\u1ED9i dung ho\u1EB7c x\xF3a d\xF2ng.";
      textareas[emptyIndex].focus();
      return null;
    }
    return { friend_request_message: DEFAULT_AUTOMATION.friend_request_message, messages };
  }
  async function testZaloAutomation() {
    const phone = zaloTestPhone.value.trim();
    if (!phone) {
      statusBox.textContent = "H\xE3y nh\u1EADp s\u1ED1 \u0111i\u1EC7n tho\u1EA1i \u0111\u1EC3 g\u1EEDi th\u1EED.";
      zaloTestPhone.focus();
      return;
    }
    const url = backendUrl.value.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) {
      statusBox.textContent = "Backend URL ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng http:// ho\u1EB7c https://";
      return;
    }
    const automation = readAutomationConfig();
    if (!automation) return;
    testZaloAutomationButton.disabled = true;
    statusBox.textContent = "\u0110ang l\u01B0u c\u1EA5u h\xECnh v\xE0 g\u1EEDi tin nh\u1EAFn th\u1EED\u2026";
    try {
      await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
      const saved = await sendRuntime({
        type: "zalo-automation-config-save",
        config: automation
      });
      if (!saved.ok) throw new Error(saved.error || "Kh\xF4ng l\u01B0u \u0111\u01B0\u1EE3c c\u1EA5u h\xECnh automation");
      const response = await sendRuntime({
        type: "zalo-automation-test",
        phone
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error || "Kh\xF4ng g\u1EEDi \u0111\u01B0\u1EE3c tin nh\u1EAFn th\u1EED");
      }
      const safety = response.data.force_recipient_enabled ? ` Safety lock \u0111\xE3 chuy\u1EC3n t\u1EDBi \u2026${response.data.effective_recipient_last4}.` : "";
      statusBox.textContent = `${response.data.message}.${safety}`;
    } catch (error) {
      statusBox.textContent = `L\u1ED7i g\u1EEDi th\u1EED: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      testZaloAutomationButton.disabled = false;
    }
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
