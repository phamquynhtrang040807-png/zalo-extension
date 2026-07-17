import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoginQRCallbackEventType, Zalo } from "../zalo-api-final/dist/index.js";


const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR || path.join(MODULE_DIR, "data");
const SESSION_PATH = path.join(DATA_DIR, "credentials.json");
const IDEMPOTENCY_PATH = path.join(DATA_DIR, "idempotency.json");
const BRIDGE_TOKEN = process.env.ZALO_BRIDGE_TOKEN || "";
const FORCE_RECIPIENT_ENABLED = parseBoolean(
    process.env.ZALO_FORCE_RECIPIENT_ENABLED,
    true,
);
const FORCE_RECIPIENT_PHONE = process.env.ZALO_FORCE_RECIPIENT_PHONE || "0961382006";
const FRIEND_REQUEST_MESSAGE =
    process.env.ZALO_FRIEND_REQUEST_MESSAGE || "Xin chào, mình muốn kết bạn với bạn.";

let api = null;
let account = null;
let loginPromise = null;
let pendingCredentials = null;
let qrImage = null;
let loginState = "logged_out";
let lastError = null;
const idempotency = loadJson(IDEMPOTENCY_PATH, {});


export function parseBoolean(value, fallback = false) {
    if (value == null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}


export function normalizeVietnamPhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("0084")) digits = digits.slice(2);
    if (digits.startsWith("84")) digits = `0${digits.slice(2)}`;
    if (!/^0[35789]\d{8}$/.test(digits)) return null;
    return digits;
}


export function effectiveRecipient(requestedPhone, forceEnabled, forcedPhone) {
    return normalizeVietnamPhone(forceEnabled ? forcedPhone : requestedPhone);
}


function loadJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}


function saveJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
        encoding: "utf8",
        mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
}


function publicStatus() {
    return {
        logged_in: Boolean(api),
        state: loginState,
        account: account
            ? {
                  user_id: String(account.userId || ""),
                  display_name: account.displayName || account.zaloName || "",
                  phone: account.phoneNumber || "",
              }
            : null,
        qr_ready: Boolean(qrImage),
        force_recipient_enabled: FORCE_RECIPIENT_ENABLED,
        force_recipient_last4: normalizeVietnamPhone(FORCE_RECIPIENT_PHONE)?.slice(-4) || null,
        error: lastError,
    };
}


async function restoreSession() {
    if (!fs.existsSync(SESSION_PATH)) return;
    loginState = "restoring_session";
    try {
        const credentials = loadJson(SESSION_PATH, null);
        if (!credentials) throw new Error("Session file is invalid");
        const zalo = new Zalo({ logging: false, checkUpdate: false, selfListen: false });
        api = await zalo.login(credentials);
        account = await api.fetchAccountInfo();
        loginState = "authenticated";
        lastError = null;
    } catch (error) {
        api = null;
        account = null;
        loginState = "session_expired";
        lastError = errorMessage(error);
    }
}


function startQrLogin() {
    if (loginPromise) return;
    api = null;
    account = null;
    pendingCredentials = null;
    qrImage = null;
    lastError = null;
    loginState = "generating_qr";

    const zalo = new Zalo({ logging: false, checkUpdate: false, selfListen: false });
    loginPromise = zalo
        .loginQR({}, (event) => {
            switch (event.type) {
                case LoginQRCallbackEventType.QRCodeGenerated:
                    qrImage = event.data.image;
                    loginState = "waiting_for_scan";
                    break;
                case LoginQRCallbackEventType.QRCodeScanned:
                    loginState = "waiting_for_confirmation";
                    break;
                case LoginQRCallbackEventType.QRCodeExpired:
                    qrImage = null;
                    loginState = "qr_expired";
                    break;
                case LoginQRCallbackEventType.QRCodeDeclined:
                    qrImage = null;
                    loginState = "qr_declined";
                    break;
                case LoginQRCallbackEventType.GotLoginInfo:
                    pendingCredentials = event.data;
                    loginState = "finishing_login";
                    break;
            }
        })
        .then(async (loggedInApi) => {
            api = loggedInApi;
            account = await api.fetchAccountInfo();
            if (!pendingCredentials) throw new Error("Login completed without session credentials");
            saveJson(SESSION_PATH, pendingCredentials);
            pendingCredentials = null;
            qrImage = null;
            loginState = "authenticated";
            lastError = null;
        })
        .catch((error) => {
            api = null;
            account = null;
            pendingCredentials = null;
            qrImage = null;
            loginState = "login_failed";
            lastError = errorMessage(error);
        })
        .finally(() => {
            loginPromise = null;
        });
}


function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}


function authenticated(req) {
    if (!BRIDGE_TOKEN) return false;
    return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}`;
}


async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error("Request body is too large");
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}


function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    res.end(body);
}


function sendHtml(res) {
    const body = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đăng nhập Zalo cá nhân</title>
<style>body{font:16px system-ui;max-width:620px;margin:40px auto;padding:0 18px;color:#172033}button{padding:11px 16px;border:0;border-radius:8px;background:#0866ff;color:white;font-weight:650;cursor:pointer}#qr{display:none;width:280px;height:280px;object-fit:contain;margin:20px 0;border:1px solid #ddd;border-radius:12px}.card{padding:22px;border:1px solid #ddd;border-radius:14px}.ok{color:#08783e}.error{color:#b42318}</style></head>
<body><div class="card"><h1>Đăng nhập Zalo cá nhân</h1><p id="status">Đang kiểm tra…</p><img id="qr" alt="Mã QR đăng nhập Zalo"><p><button id="login">Tạo mã QR mới</button></p><p>Chỉ quét bằng đúng tài khoản Zalo dùng để gửi tin. Sau khi quét, xác nhận đăng nhập trên điện thoại.</p></div>
<script>
const labels={logged_out:'Chưa đăng nhập',restoring_session:'Đang khôi phục phiên…',session_expired:'Phiên đã hết hạn',generating_qr:'Đang tạo QR…',waiting_for_scan:'Hãy quét mã QR bằng Zalo trên điện thoại',waiting_for_confirmation:'Đã quét — hãy xác nhận trên điện thoại',qr_expired:'QR đã hết hạn, hãy tạo mã mới',qr_declined:'Bạn đã từ chối đăng nhập',finishing_login:'Đang hoàn tất đăng nhập…',authenticated:'Đã đăng nhập',login_failed:'Đăng nhập thất bại'};
async function refresh(){const s=await fetch('/status',{cache:'no-store'}).then(r=>r.json());const el=document.querySelector('#status');el.textContent=labels[s.state]||s.state;if(s.account)el.textContent+=': '+s.account.display_name;el.className=s.logged_in?'ok':(s.error?'error':'');if(s.error)el.textContent+=' — '+s.error;const qr=document.querySelector('#qr');qr.style.display=s.qr_ready?'block':'none';if(s.qr_ready)qr.src='/qr?t='+Date.now();}
document.querySelector('#login').onclick=async()=>{await fetch('/login/qr',{method:'POST'});await refresh();};refresh();setInterval(refresh,1500);
</script></body></html>`;
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    res.end(body);
}


function getRecipient(body) {
    const recipient = effectiveRecipient(
        body.phone,
        FORCE_RECIPIENT_ENABLED,
        FORCE_RECIPIENT_PHONE,
    );
    if (!recipient) {
        const error = new Error(
            FORCE_RECIPIENT_ENABLED
                ? "ZALO_FORCE_RECIPIENT_PHONE is invalid"
                : "phone is invalid",
        );
        error.statusCode = 400;
        error.code = "invalid_recipient";
        throw error;
    }
    return recipient;
}


async function findRecipient(phone) {
    const user = await api.findUser(phone);
    if (!user?.uid) {
        const error = new Error("No Zalo user was found for this phone number");
        error.statusCode = 404;
        error.code = "user_not_found";
        throw error;
    }
    return user;
}


async function performIdempotently(key, operation) {
    if (!key) {
        const error = new Error("idempotency_key is required");
        error.statusCode = 400;
        error.code = "missing_idempotency_key";
        throw error;
    }
    if (idempotency[key]) return idempotency[key];
    const result = await operation();
    idempotency[key] = result;
    saveJson(IDEMPOTENCY_PATH, idempotency);
    return result;
}


async function handleZaloAction(req, res, action) {
    if (!authenticated(req)) {
        sendJson(res, 401, { success: false, error_code: "unauthorized", message: "Invalid bridge token" });
        return;
    }
    if (!api) {
        sendJson(res, 503, { success: false, error_code: "login_required", message: "Zalo login is required" });
        return;
    }

    try {
        const body = await readJson(req);
        const recipientPhone = getRecipient(body);
        const result = await performIdempotently(body.idempotency_key, async () => {
            const user = await findRecipient(recipientPhone);
            if (action === "friend_request") {
                await api.sendFriendRequest(body.message || FRIEND_REQUEST_MESSAGE, user.uid);
                return { success: true, request_id: body.idempotency_key, user_id: String(user.uid) };
            }
            if (typeof body.message !== "string" || !body.message.trim()) {
                const error = new Error("message is required");
                error.statusCode = 400;
                error.code = "missing_message";
                throw error;
            }
            const sent = await api.sendMessage(body.message, user.uid);
            const messageId = sent?.message?.msgId;
            return {
                success: true,
                message_id: messageId == null ? body.idempotency_key : String(messageId),
                user_id: String(user.uid),
            };
        });
        sendJson(res, 200, result);
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 502;
        sendJson(res, statusCode, {
            success: false,
            error_code: String(error?.code || "zalo_api_error"),
            message: errorMessage(error),
        });
    }
}


export function createServer() {
    return http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (req.method === "GET" && url.pathname === "/") return sendHtml(res);
        if (req.method === "GET" && ["/health", "/status"].includes(url.pathname)) {
            return sendJson(res, 200, publicStatus());
        }
        if (req.method === "GET" && url.pathname === "/qr") {
            if (!qrImage) return sendJson(res, 404, { error: "QR code is not ready" });
            const body = Buffer.from(qrImage, "base64");
            res.writeHead(200, { "Content-Type": "image/png", "Content-Length": body.length, "Cache-Control": "no-store" });
            return res.end(body);
        }
        if (req.method === "POST" && url.pathname === "/login/qr") {
            startQrLogin();
            return sendJson(res, 202, publicStatus());
        }
        if (req.method === "POST" && url.pathname === "/friend-request") {
            return handleZaloAction(req, res, "friend_request");
        }
        if (req.method === "POST" && url.pathname === "/messages") {
            return handleZaloAction(req, res, "message");
        }
        return sendJson(res, 404, { error: "Not found" });
    });
}


export async function startServer() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await restoreSession();
    const server = createServer();
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`Zalo personal bridge listening on port ${PORT}`);
    });
    return server;
}


if (process.env.NODE_ENV !== "test") {
    await startServer();
}
