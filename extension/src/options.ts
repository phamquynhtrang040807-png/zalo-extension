import type { ExtensionConfig, RuntimeResponse, ZaloLoginStatus } from "./types";

const backendUrl = document.querySelector<HTMLInputElement>("#backendUrl")!;
const apiToken = document.querySelector<HTMLInputElement>("#apiToken")!;
const statusBox = document.querySelector<HTMLElement>("#status")!;
const zaloLoginStatus = document.querySelector<HTMLElement>("#zaloLoginStatus")!;
const zaloQr = document.querySelector<HTMLImageElement>("#zaloQr")!;
let zaloPollTimer: number | undefined;

void load();

document.querySelector("#save")!.addEventListener("click", save);
document.querySelector("#test")!.addEventListener("click", () => request({ type: "health" }));
document.querySelector("#googleConnect")!.addEventListener("click", connectGoogle);
document.querySelector("#googleTest")!.addEventListener("click", () => request({ type: "google-sheets-test" }));
document.querySelector("#zaloLogin")!.addEventListener("click", startZaloLogin);
document.querySelector("#zaloRefresh")!.addEventListener("click", () => refreshZaloLogin());
document.querySelector("#pause")!.addEventListener("click", () => request({ type: "zalo-control", enabled: false }));
document.querySelector("#resume")!.addEventListener("click", () => request({ type: "zalo-control", enabled: true }));

async function load(): Promise<void> {
  const stored = (await chrome.storage.local.get({
    backendUrl: "http://localhost:8000",
    apiToken: "change-me-to-a-long-random-token"
  })) as ExtensionConfig;
  backendUrl.value = stored.backendUrl;
  apiToken.value = stored.apiToken;
  await refreshZaloLogin(false);
}

async function save(): Promise<void> {
  const url = backendUrl.value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) {
    statusBox.textContent = "Backend URL phải bắt đầu bằng http:// hoặc https://";
    return;
  }
  await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
  statusBox.textContent = "Đã lưu cấu hình.";
  await refreshZaloLogin(false);
}

async function sendRuntime<T = unknown>(message: object): Promise<RuntimeResponse<T>> {
  return (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>;
}

async function request(message: object): Promise<void> {
  statusBox.textContent = "Đang xử lý…";
  const response = await sendRuntime(message);
  statusBox.textContent = response.ok
    ? JSON.stringify(response.data, null, 2)
    : `Lỗi: ${response.error || "Không xác định"}`;
}

const zaloStateLabels: Record<string, string> = {
  logged_out: "Chưa đăng nhập",
  restoring_session: "Đang khôi phục phiên…",
  session_expired: "Phiên đã hết hạn — hãy tạo QR mới",
  generating_qr: "Đang tạo mã QR…",
  waiting_for_scan: "Hãy quét mã QR bên dưới",
  waiting_for_confirmation: "Đã quét — hãy xác nhận trên điện thoại",
  qr_expired: "QR đã hết hạn — hãy tạo QR mới",
  qr_declined: "Đăng nhập đã bị từ chối",
  finishing_login: "Đang hoàn tất đăng nhập…",
  authenticated: "Đã đăng nhập",
  login_failed: "Đăng nhập thất bại"
};

async function startZaloLogin(): Promise<void> {
  window.clearTimeout(zaloPollTimer);
  zaloLoginStatus.className = "";
  zaloLoginStatus.textContent = "Đang yêu cầu mã QR…";
  zaloQr.style.display = "none";
  const response = await sendRuntime<ZaloLoginStatus>({ type: "zalo-login-start" });
  if (!response.ok) {
    renderZaloError(response.error || "Không thể bắt đầu đăng nhập Zalo");
    return;
  }
  await refreshZaloLogin(true);
}

async function refreshZaloLogin(keepPolling = false): Promise<void> {
  window.clearTimeout(zaloPollTimer);
  const response = await sendRuntime<ZaloLoginStatus>({ type: "zalo-login-status" });
  if (!response.ok || !response.data) {
    renderZaloError(response.error || "Không đọc được trạng thái Zalo");
    return;
  }

  const state = response.data;
  const accountName = state.account?.display_name ? ` — ${state.account.display_name}` : "";
  const safety = state.force_recipient_enabled
    ? `; đang khóa người nhận …${state.force_recipient_last4 || ""}`
    : "; đang dùng số của từng lead";
  zaloLoginStatus.textContent = `${zaloStateLabels[state.state] || state.state}${accountName}${safety}`;
  zaloLoginStatus.className = state.logged_in ? "ok" : state.error ? "error" : "";
  if (state.error) zaloLoginStatus.textContent += ` — ${state.error}`;

  if (state.qr_ready) {
    const qrResponse = await sendRuntime<{ image_data_url: string }>({ type: "zalo-login-qr" });
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

function renderZaloError(message: string): void {
  zaloLoginStatus.className = "error";
  zaloLoginStatus.textContent = `Lỗi: ${message}`;
  zaloQr.style.display = "none";
}

async function connectGoogle(): Promise<void> {
  statusBox.textContent = "Đang tạo liên kết cấp quyền Google…";
  const response = (await chrome.runtime.sendMessage({
    type: "google-auth-start"
  })) as RuntimeResponse<{ authorization_url: string; redirect_uri: string }>;
  if (!response.ok || !response.data?.authorization_url) {
    statusBox.textContent = `Lỗi: ${response.error || "Không tạo được liên kết Google"}`;
    return;
  }
  statusBox.textContent = `Đang mở Google. Redirect URI đã cấu hình: ${response.data.redirect_uri}`;
  await chrome.tabs.create({ url: response.data.authorization_url });
}
