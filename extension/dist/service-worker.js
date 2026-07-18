"use strict";
(() => {
  // src/service-worker.ts
  var DEFAULT_CONFIG = {
    backendUrl: "http://localhost:8001",
    apiToken: "change-me-to-a-long-random-token"
  };
  chrome.runtime.onInstalled.addListener(async () => {
    const current = await chrome.storage.local.get({
      backendUrl: DEFAULT_CONFIG.backendUrl,
      apiToken: DEFAULT_CONFIG.apiToken
    });
    await chrome.storage.local.set({
      ...current,
      backendUrl: current.backendUrl === "http://localhost:8000" ? DEFAULT_CONFIG.backendUrl : current.backendUrl
    });
  });
  chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    handleRequest(request).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  });
  async function handleRequest(request) {
    const config = await chrome.storage.local.get({
      backendUrl: DEFAULT_CONFIG.backendUrl,
      apiToken: DEFAULT_CONFIG.apiToken
    });
    const endpoint = request.type === "capture" ? "/v1/captures" : request.type === "zalo-control" ? "/v1/control/zalo" : request.type === "zalo-login-status" ? "/v1/integrations/zalo/status" : request.type === "zalo-login-start" || request.type === "zalo-login-qr" ? "/v1/integrations/zalo/login/qr" : request.type === "zalo-automation-test" ? "/v1/config/zalo-automation/test" : request.type === "zalo-automation-config-get" || request.type === "zalo-automation-config-save" ? "/v1/config/zalo-automation" : request.type === "google-auth-start" ? "/v1/integrations/google/start" : request.type === "google-sheets-test" ? "/v1/integrations/google-sheets/test" : "/health";
    const isGet = ["health", "zalo-login-status", "zalo-login-qr", "zalo-automation-config-get"].includes(
      request.type
    );
    const init = {
      method: isGet ? "GET" : request.type === "zalo-automation-config-save" ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...request.type === "health" ? {} : { Authorization: `Bearer ${config.apiToken}` }
      }
    };
    if (request.type === "capture") init.body = JSON.stringify(request.payload);
    if (request.type === "zalo-control") init.body = JSON.stringify({ enabled: request.enabled });
    if (request.type === "zalo-automation-config-save") init.body = JSON.stringify(request.config);
    if (request.type === "zalo-automation-test") init.body = JSON.stringify({ phone: request.phone });
    if (request.type === "google-auth-start") init.body = JSON.stringify({});
    if (request.type === "google-sheets-test") init.body = JSON.stringify({ write_test: true });
    const response = await fetch(`${config.backendUrl.replace(/\/$/, "")}${endpoint}`, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((item) => item.msg || "C\u1EA5u h\xECnh kh\xF4ng h\u1EE3p l\u1EC7").join("; ") : `Backend tr\u1EA3 HTTP ${response.status}`;
      return { ok: false, error: detail };
    }
    return { ok: true, data };
  }
})();
