import { isIP } from "node:net";

const FORBIDDEN_PUBLIC_TEXT: readonly RegExp[] = [
  /(?:^|[^A-Za-z0-9])\/(?:Users|home|private|var|Volumes)\//i,
  /\b[A-Za-z]:\\(?:Users|Documents|Desktop|AppData)\\/i,
  /\b(?:file|obsidian):\/\//i,
  /!?(?:\[\[)[^\]]+\]\]/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:OPENAI_API_KEY|SLACK_(?:BOT|APP)_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=/i,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,})\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
];

const HTTP_URL = /\bhttps?:\/\/[^\s<>"']+/giu;

export function containsForbiddenPublicText(value: string): boolean {
  if (FORBIDDEN_PUBLIC_TEXT.some((pattern) => pattern.test(value))) return true;
  return [...value.matchAll(HTTP_URL)].some((match) => {
    try {
      return isPrivateHostname(new URL(match[0]).hostname);
    } catch {
      return false;
    }
  });
}

export function containsForbiddenPublicDisclosure(value: unknown): boolean {
  return inspect(value, new WeakSet<object>());
}

export function assertPublicResponseDisclosureSafe(value: unknown): void {
  if (containsForbiddenPublicDisclosure(value)) {
    throw new PublicResponseDisclosureError();
  }
}

export class PublicResponseDisclosureError extends Error {
  constructor() {
    super("Public response blocked by disclosure policy.");
    this.name = "PublicResponseDisclosureError";
  }
}

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) return true;
  const version = isIP(normalized);
  if (version === 6) {
    return normalized === "::1" || normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe80:");
  }
  if (version === 4) {
    const [first = 0, second = 0] = normalized.split(".").map(Number);
    return first === 10 || first === 127 || first === 0 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }
  return false;
}

function inspect(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === "string") return containsForbiddenPublicText(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Array.isArray(value)
    ? value.some((item) => inspect(item, seen))
    : Object.values(value).some((item) => inspect(item, seen));
}
