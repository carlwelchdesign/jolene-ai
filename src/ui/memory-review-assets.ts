import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface MemoryReviewAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

export interface MemoryReviewAssets {
  readonly html: MemoryReviewAsset;
  readonly css: MemoryReviewAsset;
  readonly javascript: MemoryReviewAsset;
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export function loadMemoryReviewAssets(
  projectRoot = process.cwd(),
): MemoryReviewAssets {
  const publicDirectory = resolve(projectRoot, "public");

  return {
    html: loadAsset(publicDirectory, "memory-review.html", "text/html; charset=utf-8"),
    css: loadAsset(publicDirectory, "memory-review.css", "text/css; charset=utf-8"),
    javascript: loadAsset(
      publicDirectory,
      "memory-review.js",
      "text/javascript; charset=utf-8",
    ),
  };
}

export function memoryReviewHeaders(
  contentType: string,
  contentLength: number,
): Record<string, string | number> {
  return {
    ...SECURITY_HEADERS,
    "content-length": contentLength,
    "content-type": contentType,
  };
}

function loadAsset(
  directory: string,
  filename: string,
  contentType: string,
): MemoryReviewAsset {
  return {
    body: readFileSync(resolve(directory, filename)),
    contentType,
  };
}
