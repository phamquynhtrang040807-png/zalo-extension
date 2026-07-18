import { isCreatorDetailPage, parseCreatorPage } from "./parser";
import { revealZaloPhone } from "./contact";
import type { CaptureResult, RuntimeResponse } from "./types";

const HOST_ID = "auto-zalo-capture-host";
let lastUrl = location.href;

function syncButton(): void {
  const existing = document.getElementById(HOST_ID);
  if (!isCreatorDetailPage(document)) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all:initial;position:fixed;right:24px;bottom:84px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Lấy dữ liệu & gửi Zalo";
  button.style.cssText = [
    "border:0",
    "border-radius:12px",
    "padding:12px 18px",
    "background:#00a09a",
    "color:#fff",
    "font:600 14px/1.3 system-ui,sans-serif",
    "box-shadow:0 8px 28px rgba(0,0,0,.24)",
    "cursor:pointer",
    "max-width:260px"
  ].join(";");
  button.addEventListener("click", () => capture(button));
  shadow.append(button);
  document.documentElement.append(host);
}

async function capture(button: HTMLButtonElement): Promise<void> {
  setState(button, "Đang đọc dữ liệu…", "busy");
  try {
    const payload = parseCreatorPage(document);
    if (!payload.phone_raw) {
      setState(button, "Đang mở thông tin liên hệ…", "busy");
      payload.phone_raw = await revealZaloPhone(document, payload.username);
    }
    const response = (await chrome.runtime.sendMessage({
      type: "capture",
      payload
    })) as RuntimeResponse<CaptureResult>;
    if (!response.ok || !response.data) throw new Error(response.error || "Backend không phản hồi");
    const labels: Record<CaptureResult["action"], string> = {
      sent: "✓ Đã gửi Zalo trực tiếp",
      saved_missing_phone: "⚠ Đã lưu — thiếu SĐT"
    };
    setState(button, labels[response.data.action], "success");
  } catch (error) {
    setState(button, `Lỗi: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
  window.setTimeout(() => setState(button, "Lấy dữ liệu & gửi Zalo", "ready"), 7000);
}

function setState(button: HTMLButtonElement, text: string, state: "ready" | "busy" | "success" | "warning" | "error"): void {
  const colors = {
    ready: "#00a09a",
    busy: "#2563eb",
    success: "#15803d",
    warning: "#b45309",
    error: "#b91c1c"
  };
  button.textContent = text;
  button.style.background = colors[state];
  button.disabled = state === "busy";
  button.style.cursor = state === "busy" ? "wait" : "pointer";
}

const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) lastUrl = location.href;
  window.clearTimeout((syncButton as unknown as { timer?: number }).timer);
  (syncButton as unknown as { timer?: number }).timer = window.setTimeout(syncButton, 300);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
syncButton();
