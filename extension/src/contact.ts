const CLICKABLE_SELECTOR = "button, [role='button'], [tabindex], a";

interface RevealOptions {
  candidateWaitMs?: number;
  finalWaitMs?: number;
}

/** Read the phone specifically from a contact row labelled "Zalo". */
export function phoneFromZaloPopup(root: Document = document): string | null {
  const elements = root.querySelectorAll<HTMLElement>("span, div, p, label, strong");
  for (const element of elements) {
    if (!/^zalo\s*:?$/i.test(directText(element))) continue;
    const value = valueBesideZaloLabel(element);
    if (value) return normalizeZaloValue(value);
  }
  return null;
}

function valueBesideZaloLabel(label: HTMLElement): string | null {
  for (let sibling = label.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    const value = contactValue(sibling.textContent || "");
    if (value) return value;
  }

  let container: HTMLElement | null = label.parentElement;
  for (let depth = 0; depth < 3 && container; depth += 1, container = container.parentElement) {
    const text = normalizeWhitespace(container.innerText || container.textContent || "");
    const match = text.match(/\bzalo\s*:?\s*(.+)$/i);
    if (!match) continue;
    const beforeOtherContact = match[1].split(/\b(?:email)\s*:/i)[0];
    const value = contactValue(beforeOtherContact);
    if (value) return value;
  }
  return null;
}

function contactValue(value: string): string | null {
  const normalized = normalizeWhitespace(value).replace(/^:\s*/, "");
  if (!normalized || /^zalo\s*:?$/i.test(normalized)) return null;
  return normalized.slice(0, 100);
}

function normalizeZaloValue(value: string): string {
  return /^\d{9}$/.test(value) ? `0${value}` : value;
}

/** Open the contact popover when necessary and wait for its asynchronous content. */
export async function revealZaloPhone(
  root: Document = document,
  username = "",
  options: RevealOptions = {}
): Promise<string | null> {
  const existing = phoneFromZaloPopup(root);
  if (existing) return existing;

  const candidateWaitMs = options.candidateWaitMs ?? 1400;
  const finalWaitMs = options.finalWaitMs ?? 3000;
  const candidates = contactTriggers(root, username).slice(0, 6);

  for (const candidate of candidates) {
    candidate.click();
    const phone = await waitForZaloPhone(root, candidateWaitMs);
    if (phone) return phone;
  }

  // The contact API can finish after the click-specific wait has elapsed.
  return candidates.length ? waitForZaloPhone(root, finalWaitMs) : null;
}

function contactTriggers(root: Document, username: string): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  const add = (element: Element | null): void => {
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

  for (const element of root.querySelectorAll<HTMLElement>("span, div, p")) {
    if (/^zalo\s*:?$/i.test(directText(element))) add(element);
  }

  // TikTok sometimes exposes these header actions only as unlabelled SVG icons.
  // In that case, limit the fallback to icon controls in the username's header row.
  const usernameElement = findExactText(root, username);
  if (usernameElement) {
    let container: HTMLElement | null = usernameElement.parentElement;
    for (let depth = 0; depth < 4 && container; depth += 1, container = container.parentElement) {
      for (const control of container.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)) {
        if (control.querySelector("svg, img")) add(control);
      }
      for (const icon of container.querySelectorAll("svg, img")) add(icon);
      if (candidates.length >= 2) break;
    }
  }

  return candidates;
}

function closestClickable(element: Element | null): HTMLElement | null {
  if (!element) return null;
  const semantic = element.closest<HTMLElement>(CLICKABLE_SELECTOR);
  if (semantic) return semantic;

  let current: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;
  for (let depth = 0; depth < 3 && current; depth += 1, current = current.parentElement) {
    if (current.onclick || getComputedStyle(current).cursor === "pointer") return current;
  }
  return null;
}

function isSafeTrigger(element: HTMLElement): boolean {
  if (element.closest("#auto-zalo-capture-host")) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href") || "";
    if (href && !href.startsWith("javascript:") && !href.startsWith("#")) return false;
  }
  return true;
}

function findExactText(root: Document, expected: string): HTMLElement | null {
  const target = normalizeWhitespace(expected).replace(/^@/, "").toLocaleLowerCase("vi");
  if (!target) return null;
  for (const element of root.querySelectorAll<HTMLElement>("span, div, p, strong, h1, h2, h3")) {
    const value = normalizeWhitespace(element.innerText || element.textContent || "")
      .replace(/^@/, "")
      .toLocaleLowerCase("vi");
    if (value === target) return element;
  }
  return null;
}

function waitForZaloPhone(root: Document, timeoutMs: number): Promise<string | null> {
  const immediate = phoneFromZaloPopup(root);
  if (immediate || timeoutMs <= 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (phone: string | null): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(phone);
    };
    const observer = new MutationObserver(() => {
      const phone = phoneFromZaloPopup(root);
      if (phone) finish(phone);
    });
    observer.observe(root.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setTimeout(() => finish(phoneFromZaloPopup(root)), timeoutMs);
  });
}

function directText(element: HTMLElement): string {
  return normalizeWhitespace(
    [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
