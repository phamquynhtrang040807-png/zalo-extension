import type { ExtensionConfig, RuntimeRequest, RuntimeResponse } from "./types";

const DEFAULT_CONFIG: ExtensionConfig = {
  backendUrl: "http://localhost:8000",
  apiToken: "change-me-to-a-long-random-token"
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get({
    backendUrl: DEFAULT_CONFIG.backendUrl,
    apiToken: DEFAULT_CONFIG.apiToken
  });
  await chrome.storage.local.set(current);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  handleRequest(request).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  const config = (await chrome.storage.local.get({
    backendUrl: DEFAULT_CONFIG.backendUrl,
    apiToken: DEFAULT_CONFIG.apiToken
  })) as ExtensionConfig;
  const endpoint =
    request.type === "capture"
      ? "/v1/captures"
      : request.type === "zalo-control"
        ? "/v1/control/zalo"
        : request.type === "zalo-login-status"
          ? "/v1/integrations/zalo/status"
          : request.type === "zalo-login-start" || request.type === "zalo-login-qr"
            ? "/v1/integrations/zalo/login/qr"
        : request.type === "google-auth-start"
          ? "/v1/integrations/google/start"
          : request.type === "google-sheets-test"
            ? "/v1/integrations/google-sheets/test"
        : "/health";
  const isGet = ["health", "zalo-login-status", "zalo-login-qr"].includes(request.type);
  const init: RequestInit = {
    method: isGet ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.type === "health" ? {} : { Authorization: `Bearer ${config.apiToken}` })
    }
  };
  if (request.type === "capture") init.body = JSON.stringify(request.payload);
  if (request.type === "zalo-control") init.body = JSON.stringify({ enabled: request.enabled });
  if (request.type === "google-auth-start") init.body = JSON.stringify({});
  if (request.type === "google-sheets-test") init.body = JSON.stringify({ write_test: true });

  const response = await fetch(`${config.backendUrl.replace(/\/$/, "")}${endpoint}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : `Backend trả HTTP ${response.status}`;
    return { ok: false, error: detail };
  }
  return { ok: true, data };
}
