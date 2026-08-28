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
  readonly actionHtml: MemoryReviewAsset;
  readonly actionCss: MemoryReviewAsset;
  readonly actionJavascript: MemoryReviewAsset;
  readonly workflowHtml: MemoryReviewAsset;
  readonly workflowCss: MemoryReviewAsset;
  readonly workflowJavascript: MemoryReviewAsset;
  readonly projectHtml: MemoryReviewAsset;
  readonly projectCss: MemoryReviewAsset;
  readonly projectJavascript: MemoryReviewAsset;
  readonly careerHtml: MemoryReviewAsset;
  readonly careerCss: MemoryReviewAsset;
  readonly careerJavascript: MemoryReviewAsset;
  readonly contactHtml: MemoryReviewAsset;
  readonly contactCss: MemoryReviewAsset;
  readonly contactJavascript: MemoryReviewAsset;
  readonly publicEvaluationHtml: MemoryReviewAsset;
  readonly publicEvaluationCss: MemoryReviewAsset;
  readonly publicEvaluationJavascript: MemoryReviewAsset;
  readonly conversationEvaluationHtml: MemoryReviewAsset;
  readonly conversationEvaluationCss: MemoryReviewAsset;
  readonly conversationEvaluationJavascript: MemoryReviewAsset;
  readonly clientAiHtml: MemoryReviewAsset;
  readonly clientAiCss: MemoryReviewAsset;
  readonly clientAiJavascript: MemoryReviewAsset;
  readonly personalityHtml: MemoryReviewAsset;
  readonly personalityCss: MemoryReviewAsset;
  readonly personalityJavascript: MemoryReviewAsset;
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
    actionHtml: loadAsset(
      publicDirectory,
      "action-review.html",
      "text/html; charset=utf-8",
    ),
    actionCss: loadAsset(
      publicDirectory,
      "action-review.css",
      "text/css; charset=utf-8",
    ),
    actionJavascript: loadAsset(
      publicDirectory,
      "action-review.js",
      "text/javascript; charset=utf-8",
    ),
    workflowHtml: loadAsset(
      publicDirectory,
      "workflow-review.html",
      "text/html; charset=utf-8",
    ),
    workflowCss: loadAsset(
      publicDirectory,
      "workflow-review.css",
      "text/css; charset=utf-8",
    ),
    workflowJavascript: loadAsset(
      publicDirectory,
      "workflow-review.js",
      "text/javascript; charset=utf-8",
    ),
    projectHtml: loadAsset(
      publicDirectory,
      "project-watch.html",
      "text/html; charset=utf-8",
    ),
    projectCss: loadAsset(
      publicDirectory,
      "project-watch.css",
      "text/css; charset=utf-8",
    ),
    projectJavascript: loadAsset(
      publicDirectory,
      "project-watch.js",
      "text/javascript; charset=utf-8",
    ),
    careerHtml: loadAsset(
      publicDirectory,
      "career-evidence.html",
      "text/html; charset=utf-8",
    ),
    careerCss: loadAsset(
      publicDirectory,
      "career-evidence.css",
      "text/css; charset=utf-8",
    ),
    careerJavascript: loadAsset(
      publicDirectory,
      "career-evidence.js",
      "text/javascript; charset=utf-8",
    ),
    contactHtml: loadAsset(
      publicDirectory,
      "contact-review.html",
      "text/html; charset=utf-8",
    ),
    contactCss: loadAsset(
      publicDirectory,
      "contact-review.css",
      "text/css; charset=utf-8",
    ),
    contactJavascript: loadAsset(
      publicDirectory,
      "contact-review.js",
      "text/javascript; charset=utf-8",
    ),
    publicEvaluationHtml: loadAsset(
      publicDirectory,
      "public-evaluation-review.html",
      "text/html; charset=utf-8",
    ),
    publicEvaluationCss: loadAsset(
      publicDirectory,
      "public-evaluation-review.css",
      "text/css; charset=utf-8",
    ),
    publicEvaluationJavascript: loadAsset(
      publicDirectory,
      "public-evaluation-review.js",
      "text/javascript; charset=utf-8",
    ),
    conversationEvaluationHtml: loadAsset(
      publicDirectory,
      "conversation-evaluation-review.html",
      "text/html; charset=utf-8",
    ),
    conversationEvaluationCss: loadAsset(
      publicDirectory,
      "conversation-evaluation-review.css",
      "text/css; charset=utf-8",
    ),
    conversationEvaluationJavascript: loadAsset(
      publicDirectory,
      "conversation-evaluation-review.js",
      "text/javascript; charset=utf-8",
    ),
    clientAiHtml: loadAsset(
      publicDirectory,
      "client-ai-review.html",
      "text/html; charset=utf-8",
    ),
    clientAiCss: loadAsset(
      publicDirectory,
      "client-ai-review.css",
      "text/css; charset=utf-8",
    ),
    clientAiJavascript: loadAsset(
      publicDirectory,
      "client-ai-review.js",
      "text/javascript; charset=utf-8",
    ),
    personalityHtml: loadAsset(
      publicDirectory,
      "personality-review.html",
      "text/html; charset=utf-8",
    ),
    personalityCss: loadAsset(
      publicDirectory,
      "personality-review.css",
      "text/css; charset=utf-8",
    ),
    personalityJavascript: loadAsset(
      publicDirectory,
      "personality-review.js",
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
