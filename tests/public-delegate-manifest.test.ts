import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PublicJoleneErrorCode } from "../src/domain/public-portfolio-contract.js";
import { FilePublicArtifactSource } from "../src/public/public-artifact-source.js";
import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
  type PublicPortfolioAnswerer,
} from "../src/public/public-answer-service.js";
import { DeterministicPublicJobFitService } from "../src/public/public-job-fit-service.js";
import {
  FilePublicContactIntentQueue,
  PublicContactQueueUnavailableError,
  type PublicContactIntentStager,
} from "../src/public/public-contact-intent-queue.js";
import {
  FixedWindowPublicRequestAdmission,
  type PublicRequestAdmissionController,
} from "../src/public/public-request-admission.js";
import {
  parsePublicDelegateConfig,
} from "../src/public/public-config.js";
import {
  createPublicDelegateServer,
} from "../src/public/public-delegate-server.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";
import {
  FilePublicAuditLedger,
  type PublicAuditRecordInput,
  type PublicAuditRecorder,
} from "../src/public/public-audit-ledger.js";
import {
  InMemoryPublicOperationalTelemetry,
  type PublicOperationalTelemetry,
} from "../src/public/public-operational-telemetry.js";

const temporaryDirectories: string[] = [];
const openServers: ReturnType<typeof createPublicDelegateServer>[] = [];
const testRequestId = "req:00000000000000000000000000000001" as const;

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => close(server)));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("public delegate manifest boundary", () => {
  it("loads public-only defaults without requiring private credentials", () => {
    const config = parsePublicDelegateConfig({
      OPENAI_API_KEY: undefined,
      SLACK_BOT_TOKEN: undefined,
      JOLENE_DATABASE_PATH: undefined,
    });
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_HOST: "0.0.0.0",
    })).toThrow();
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_HOST: "0.0.0.0",
      JOLENE_PUBLIC_CONTAINER_MODE: "true",
    }).host).toBe("0.0.0.0");

    expect(config).toEqual({
      enabled: true,
      host: "127.0.0.1",
      port: 8431,
      operationsHost: "127.0.0.1",
      operationsPort: 8432,
      artifactPath: path.resolve(
        ".jolene/exports/public-career-evidence.json",
      ),
      artifactSource: "file",
      artifactUrl: undefined,
      artifactTimeoutMilliseconds: 5_000,
      expectedCorpusVersion: undefined,
      contactQueuePath: path.resolve(
        ".jolene/public/contact-intents.json",
      ),
      contactRetentionDays: 30,
      contactQueueMaxEntries: 500,
      auditPath: path.resolve(".jolene/public/audit.json"),
      auditRetentionDays: 30,
      auditMaxEntries: 5_000,
      requestsPerMinute: 60,
      maxConcurrentRequests: 8,
      authMode: "disabled",
      apiToken: undefined,
      answerMode: "deterministic",
      personalityMode: "jolene",
      openaiModel: "gpt-5.4-mini",
      openaiTimeoutMilliseconds: 8_000,
      openaiBudgetPath: path.resolve(".jolene/public/model-budget.json"),
      openaiRequestsPerDay: 100,
      retrievalMode: "deterministic",
      openaiEmbeddingModel: "text-embedding-3-small",
      openaiApiKey: undefined,
    });
  });

  it("accepts one exact neutral personality rollback value", () => {
    expect(parsePublicDelegateConfig({
      JOLENE_PERSONALITY_MODE: "neutral",
    }).personalityMode).toBe("neutral");
    expect(() => parsePublicDelegateConfig({
      JOLENE_PERSONALITY_MODE: "off",
    })).toThrow();
  });

  it("requires an API key only when OpenAI answer synthesis is selected", () => {
    expect(parsePublicDelegateConfig({ OPENAI_API_KEY: "" })).toMatchObject({
      answerMode: "deterministic",
      openaiApiKey: undefined,
    });
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_ANSWER_MODE: "openai",
      OPENAI_API_KEY: "",
    })).toThrow();

    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_ANSWER_MODE: "openai",
      JOLENE_PUBLIC_OPENAI_MODEL: "test-model",
      JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: "2500",
      OPENAI_API_KEY: "test-key-not-real",
    })).toMatchObject({
      answerMode: "openai",
      openaiModel: "test-model",
      openaiTimeoutMilliseconds: 2_500,
      openaiApiKey: "test-key-not-real",
    });
  });

  it("requires OpenAI answer mode for hybrid public retrieval", () => {
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_RETRIEVAL_MODE: "hybrid",
    })).toThrow();
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_ANSWER_MODE: "openai",
      JOLENE_PUBLIC_RETRIEVAL_MODE: "hybrid",
      OPENAI_API_KEY: "test-key-not-real",
    })).toMatchObject({
      answerMode: "openai",
      retrievalMode: "hybrid",
      openaiEmbeddingModel: "text-embedding-3-small",
    });
  });

  it("requires a pinned safe URL for HTTPS artifact mode", () => {
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_ARTIFACT_SOURCE: "https",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_ARTIFACT_SOURCE: "https",
      JOLENE_PUBLIC_ARTIFACT_URL: "http://evidence.example.com/artifact.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: `career:${"a".repeat(64)}`,
    })).toThrow();
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_ARTIFACT_SOURCE: "https",
      JOLENE_PUBLIC_ARTIFACT_URL: "https://evidence.example.com/artifact.json",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: `career:${"a".repeat(64)}`,
    })).toMatchObject({
      artifactSource: "https",
      artifactUrl: "https://evidence.example.com/artifact.json",
      expectedCorpusVersion: `career:${"a".repeat(64)}`,
    });
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_ARTIFACT_SOURCE: "https",
      JOLENE_PUBLIC_ARTIFACT_URL: "http://127.0.0.1:9444/artifact.json",
      JOLENE_PUBLIC_ARTIFACT_ALLOW_LOOPBACK: "true",
      JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: `career:${"a".repeat(64)}`,
    }).artifactUrl).toBe("http://127.0.0.1:9444/artifact.json");
  });

  it("requires a strong API token when bearer authentication is selected", () => {
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: "too-short",
    })).toThrow();
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_AUTH_MODE: "bearer",
      JOLENE_PUBLIC_API_TOKEN: "a-dedicated-public-token-at-least-32-chars",
    })).toMatchObject({
      authMode: "bearer",
      apiToken: "a-dedicated-public-token-at-least-32-chars",
    });
  });

  it("strictly validates public admission configuration", () => {
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_ENABLED: "false",
      JOLENE_PUBLIC_REQUESTS_PER_MINUTE: "12",
      JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS: "3",
    })).toMatchObject({
      enabled: false,
      requestsPerMinute: 12,
      maxConcurrentRequests: 3,
    });
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_ENABLED: "yes",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_CONTAINER_MODE: "yes",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_OPERATIONS_HOST: "0.0.0.0",
    })).toThrow();
    expect(parsePublicDelegateConfig({
      JOLENE_PUBLIC_CONTAINER_MODE: "true",
      JOLENE_PUBLIC_OPERATIONS_HOST: "0.0.0.0",
      JOLENE_PUBLIC_OPERATIONS_PORT: "9444",
    })).toMatchObject({ operationsHost: "0.0.0.0", operationsPort: 9444 });
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_PORT: "8431",
      JOLENE_PUBLIC_OPERATIONS_PORT: "8431",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_REQUESTS_PER_MINUTE: "0",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS: "65",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_CONTACT_RETENTION_DAYS: "91",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES: "0",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_AUDIT_RETENTION_DAYS: "91",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_AUDIT_MAX_ENTRIES: "10001",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_OPENAI_TIMEOUT_MS: "999",
    })).toThrow();
    expect(() => parsePublicDelegateConfig({
      JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY: "0",
    })).toThrow();
  });

  it("serves the exact frozen v1 manifest with no-store security headers", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture));

    const response = await fetch(`${baseUrl}/v1/public-evidence/manifest`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fixture.manifest);
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      "corpusHash",
      "corpusVersion",
      "evidenceCount",
      "generatedAt",
      "reviewedAt",
      "revokedEvidenceIds",
      "schemaVersion",
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy"))
      .toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("requires the configured bearer token for v1 endpoints but not health", async () => {
    const fixture = await loadFixture();
    const token = "test-public-token-that-is-long-enough-123";
    const events: PublicAuditRecordInput[] = [];
    const { baseUrl } = await start(await writeArtifact(fixture), {
      apiToken: token,
      audits: { record: async (event) => void events.push(event) },
    });

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);

    const missing = await fetch(`${baseUrl}/v1/public-evidence/manifest`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(await missing.json()).toEqual(safeError("request_rejected"));

    const invalid = await fetch(`${baseUrl}/v1/public-evidence/manifest`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(invalid.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/v1/public-evidence/manifest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual(fixture.manifest);
    expect(events.map(({ outcome }) => outcome)).toEqual([
      "ok",
      "unauthorized",
      "unauthorized",
      "ok",
    ]);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("reports only public corpus health", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture));

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      schemaVersion: fixture.manifest.schemaVersion,
      corpusVersion: fixture.manifest.corpusVersion,
      evidenceCount: 0,
    });
  });

  it("accounts for public requests without retaining client or content dimensions", async () => {
    const fixture = await loadFixture();
    const telemetry = new InMemoryPublicOperationalTelemetry();
    const { baseUrl } = await start(await writeArtifact(fixture), { telemetry });
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/not-a-route`)).status).toBe(404);

    expect(telemetry.snapshot()).toMatchObject({
      totalRequests: 2,
      inFlight: 0,
      operations: { health: 1, unknown: 1 },
      methods: { GET: 2 },
      outcomes: { ok: 1, not_found: 1 },
      statusClasses: { successful: 1, clientError: 1 },
    });
  });

  it("fails closed at the runtime kill switch before reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
      { enabled: false },
    );

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(safeError("unavailable"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits a client with a non-disclosing bounded response", async () => {
    const fixture = await loadFixture();
    const admissions = new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1,
      maxConcurrentRequests: 2,
    });
    const { baseUrl } = await start(await writeArtifact(fixture), { admissions });

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(safeError("rate_limited", {
      retryAfterSeconds: 60,
    }));
  });

  it("audits admission and kill-switch outcomes without client identity", async () => {
    const events: PublicAuditRecordInput[] = [];
    const audits: PublicAuditRecorder = {
      record: async (event) => { events.push(event); },
    };
    const admissions = new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1,
      maxConcurrentRequests: 2,
    });
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture), {
      admissions,
      audits,
    });
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/health`)).status).toBe(429);
    const disabled = await start(await writeArtifact(fixture), {
      enabled: false,
      audits,
    });
    expect((await fetch(`${disabled.baseUrl}/health`)).status).toBe(503);

    expect(events.map((event) => event.outcome)).toEqual([
      "ok",
      "rate_limited",
      "disabled",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/remote|address|client|header|url/i);
  });

  it("fails closed with a sanitized response when shared admission is unavailable", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture), {
      admissions: {
        acquire: async () => {
          throw new Error("provider endpoint token and private client identity");
        },
      },
    });
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    const body = JSON.stringify(await response.json());
    expect(body).toContain("unavailable");
    expect(body).not.toContain("provider endpoint");
    expect(body).not.toContain("private client identity");
  });

  it("serves a frozen-contract answer from matching public evidence", async () => {
    const artifact = createPublicEvidenceArtifact();
    const { baseUrl } = await start(await writeArtifact(artifact));

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What React systems has Carl built?",
      }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
    });
    expect(body).not.toHaveProperty("sessionToken");
    expect(body.claims).toEqual([artifact.evidence[0]?.claim]);
    expect(body.citations).toEqual([artifact.evidence[0]?.citation]);
    expect(body).not.toHaveProperty("question");
    expect(String(body.answer)).not.toContain(
      "What React systems has Carl built?",
    );
  });

  it("serves a conversational greeting without unrelated evidence", async () => {
    const artifact = createPublicEvidenceArtifact();
    const { baseUrl } = await start(await writeArtifact(artifact));

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Hi" }),
    });
    const body = await response.json() as {
      readonly answer: string;
      readonly claims: readonly unknown[];
      readonly citations: readonly unknown[];
      readonly limitations: readonly string[];
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-jolene-answer-mode")).toBe("deterministic");
    expect(response.headers.get("x-jolene-response-kind")).toBe("clarification");
    expect(body.answer).toContain("I’m Jolene");
    expect(body.claims).toEqual([]);
    expect(body.citations).toEqual([]);
    expect(body.limitations).toEqual([]);
  });

  it("continues a bounded public project referent without a server-side transcript", async () => {
    const artifact = createPublicEvidenceArtifact([
      createPublicEvidenceRecord(1, {
        text: "Jolene uses a least-privilege public service boundary.",
        title: "Jolene AI security",
        href: "/work/jolene-ai#evidence-security",
      }),
      createPublicEvidenceRecord(2, {
        text: "A different product uses a separate security boundary.",
        title: "Different product",
        href: "/work/different-product#evidence-security",
      }),
    ]);
    const auditPath = path.join(await temporaryDirectory(), "audit.json");
    const audits = new FilePublicAuditLedger({
      filePath: auditPath,
      maxEntries: 100,
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    await audits.initialize();
    const { baseUrl } = await start(await writeArtifact(artifact), { audits });
    const first = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Tell me about Jolene." }),
    });
    const firstBody = await first.json() as Record<string, unknown>;
    const second = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What about its security boundary?",
        conversationContext: firstBody.conversationContext,
      }),
    });
    const secondBody = await second.json() as {
      readonly citations: readonly { readonly href: string }[];
      readonly conversationContext: {
        readonly projectPath: string;
        readonly turnCount: number;
      };
    };

    expect(second.status).toBe(200);
    expect(secondBody.conversationContext).toMatchObject({
      projectPath: "/work/jolene-ai",
      turnCount: 2,
    });
    expect(secondBody.citations.every(({ href }) => href.startsWith("/work/jolene-ai")))
      .toBe(true);
    const stored = await readFile(auditPath, "utf8");
    expect(stored).not.toMatch(/jolene-ai|security boundary|conversationContext/iu);
  });

  it("returns the contract no-evidence state for an empty public corpus", async () => {
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture));

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What systems has Carl built?" }),
    });
    const body = await response.json() as {
      readonly claims: readonly unknown[];
      readonly citations: readonly unknown[];
      readonly limitations: readonly string[];
    };

    expect(response.status).toBe(200);
    expect(body.claims).toEqual([]);
    expect(body.citations).toEqual([]);
    expect(body.limitations).toEqual([
      "No relevant published information was found for this question.",
    ]);
  });

  it("audits answer outcomes without retaining submitted or returned content", async () => {
    const artifact = createPublicEvidenceArtifact();
    const auditPath = path.join(await temporaryDirectory(), "audit.json");
    const audits = new FilePublicAuditLedger({
      filePath: auditPath,
      maxEntries: 100,
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    await audits.initialize();
    const { baseUrl } = await start(await writeArtifact(artifact), { audits });
    const question = "What React systems has Carl built? private-query-marker";

    expect((await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    })).status).toBe(200);

    const stored = await readFile(auditPath, "utf8");
    expect(stored).not.toContain(question);
    expect(stored).not.toContain(artifact.evidence[0]?.claim.text ?? "missing");
    expect(await audits.list()).toMatchObject([{
      operation: "answer",
      method: "POST",
      status: 200,
      outcome: "supported",
      corpusVersion: artifact.manifest.corpusVersion,
      counts: { claimCount: 1, citationCount: 1 },
    }]);
  });

  it("audits refusals without retaining invalid contact content", async () => {
    const auditPath = path.join(await temporaryDirectory(), "audit.json");
    const audits = new FilePublicAuditLedger({
      filePath: auditPath,
      maxEntries: 100,
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    await audits.initialize();
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
      { audits },
    );
    const privateMarker = "visitor-private-marker";

    expect((await fetch(`${baseUrl}/v1/portfolio/contact-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: privateMarker,
        email: "invalid",
        message: privateMarker,
        consent: true,
      }),
    })).status).toBe(400);

    const stored = await readFile(auditPath, "utf8");
    expect(stored).not.toContain(privateMarker);
    expect(await audits.list()).toMatchObject([{
      operation: "contact_intent",
      method: "POST",
      status: 400,
      outcome: "invalid_request",
    }]);
  });

  it("keeps safe responses available when audit recording fails", async () => {
    const audits: PublicAuditRecorder = {
      record: async () => { throw new Error("audit unavailable"); },
    };
    const fixture = await loadFixture();
    const { baseUrl } = await start(await writeArtifact(fixture), { audits });

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("blocks an unsafe answer before egress and audits only the fixed outcome", async () => {
    const artifact = createPublicEvidenceArtifact();
    const auditPath = path.join(await temporaryDirectory(), "audit.json");
    const audits = new FilePublicAuditLedger({
      filePath: auditPath,
      maxEntries: 100,
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    await audits.initialize();
    const unsafeValue = "/Users/carl/private-career-note.md";
    const baseline = new DeterministicPublicAnswerService();
    const answers: PublicPortfolioAnswerer = {
      execute: (source, request) => ({
        mode: "model",
        responseKind: "supported",
        response: {
          ...baseline.answer(source, request),
          answer: `Unsafe provider output ${unsafeValue}`,
        },
      }),
    };
    const { baseUrl } = await start(await writeArtifact(artifact), {
      answers,
      audits,
    });

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What React systems has Carl built?" }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual(safeError("unavailable"));
    expect(responseText).not.toContain(unsafeValue);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await audits.list()).toMatchObject([{
      operation: "answer",
      method: "POST",
      status: 503,
      outcome: "response_blocked",
    }]);
    expect(await readFile(auditPath, "utf8")).not.toContain(unsafeValue);
  });

  it("audits model and fallback answer modes without retaining content", async () => {
    const artifact = createPublicEvidenceArtifact();
    const events: PublicAuditRecordInput[] = [];
    const audits: PublicAuditRecorder = {
      record: async (event) => { events.push(event); },
    };
    const model = await start(await writeArtifact(artifact), {
      audits,
      answers: new GroundedPublicAnswerService({
        generate: async (input) => ({
          contractVersion: "1.0.0",
          corpusVersion: input.corpusVersion,
          segments: [{
            text: "Carl builds typed React product systems with explicit review boundaries.",
            supportIds: [input.evidence[0]!.evidenceId],
          }],
        }),
      }),
    });
    const fallback = await start(await writeArtifact(artifact), {
      audits,
      answers: new GroundedPublicAnswerService({
        generate: async () => { throw new Error("provider marker"); },
      }),
    });
    const budgetFallback = await start(await writeArtifact(artifact), {
      audits,
      answers: new GroundedPublicAnswerService({
        generate: async () => "must not run",
      }, {
        budget: { reserve: async () => false },
      }),
    });

    const responses = [];
    for (const baseUrl of [model.baseUrl, fallback.baseUrl, budgetFallback.baseUrl]) {
      const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What React systems has Carl built?" }),
      });
      expect(response.status).toBe(200);
      responses.push(response);
    }

    expect(events.map((event) => event.outcome)).toEqual([
      "model_supported",
      "provider_fallback",
      "budget_fallback",
    ]);
    expect(events.map((event) => [event.answerMode, event.responseKind])).toEqual([
      ["model", "supported"],
      ["provider_fallback", "supported"],
      ["budget_fallback", "supported"],
    ]);
    expect(responses.map((response) => [
      response.headers.get("x-jolene-answer-mode"),
      response.headers.get("x-jolene-response-kind"),
    ])).toEqual([
      ["model", "supported"],
      ["provider_fallback", "supported"],
      ["budget_fallback", "supported"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/concise grounded|provider marker/i);
  });

  it.each([
    ["invalid JSON", "application/json", "{invalid", 400, "invalid_json"],
    [
      "wrong content type",
      "text/plain",
      JSON.stringify({ question: "Valid question" }),
      415,
      "unsupported_media_type",
    ],
    [
      "oversized question",
      "application/json",
      JSON.stringify({ question: "x".repeat(801) }),
      400,
      "invalid_request",
    ],
    [
      "extra field",
      "application/json",
      JSON.stringify({ question: "Valid question", extra: true }),
      400,
      "invalid_request",
    ],
    [
      "oversized body",
      "application/json",
      JSON.stringify({ question: "Valid", padding: "x".repeat(99_000) }),
      413,
      "payload_too_large",
    ],
  ])("rejects %s", async (_name, contentType, body, status, _code) => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(safeError("invalid_request"));
  });

  it("fails closed when valid answer input has no valid artifact", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What has Carl built?" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(safeError("unavailable"));
  });

  it("serves a conservative frozen-contract job-fit comparison", async () => {
    const artifact = createPublicEvidenceArtifact();
    const { baseUrl } = await start(await writeArtifact(artifact));

    const response = await fetch(`${baseUrl}/v1/portfolio/job-fit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobDescription: [
          "Typed React product systems.",
          "Kubernetes operations.",
        ].join("\n"),
      }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
    });
    expect(body).not.toHaveProperty("sessionToken");
    expect(body.requirements).toMatchObject([
      { assessment: "direct", evidenceIds: [artifact.evidence[0]?.evidenceId] },
      { assessment: "unknown", evidenceIds: [] },
    ]);
    expect(body.citations).toEqual([artifact.evidence[0]?.citation]);
    expect(body).not.toHaveProperty("jobDescription");
    expect(JSON.stringify(body)).not.toContain("Typed React product systems.\n");
  });

  it("stages a consented contact intent without reading career evidence", async () => {
    const { baseUrl, contactQueuePath } = await start(
      path.join(await temporaryDirectory(), "missing-artifact.json"),
    );
    const request = {
      name: "Recruiter Name",
      email: "recruiter@example.com",
      organization: "Example Company",
      message: "Would Carl be interested in discussing a product role?",
      consent: true,
    };

    const response = await fetch(`${baseUrl}/v1/portfolio/contact-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      schemaVersion: "1.0.0",
      status: "pending_review",
      message: "Your contact request is queued for Carl's review.",
    });
    expect(body.intentId).toEqual(expect.any(String));
    expect(body.submittedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(request.email);
    expect(JSON.stringify(body)).not.toContain(request.message);
    const stored = JSON.parse(await readFile(contactQueuePath, "utf8")) as {
      readonly intents: readonly Record<string, unknown>[];
    };
    expect(stored.intents).toMatchObject([request]);
  });

  it.each([
    ["missing consent", { name: "A", email: "a@example.com", message: "Hi" }],
    [
      "false consent",
      { name: "A", email: "a@example.com", message: "Hi", consent: false },
    ],
    [
      "invalid email",
      { name: "A", email: "invalid", message: "Hi", consent: true },
    ],
    [
      "likely secret",
      {
        name: "A",
        email: "a@example.com",
        message: `Credential sk-${"a".repeat(32)}`,
        consent: true,
      },
    ],
    [
      "extra field",
      {
        name: "A",
        email: "a@example.com",
        message: "Hi",
        consent: true,
        extra: true,
      },
    ],
  ])("rejects contact intent with %s", async (_name, request) => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing-artifact.json"),
    );
    const response = await fetch(`${baseUrl}/v1/portfolio/contact-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(safeError("invalid_request"));
  });

  it("fails closed without disclosing contact queue errors", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing-artifact.json"),
      {
        contactIntents: {
          stage: async () => {
            throw new PublicContactQueueUnavailableError();
          },
        },
      },
    );
    const response = await fetch(`${baseUrl}/v1/portfolio/contact-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A",
        email: "a@example.com",
        message: "Hello",
        consent: true,
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(safeError("unavailable"));
  });

  it.each([
    [
      "oversized job description",
      JSON.stringify({ jobDescription: "x".repeat(12_001) }),
      400,
      "invalid_request",
    ],
    [
      "extra job-fit field",
      JSON.stringify({ jobDescription: "React", extra: true }),
      400,
      "invalid_request",
    ],
    [
      "oversized job-fit body",
      JSON.stringify({ jobDescription: "React", padding: "x".repeat(99_000) }),
      413,
      "payload_too_large",
    ],
  ])("rejects %s", async (_name, body, status, _code) => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );
    const response = await fetch(`${baseUrl}/v1/portfolio/job-fit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(safeError("invalid_request"));
  });

  it.each([
    "missing",
    "malformed",
    "schema_mismatch",
    "hash_mismatch",
  ] as const)(
    "fails closed for a %s artifact without disclosing details",
    async (scenario) => {
      const fixture = await loadFixture();
      const artifactPath = scenario === "missing"
        ? path.join(await temporaryDirectory(), "missing.json")
        : scenario === "malformed"
          ? await writeArtifact("{not-json")
          : scenario === "schema_mismatch"
            ? await writeArtifact({
                ...fixture,
                manifest: { ...fixture.manifest, schemaVersion: "2.0.0" },
              })
            : await writeArtifact({
                ...fixture,
                manifest: {
                  ...fixture.manifest,
                  corpusHash: `sha256:${"0".repeat(64)}`,
                  corpusVersion: `career:${"0".repeat(64)}`,
                },
              });
      const { baseUrl } = await start(artifactPath);

      const response = await fetch(`${baseUrl}/v1/public-evidence/manifest`);
      const responseText = await response.text();

      expect(response.status).toBe(503);
      expect(JSON.parse(responseText)).toEqual(
        scenario === "schema_mismatch"
          ? safeError("version_mismatch", {
              supportedSchemaVersions: ["1.0.0"],
            })
          : safeError("unavailable"),
      );
      expect(responseText).not.toContain(artifactPath);
    },
  );

  it("rejects unsupported methods and unknown routes without reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const method = await fetch(`${baseUrl}/v1/public-evidence/manifest`, {
      method: "POST",
    });
    const unknown = await fetch(`${baseUrl}/v1/private-memory`);
    const answerMethod = await fetch(`${baseUrl}/v1/portfolio/answer`);
    const jobFitMethod = await fetch(`${baseUrl}/v1/portfolio/job-fit`);
    const contactMethod = await fetch(`${baseUrl}/v1/portfolio/contact-intent`);
    const queueRead = await fetch(`${baseUrl}/v1/portfolio/contact-intents`);

    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(await method.json()).toEqual(safeError("request_rejected"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(safeError("request_rejected"));
    expect(answerMethod.status).toBe(405);
    expect(answerMethod.headers.get("allow")).toBe("POST");
    expect(jobFitMethod.status).toBe(405);
    expect(jobFitMethod.headers.get("allow")).toBe("POST");
    expect(contactMethod.status).toBe(405);
    expect(contactMethod.headers.get("allow")).toBe("POST");
    expect(queueRead.status).toBe(404);
  });

  it("bounds request URLs before reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const response = await fetch(`${baseUrl}/${"x".repeat(2_100)}`);

    expect(response.status).toBe(414);
    expect(await response.json()).toEqual(safeError("request_rejected"));
  });

  it("reloads and validates the artifact for each request", async () => {
    const fixture = await loadFixture();
    const artifactPath = await writeArtifact(fixture);
    const { baseUrl } = await start(artifactPath);

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    await writeFile(artifactPath, "{invalid", "utf8");

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(safeError("unavailable"));
  });

  it("keeps the public entrypoint free of private runtime imports", async () => {
    const files = [
      "src/public-server.ts",
      "src/public/public-config.ts",
      "src/public/public-artifact-source.ts",
      "src/public/public-answer-service.ts",
      "src/public/openai-public-answer-generator.ts",
      "src/public/public-job-fit-service.ts",
      "src/public/public-request-admission.ts",
      "src/public/public-contact-intent-queue.ts",
      "src/public/public-delegate-server.ts",
    ];
    const source = (await Promise.all(
      files.map((file) => readFile(path.resolve(file), "utf8")),
    )).join("\n");

    for (const forbidden of [
      "./app.js",
      "../config.js",
      "/persistence/",
      "/knowledge/",
      "/slack/",
      "sqlite",
      "obsidian",
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

async function loadFixture() {
  return JSON.parse(
    await readFile(
      path.resolve("contracts/fixtures/public-career-evidence-empty.json"),
      "utf8",
    ),
  ) as {
    readonly manifest: Record<string, unknown>;
    readonly evidence: readonly unknown[];
  };
}

async function writeArtifact(value: unknown): Promise<string> {
  const artifactPath = path.join(await temporaryDirectory(), "artifact.json");
  await writeFile(
    artifactPath,
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  );
  return artifactPath;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jolene-public-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function start(
  artifactPath: string,
  overrides: {
    readonly enabled?: boolean;
    readonly admissions?: PublicRequestAdmissionController;
    readonly contactIntents?: PublicContactIntentStager;
    readonly audits?: PublicAuditRecorder;
    readonly answers?: PublicPortfolioAnswerer;
    readonly telemetry?: PublicOperationalTelemetry;
    readonly apiToken?: string;
  } = {},
): Promise<{
  readonly baseUrl: string;
  readonly contactQueuePath: string;
}> {
  const contactQueuePath = path.join(
    await temporaryDirectory(),
    "contact-intents.json",
  );
  const server = createPublicDelegateServer({
    enabled: overrides.enabled ?? true,
    artifacts: new FilePublicArtifactSource(artifactPath),
    answers: overrides.answers ?? new DeterministicPublicAnswerService(),
    jobFit: new DeterministicPublicJobFitService(),
    contactIntents: overrides.contactIntents ?? new FilePublicContactIntentQueue({
      filePath: contactQueuePath,
      maxEntries: 500,
      retentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
    }),
    admissions: overrides.admissions ?? new FixedWindowPublicRequestAdmission({
      requestsPerWindow: 1_000,
      maxConcurrentRequests: 10,
    }),
    requestId: () => testRequestId,
    ...(overrides.apiToken ? { apiToken: overrides.apiToken } : {}),
    ...(overrides.telemetry ? { telemetry: overrides.telemetry } : {}),
    ...(overrides.audits ? { audits: overrides.audits } : {}),
  });
  openServers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    contactQueuePath,
  };
}

async function close(server: ReturnType<typeof createPublicDelegateServer>) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function safeError(
  code: PublicJoleneErrorCode,
  extras: Readonly<Record<string, unknown>> = {},
) {
  const messages: Readonly<Record<PublicJoleneErrorCode, string>> = {
    invalid_request: "The request could not be accepted.",
    unavailable: "Public Jolene is temporarily unavailable.",
    rate_limited: "Too many requests. Please try again later.",
    budget_exhausted: "The public response budget is temporarily exhausted.",
    version_mismatch: "This public Jolene response version is not supported.",
    request_rejected: "The requested operation is not available.",
  };
  return {
    schemaVersion: "1.0.0",
    code,
    message: messages[code],
    requestId: testRequestId,
    ...extras,
  };
}
