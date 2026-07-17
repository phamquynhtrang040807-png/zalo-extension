"use strict";
(() => {
  // src/parser.ts
  var SELECTORS = {
    username: [
      "[data-e2e='creator-username']",
      "[data-testid='creator-username']",
      "span.text-headline-1.mr-8",
      "[class~='text-headline-1']",
      "[class*='username' i]"
    ],
    displayName: [
      "[data-e2e='creator-display-name']",
      "[data-testid='creator-display-name']",
      "[class*='creator'] [class*='nickname']"
    ],
    followers: [
      "[data-e2e='creator-followers']",
      "[data-testid='creator-followers']"
    ],
    gmv: ["[data-e2e='creator-gmv']", "[data-testid='creator-gmv']"],
    phone: [
      "[data-e2e='creator-phone']",
      "[data-testid='creator-phone']",
      "a[href^='tel:']"
    ]
  };
  var PHONE_PATTERN = /(?:\+?84|0)(?:[\s.()-]*\d){9}\b/;
  var METRIC_PATTERN = /[0-9][0-9.,\s]*(?:K|M|B|Tr|Triệu|Tỷ|Nghìn|Ngàn)?(?:\s*đ)?/i;
  var ParseError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  function isCreatorDetailPage(root = document) {
    const text = visibleText(root.body).toLocaleLowerCase("vi");
    const url = root.location?.href || location.href;
    return text.includes("chi ti\u1EBFt v\u1EC1 nh\xE0 s\xE1ng t\u1EA1o") && text.includes("gmv") || /creator|affiliate|author/i.test(url) && text.includes("ng\u01B0\u1EDDi theo d\xF5i") && text.includes("gmv");
  }
  function parseCreatorPage(root = document) {
    if (!isCreatorDetailPage(root)) {
      throw new ParseError("not_detail_page", "\u0110\xE2y ch\u01B0a ph\u1EA3i trang chi ti\u1EBFt nh\xE0 s\xE1ng t\u1EA1o TikTok Shop");
    }
    const bodyText = visibleText(root.body);
    const username = cleanUsername(
      firstUsernameSelector(root) || usernameNearHeader(root) || usernameFromProfileLink(root)
    );
    if (!username) {
      throw new ParseError("missing_username", "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c username TikTok");
    }
    const gmvRaw = firstSelectorText(root, SELECTORS.gmv) || metricNearLabel(root, /^GMV$/i) || metricAfterLabel(bodyText, /\bGMV\b/i);
    if (!gmvRaw) {
      throw new ParseError("missing_gmv", "Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c GMV");
    }
    const followersRaw = firstSelectorText(root, SELECTORS.followers) || metricNearLabel(root, /^người theo dõi$/i) || metricAfterLabel(bodyText, /người theo dõi/i);
    const phoneRaw = normalizeWhitespace(firstSelectorText(root, SELECTORS.phone) || "") || bodyText.match(PHONE_PATTERN)?.[0] || null;
    return {
      source: "tiktok_shop",
      profile_id: profileIdFromUrl(root.location?.href || location.href),
      username,
      display_name: firstSelectorText(root, SELECTORS.displayName) || displayNameNearUsername(root, username),
      followers_raw: followersRaw,
      gmv_raw: gmvRaw,
      phone_raw: phoneRaw,
      reporting_period: reportingPeriod(bodyText),
      profile_url: root.location?.href || location.href,
      captured_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function firstSelectorText(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const text = element ? normalizeWhitespace(element.innerText || element.textContent || "") : "";
      if (text) return text;
    }
    return null;
  }
  function firstUsernameSelector(root) {
    for (const selector of SELECTORS.username) {
      for (const element of root.querySelectorAll(selector)) {
        const username = usernameToken(element.innerText || element.textContent || "");
        if (username) return username;
      }
    }
    return null;
  }
  function metricNearLabel(root, labelPattern) {
    const elements = root.querySelectorAll("span, div, p, dt, label");
    for (const element of elements) {
      const ownText = normalizeWhitespace(element.innerText || element.textContent || "");
      if (!labelPattern.test(ownText) || ownText.length > 30) continue;
      let container = element;
      for (let depth = 0; depth < 4 && container; depth += 1, container = container.parentElement) {
        const text = normalizeWhitespace(container.innerText || container.textContent || "");
        const withoutLabel = normalizeWhitespace(text.replace(ownText, " "));
        const match = withoutLabel.match(METRIC_PATTERN);
        if (match) return match[0];
      }
    }
    return null;
  }
  function metricAfterLabel(text, label) {
    const match = label.exec(text);
    if (!match) return null;
    return text.slice(match.index + match[0].length, match.index + match[0].length + 120).match(METRIC_PATTERN)?.[0] || null;
  }
  function usernameFromProfileLink(root) {
    for (const anchor of root.querySelectorAll("a[href]")) {
      const match = anchor.href.match(/tiktok\.com\/@([A-Za-z0-9._-]+)/i);
      if (match) return match[1];
    }
    return null;
  }
  function usernameNearHeader(root) {
    const heading = [...root.querySelectorAll("h1, h2, h3")].find(
      (element) => /chi tiết về nhà sáng tạo/i.test(element.innerText || element.textContent || "")
    );
    const container = heading?.closest("main") || heading?.parentElement?.parentElement || root.body;
    const ignored = /* @__PURE__ */ new Set([
      "gmv",
      "gpm",
      "mcn",
      "live",
      "tiktok",
      "shop",
      "trung",
      "t\xE2m",
      "li\xEAn",
      "k\u1EBFt",
      "chi",
      "ti\u1EBFt",
      "v\u1EC1",
      "nh\xE0",
      "s\xE1ng",
      "t\u1EA1o",
      "\u0111i\u1EC3m",
      "danh",
      "m\u1EE5c",
      "follower"
    ]);
    let best = null;
    for (const element of container.querySelectorAll("span, div, p, strong, a")) {
      if (element.closest("nav, aside")) continue;
      if (heading && !(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const value = usernameToken(directText(element));
      if (!value || ignored.has(value.toLocaleLowerCase("vi"))) continue;
      let score = 0;
      if (/\d/.test(value)) score += 6;
      if (/[._-]/.test(value)) score += 5;
      let ancestor = element.parentElement;
      for (let depth = 0; depth < 4 && ancestor; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.querySelector(
          "[aria-label*='zalo' i], [title*='zalo' i], [class*='zalo' i], [data-e2e*='zalo' i]"
        )) {
          score += 10;
          break;
        }
        if (ancestor.querySelectorAll("svg, img").length >= 2) score += 2;
      }
      if (!best || score > best.score) best = { value, score };
    }
    return best?.value || null;
  }
  function displayNameNearUsername(root, username) {
    const elements = root.querySelectorAll("span, div, p, strong");
    for (const element of elements) {
      const text = normalizeWhitespace(element.innerText || element.textContent || "");
      if (cleanUsername(text) !== username || !element.parentElement) continue;
      const lines = visibleText(element.parentElement).split("\n").map(normalizeWhitespace).filter(Boolean);
      const index = lines.findIndex((line) => cleanUsername(line) === username);
      if (index >= 0 && lines[index + 1] && lines[index + 1].length <= 80) return lines[index + 1];
    }
    return null;
  }
  function profileIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      for (const key of ["creator_id", "creatorId", "author_id", "authorId", "id"]) {
        const value = parsed.searchParams.get(key);
        if (value) return value;
      }
      return parsed.pathname.match(/\/(?:creator|author)\/([A-Za-z0-9_-]+)/i)?.[1] || null;
    } catch {
      return null;
    }
  }
  function reportingPeriod(text) {
    return text.match(/\d{1,2}\s+tháng\s+\d{1,2}\s+\d{4}\s*[-–]\s*\d{1,2}\s+tháng\s+\d{1,2}\s+\d{4}(?:\s*\([^)]*\))?/i)?.[0] || null;
  }
  function cleanUsername(value) {
    return normalizeWhitespace(value || "").replace(/^@/, "").toLocaleLowerCase("vi");
  }
  function usernameToken(value) {
    const normalized = normalizeWhitespace(value);
    const token = normalized.match(/^@?([A-Za-z0-9._-]{3,32})$/)?.[1] || null;
    return token && /[A-Za-z]/.test(token) ? token : null;
  }
  function directText(element) {
    const direct = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || "").join(" ");
    return normalizeWhitespace(direct || (element.children.length === 0 ? element.textContent || "" : ""));
  }
  function visibleText(element) {
    return element?.innerText || element?.textContent || "";
  }
  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  // src/contact.ts
  var CLICKABLE_SELECTOR = "button, [role='button'], [tabindex], a";
  function phoneFromZaloPopup(root = document) {
    const elements = root.querySelectorAll("span, div, p, label, strong");
    for (const element of elements) {
      if (!/^zalo\s*:?$/i.test(directText2(element))) continue;
      const value = valueBesideZaloLabel(element);
      if (value) return normalizeZaloValue(value);
    }
    return null;
  }
  function valueBesideZaloLabel(label) {
    for (let sibling = label.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const value = contactValue(sibling.textContent || "");
      if (value) return value;
    }
    let container = label.parentElement;
    for (let depth = 0; depth < 3 && container; depth += 1, container = container.parentElement) {
      const text = normalizeWhitespace2(container.innerText || container.textContent || "");
      const match = text.match(/\bzalo\s*:?\s*(.+)$/i);
      if (!match) continue;
      const beforeOtherContact = match[1].split(/\b(?:email)\s*:/i)[0];
      const value = contactValue(beforeOtherContact);
      if (value) return value;
    }
    return null;
  }
  function contactValue(value) {
    const normalized = normalizeWhitespace2(value).replace(/^:\s*/, "");
    if (!normalized || /^zalo\s*:?$/i.test(normalized)) return null;
    return normalized.slice(0, 100);
  }
  function normalizeZaloValue(value) {
    return /^\d{9}$/.test(value) ? `0${value}` : value;
  }
  async function revealZaloPhone(root = document, username = "", options = {}) {
    const existing = phoneFromZaloPopup(root);
    if (existing) return existing;
    const candidateWaitMs = options.candidateWaitMs ?? 1400;
    const finalWaitMs = options.finalWaitMs ?? 3e3;
    const candidates = contactTriggers(root, username).slice(0, 6);
    for (const candidate of candidates) {
      candidate.click();
      const phone = await waitForZaloPhone(root, candidateWaitMs);
      if (phone) return phone;
    }
    return candidates.length ? waitForZaloPhone(root, finalWaitMs) : null;
  }
  function contactTriggers(root, username) {
    const candidates = [];
    const add = (element) => {
      const clickable = closestClickable(element);
      if (!clickable || candidates.includes(clickable) || !isSafeTrigger(clickable)) return;
      candidates.push(clickable);
    };
    const explicitSelectors = [
      "[aria-label*='zalo' i]",
      "[title*='zalo' i]",
      "[data-e2e*='zalo' i]",
      "[data-testid*='zalo' i]",
      "img[alt*='zalo' i]",
      "[class*='zalo' i]",
      "[aria-label*='contact' i]",
      "[title*='contact' i]",
      "[data-e2e*='contact' i]",
      "[data-testid*='contact' i]"
    ];
    for (const selector of explicitSelectors) {
      for (const element of root.querySelectorAll(selector)) add(element);
    }
    for (const element of root.querySelectorAll("span, div, p")) {
      if (/^zalo\s*:?$/i.test(directText2(element))) add(element);
    }
    const usernameElement = findExactText(root, username);
    if (usernameElement) {
      let container = usernameElement.parentElement;
      for (let depth = 0; depth < 4 && container; depth += 1, container = container.parentElement) {
        for (const control of container.querySelectorAll(CLICKABLE_SELECTOR)) {
          if (control.querySelector("svg, img")) add(control);
        }
        for (const icon of container.querySelectorAll("svg, img")) add(icon);
        if (candidates.length >= 2) break;
      }
    }
    return candidates;
  }
  function closestClickable(element) {
    if (!element) return null;
    const semantic = element.closest(CLICKABLE_SELECTOR);
    if (semantic) return semantic;
    let current = element instanceof HTMLElement ? element : element.parentElement;
    for (let depth = 0; depth < 3 && current; depth += 1, current = current.parentElement) {
      if (current.onclick || getComputedStyle(current).cursor === "pointer") return current;
    }
    return null;
  }
  function isSafeTrigger(element) {
    if (element.closest("#auto-zalo-capture-host")) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href") || "";
      if (href && !href.startsWith("javascript:") && !href.startsWith("#")) return false;
    }
    return true;
  }
  function findExactText(root, expected) {
    const target = normalizeWhitespace2(expected).replace(/^@/, "").toLocaleLowerCase("vi");
    if (!target) return null;
    for (const element of root.querySelectorAll("span, div, p, strong, h1, h2, h3")) {
      const value = normalizeWhitespace2(element.innerText || element.textContent || "").replace(/^@/, "").toLocaleLowerCase("vi");
      if (value === target) return element;
    }
    return null;
  }
  function waitForZaloPhone(root, timeoutMs) {
    const immediate = phoneFromZaloPopup(root);
    if (immediate || timeoutMs <= 0) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (phone) => {
        if (settled) return;
        settled = true;
        observer2.disconnect();
        window.clearTimeout(timer);
        resolve(phone);
      };
      const observer2 = new MutationObserver(() => {
        const phone = phoneFromZaloPopup(root);
        if (phone) finish(phone);
      });
      observer2.observe(root.documentElement, { childList: true, subtree: true, characterData: true });
      const timer = window.setTimeout(() => finish(phoneFromZaloPopup(root)), timeoutMs);
    });
  }
  function directText2(element) {
    return normalizeWhitespace2(
      [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || "").join(" ")
    );
  }
  function normalizeWhitespace2(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  // src/content.ts
  var HOST_ID = "auto-zalo-capture-host";
  var lastUrl = location.href;
  function syncButton() {
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
    button.textContent = "L\u1EA5y d\u1EEF li\u1EC7u & g\u1EEDi Zalo";
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
  async function capture(button) {
    setState(button, "\u0110ang \u0111\u1ECDc d\u1EEF li\u1EC7u\u2026", "busy");
    try {
      const payload = parseCreatorPage(document);
      if (!payload.phone_raw) {
        setState(button, "\u0110ang m\u1EDF th\xF4ng tin li\xEAn h\u1EC7\u2026", "busy");
        payload.phone_raw = await revealZaloPhone(document, payload.username);
      }
      const response = await chrome.runtime.sendMessage({
        type: "capture",
        payload
      });
      if (!response.ok || !response.data) throw new Error(response.error || "Backend kh\xF4ng ph\u1EA3n h\u1ED3i");
      const labels = {
        queued: "\u2713 \u0110\xE3 \u0111\u01B0a v\xE0o h\xE0ng \u0111\u1EE3i",
        saved_missing_phone: "\u26A0 \u0110\xE3 l\u01B0u \u2014 thi\u1EBFu S\u0110T",
        duplicate_completed: "\u2713 \u0110\xE3 c\u1EADp nh\u1EADt \u2014 kh\xF4ng g\u1EEDi l\u1EA1i",
        skipped_gmv: "B\u1ECF qua \u2014 GMV d\u01B0\u1EDBi 50 tri\u1EC7u"
      };
      setState(button, labels[response.data.action], response.data.action === "skipped_gmv" ? "warning" : "success");
    } catch (error) {
      setState(button, `L\u1ED7i: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    window.setTimeout(() => setState(button, "L\u1EA5y d\u1EEF li\u1EC7u & g\u1EEDi Zalo", "ready"), 7e3);
  }
  function setState(button, text, state) {
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
  var observer = new MutationObserver(() => {
    if (location.href !== lastUrl) lastUrl = location.href;
    window.clearTimeout(syncButton.timer);
    syncButton.timer = window.setTimeout(syncButton, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncButton();
})();
