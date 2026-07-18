import type {
  ExtensionConfig,
  RuntimeResponse,
  ZaloAutomationConfig,
  ZaloAutomationTestResult,
  ZaloLoginStatus
} from "./types";

const backendUrl = document.querySelector<HTMLInputElement>("#backendUrl")!;
const apiToken = document.querySelector<HTMLInputElement>("#apiToken")!;
const statusBox = document.querySelector<HTMLElement>("#status")!;
const zaloLoginStatus = document.querySelector<HTMLElement>("#zaloLoginStatus")!;
const zaloQr = document.querySelector<HTMLImageElement>("#zaloQr")!;
const friendRequestMessage = document.querySelector<HTMLTextAreaElement>("#friendRequestMessage")!;
const zaloMessages = document.querySelector<HTMLElement>("#zaloMessages")!;
const zaloTestPhone = document.querySelector<HTMLInputElement>("#zaloTestPhone")!;
const testZaloAutomationButton = document.querySelector<HTMLButtonElement>("#testZaloAutomation")!;
let zaloPollTimer: number | undefined;

const DEFAULT_AUTOMATION: ZaloAutomationConfig = {
  friend_request_message: "Chào bạn, mình là Trang Phạm, đến từ JUSTDUN - brand chuyên về thời trang nữ",
  messages: ["Chào bạn, mình là Trang Phạm, đến từ JUSTDUN - brand chuyên về thời trang nữ"]
};

void load();

document.querySelector("#save")!.addEventListener("click", save);
document.querySelector("#test")!.addEventListener("click", () => request({ type: "health" }));
document.querySelector("#googleConnect")!.addEventListener("click", connectGoogle);
document.querySelector("#googleTest")!.addEventListener("click", () => request({ type: "google-sheets-test" }));
document.querySelector("#zaloLogin")!.addEventListener("click", startZaloLogin);
document.querySelector("#zaloRefresh")!.addEventListener("click", () => refreshZaloLogin());
document.querySelector("#addZaloMessage")!.addEventListener("click", () => addMessageRow(""));
testZaloAutomationButton.addEventListener("click", testZaloAutomation);
document.querySelector("#pause")!.addEventListener("click", () => request({ type: "zalo-control", enabled: false }));
document.querySelector("#resume")!.addEventListener("click", () => request({ type: "zalo-control", enabled: true }));

async function load(): Promise<void> {
  const stored = (await chrome.storage.local.get({
    backendUrl: "https://kol.aipencil.name.vn",
    apiToken: "change-me-to-a-long-random-token"
  })) as ExtensionConfig;
  if (stored.backendUrl === "http://localhost:8000") {
    stored.backendUrl = "http://localhost:8001";
    await chrome.storage.local.set({ backendUrl: stored.backendUrl });
  }
  backendUrl.value = stored.backendUrl;
  apiToken.value = stored.apiToken;
  await loadAutomationConfig();
  await refreshZaloLogin(false);
}

async function save(): Promise<void> {
  const url = backendUrl.value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) {
    statusBox.textContent = "Backend URL phải bắt đầu bằng http:// hoặc https://";
    return;
  }
  await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
  const automation = readAutomationConfig();
  if (!automation) return;
  const response = await sendRuntime<ZaloAutomationConfig>({
    type: "zalo-automation-config-save",
    config: automation
  });
  if (!response.ok) {
    statusBox.textContent = `Lỗi lưu automation: ${response.error || "Không xác định"}`;
    return;
  }
  statusBox.textContent = `Đã lưu cấu hình với ${automation.messages.length} tin nhắn tự động.`;
  await refreshZaloLogin(false);
}

async function loadAutomationConfig(): Promise<void> {
  const response = await sendRuntime<ZaloAutomationConfig>({ type: "zalo-automation-config-get" });
  renderAutomationConfig(response.ok && response.data ? response.data : DEFAULT_AUTOMATION);
  if (!response.ok) {
    statusBox.textContent = `Không tải được automation từ backend: ${response.error || "Không xác định"}`;
  }
}

function renderAutomationConfig(config: ZaloAutomationConfig): void {
  friendRequestMessage.value = config.friend_request_message;
  zaloMessages.replaceChildren();
  for (const message of config.messages) addMessageRow(message);
}

function addMessageRow(value: string): void {
  if (zaloMessages.querySelectorAll("textarea").length >= 20) {
    statusBox.textContent = "Chỉ được cấu hình tối đa 20 tin nhắn tự động.";
    return;
  }
  const row = document.createElement("div");
  row.className = "message-row";
  const textarea = document.createElement("textarea");
  textarea.maxLength = 5000;
  textarea.placeholder = "Nhập nội dung tin nhắn tự động";
  textarea.value = value;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Xóa";
  remove.title = "Xóa tin nhắn này";
  remove.addEventListener("click", () => row.remove());
  row.append(textarea, remove);
  zaloMessages.append(row);
}

function readAutomationConfig(): ZaloAutomationConfig | null {
  const invitation = friendRequestMessage.value.trim();
  if (!invitation) {
    statusBox.textContent = "Lời nhắn kết bạn không được để trống.";
    friendRequestMessage.focus();
    return null;
  }
  const textareas = Array.from(zaloMessages.querySelectorAll<HTMLTextAreaElement>("textarea"));
  const messages = textareas.map((textarea) => textarea.value.trim());
  const emptyIndex = messages.findIndex((message) => !message);
  if (emptyIndex >= 0) {
    statusBox.textContent = "Tin nhắn tự động không được để trống; hãy nhập nội dung hoặc xóa dòng.";
    textareas[emptyIndex].focus();
    return null;
  }
  return { friend_request_message: invitation, messages };
}

async function testZaloAutomation(): Promise<void> {
  const phone = zaloTestPhone.value.trim();
  if (!phone) {
    statusBox.textContent = "Hãy nhập số điện thoại để gửi thử.";
    zaloTestPhone.focus();
    return;
  }
  const url = backendUrl.value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) {
    statusBox.textContent = "Backend URL phải bắt đầu bằng http:// hoặc https://";
    return;
  }
  const automation = readAutomationConfig();
  if (!automation) return;

  testZaloAutomationButton.disabled = true;
  statusBox.textContent = "Đang lưu cấu hình và gửi tin nhắn thử…";
  try {
    await chrome.storage.local.set({ backendUrl: url, apiToken: apiToken.value.trim() });
    const saved = await sendRuntime<ZaloAutomationConfig>({
      type: "zalo-automation-config-save",
      config: automation
    });
    if (!saved.ok) throw new Error(saved.error || "Không lưu được cấu hình automation");

    const response = await sendRuntime<ZaloAutomationTestResult>({
      type: "zalo-automation-test",
      phone
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error || "Không gửi được tin nhắn thử");
    }
    const safety = response.data.force_recipient_enabled
      ? ` Safety lock đã chuyển tới …${response.data.effective_recipient_last4}.`
      : "";
    statusBox.textContent = `${response.data.message}.${safety}`;
  } catch (error) {
    statusBox.textContent = `Lỗi gửi thử: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    testZaloAutomationButton.disabled = false;
  }
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
