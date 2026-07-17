import type { CapturePayload } from "./types";

const SELECTORS = {
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

const PHONE_PATTERN = /(?:\+?84|0)(?:[\s.()-]*\d){9}\b/;
const METRIC_PATTERN = /[0-9][0-9.,\s]*(?:K|M|B|Tr|Triệu|Tỷ|Nghìn|Ngàn)?(?:\s*đ)?/i;

export class ParseError extends Error {
  constructor(public readonly code: "not_detail_page" | "missing_username" | "missing_gmv", message: string) {
    super(message);
  }
}

export function isCreatorDetailPage(root: Document = document): boolean {
  const text = visibleText(root.body).toLocaleLowerCase("vi");
  const url = root.location?.href || location.href;
  return (
    (text.includes("chi tiết về nhà sáng tạo") && text.includes("gmv")) ||
    (/creator|affiliate|author/i.test(url) && text.includes("người theo dõi") && text.includes("gmv"))
  );
}

export function parseCreatorPage(root: Document = document): CapturePayload {
  if (!isCreatorDetailPage(root)) {
    throw new ParseError("not_detail_page", "Đây chưa phải trang chi tiết nhà sáng tạo TikTok Shop");
  }

  const bodyText = visibleText(root.body);
  const username = cleanUsername(
    firstUsernameSelector(root) || usernameNearHeader(root) || usernameFromProfileLink(root)
  );
  if (!username) {
    throw new ParseError("missing_username", "Không đọc được username TikTok");
  }

  const gmvRaw =
    firstSelectorText(root, SELECTORS.gmv) ||
    metricNearLabel(root, /^GMV$/i) ||
    metricAfterLabel(bodyText, /\bGMV\b/i);
  if (!gmvRaw) {
    throw new ParseError("missing_gmv", "Không đọc được GMV");
  }

  const followersRaw =
    firstSelectorText(root, SELECTORS.followers) ||
    metricNearLabel(root, /^người theo dõi$/i) ||
    metricAfterLabel(bodyText, /người theo dõi/i);
  const phoneRaw =
    normalizeWhitespace(firstSelectorText(root, SELECTORS.phone) || "") || bodyText.match(PHONE_PATTERN)?.[0] || null;

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
    captured_at: new Date().toISOString()
  };
}

function firstSelectorText(root: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    const text = element ? normalizeWhitespace(element.innerText || element.textContent || "") : "";
    if (text) return text;
  }
  return null;
}

function firstUsernameSelector(root: Document): string | null {
  for (const selector of SELECTORS.username) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const username = usernameToken(element.innerText || element.textContent || "");
      if (username) return username;
    }
  }
  return null;
}

function metricNearLabel(root: Document, labelPattern: RegExp): string | null {
  const elements = root.querySelectorAll<HTMLElement>("span, div, p, dt, label");
  for (const element of elements) {
    const ownText = normalizeWhitespace(element.innerText || element.textContent || "");
    if (!labelPattern.test(ownText) || ownText.length > 30) continue;
    let container: HTMLElement | null = element;
    for (let depth = 0; depth < 4 && container; depth += 1, container = container.parentElement) {
      const text = normalizeWhitespace(container.innerText || container.textContent || "");
      const withoutLabel = normalizeWhitespace(text.replace(ownText, " "));
      const match = withoutLabel.match(METRIC_PATTERN);
      if (match) return match[0];
    }
  }
  return null;
}

function metricAfterLabel(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (!match) return null;
  return text.slice(match.index + match[0].length, match.index + match[0].length + 120).match(METRIC_PATTERN)?.[0] || null;
}

function usernameFromProfileLink(root: Document): string | null {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const match = anchor.href.match(/tiktok\.com\/@([A-Za-z0-9._-]+)/i);
    if (match) return match[1];
  }
  return null;
}

function usernameNearHeader(root: Document): string | null {
  const heading = [...root.querySelectorAll<HTMLElement>("h1, h2, h3")].find((element) =>
    /chi tiết về nhà sáng tạo/i.test(element.innerText || element.textContent || "")
  );
  const container = heading?.closest("main") || heading?.parentElement?.parentElement || root.body;
  const ignored = new Set([
    "gmv", "gpm", "mcn", "live", "tiktok", "shop", "trung", "tâm", "liên", "kết",
    "chi", "tiết", "về", "nhà", "sáng", "tạo", "điểm", "danh", "mục", "follower"
  ]);
  let best: { value: string; score: number } | null = null;

  for (const element of container.querySelectorAll<HTMLElement>("span, div, p, strong, a")) {
    if (element.closest("nav, aside")) continue;
    if (heading && !(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const value = usernameToken(directText(element));
    if (!value || ignored.has(value.toLocaleLowerCase("vi"))) continue;

    let score = 0;
    if (/\d/.test(value)) score += 6;
    if (/[._-]/.test(value)) score += 5;
    let ancestor: HTMLElement | null = element.parentElement;
    for (let depth = 0; depth < 4 && ancestor; depth += 1, ancestor = ancestor.parentElement) {
      if (
        ancestor.querySelector(
          "[aria-label*='zalo' i], [title*='zalo' i], [class*='zalo' i], [data-e2e*='zalo' i]"
        )
      ) {
        score += 10;
        break;
      }
      if (ancestor.querySelectorAll("svg, img").length >= 2) score += 2;
    }
    if (!best || score > best.score) best = { value, score };
  }
  return best?.value || null;
}

function displayNameNearUsername(root: Document, username: string): string | null {
  const elements = root.querySelectorAll<HTMLElement>("span, div, p, strong");
  for (const element of elements) {
    const text = normalizeWhitespace(element.innerText || element.textContent || "");
    if (cleanUsername(text) !== username || !element.parentElement) continue;
    const lines = visibleText(element.parentElement).split("\n").map(normalizeWhitespace).filter(Boolean);
    const index = lines.findIndex((line) => cleanUsername(line) === username);
    if (index >= 0 && lines[index + 1] && lines[index + 1].length <= 80) return lines[index + 1];
  }
  return null;
}

function profileIdFromUrl(url: string): string | null {
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

function reportingPeriod(text: string): string | null {
  return text.match(/\d{1,2}\s+tháng\s+\d{1,2}\s+\d{4}\s*[-–]\s*\d{1,2}\s+tháng\s+\d{1,2}\s+\d{4}(?:\s*\([^)]*\))?/i)?.[0] || null;
}

function cleanUsername(value: string | null): string {
  return normalizeWhitespace(value || "").replace(/^@/, "").toLocaleLowerCase("vi");
}

function usernameToken(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  const token = normalized.match(/^@?([A-Za-z0-9._-]{3,32})$/)?.[1] || null;
  return token && /[A-Za-z]/.test(token) ? token : null;
}

function directText(element: HTMLElement): string {
  const direct = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ");
  return normalizeWhitespace(direct || (element.children.length === 0 ? element.textContent || "" : ""));
}

function visibleText(element: HTMLElement): string {
  return element?.innerText || element?.textContent || "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
