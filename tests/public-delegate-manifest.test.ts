import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FilePublicArtifactSource } from "../src/public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from "../src/public/public-answer-service.js";
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
import { createPublicEvidenceArtifact } from "./helpers/public-evidence-fixture.js";

const temporaryDirectories: string[] = [];
const openServers: ReturnType<typeof createPublicDelegateServer>[] = [];

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

    expect(config).toEqual({
      enabled: true,
      host: "127.0.0.1",
      port: 8431,
      artifactPath: path.resolve(
        ".jolene/exports/public-career-evidence.json",
      ),
      contactQueuePath: path.resolve(
        ".jolene/public/contact-intents.json",
      ),
      contactRetentionDays: 30,
      contactQueueMaxEntries: 500,
      requestsPerMinute: 60,
      maxConcurrentRequests: 8,
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

  it("fails closed at the runtime kill switch before reading evidence", async () => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
      { enabled: false },
    );

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      error: "public_delegate_disabled",
    });
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
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  it("serves a frozen-contract answer from matching public evidence", async () => {
    const artifact = createPublicEvidenceArtifact();
    const { baseUrl } = await start(await writeArtifact(artifact));

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What React systems has Carl built?",
        sessionToken: "test-session",
      }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
      sessionToken: "test-session",
    });
    expect(body.claims).toEqual([artifact.evidence[0]?.claim]);
    expect(body.citations).toEqual([artifact.evidence[0]?.citation]);
    expect(body).not.toHaveProperty("question");
    expect(String(body.answer)).not.toContain(
      "What React systems has Carl built?",
    );
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
      "No matching public-approved evidence was available.",
    ]);
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
  ])("rejects %s", async (_name, contentType, body, status, code) => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );

    const response = await fetch(`${baseUrl}/v1/portfolio/answer`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
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
    expect(await response.json()).toEqual({
      status: "unavailable",
      error: "public_evidence_unavailable",
    });
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
        sessionToken: "test-session",
      }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
      sessionToken: "test-session",
    });
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
    expect(await response.json()).toEqual({ error: "invalid_request" });
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
    expect(await response.json()).toEqual({
      status: "unavailable",
      error: "contact_queue_unavailable",
    });
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
  ])("rejects %s", async (_name, body, status, code) => {
    const { baseUrl } = await start(
      path.join(await temporaryDirectory(), "missing.json"),
    );
    const response = await fetch(`${baseUrl}/v1/portfolio/job-fit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
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
      expect(JSON.parse(responseText)).toEqual({
        status: "unavailable",
        error: "public_evidence_unavailable",
      });
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
    expect(await method.json()).toEqual({ error: "method_not_allowed" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
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
    expect(await response.json()).toEqual({ error: "uri_too_long" });
  });

  it("reloads and validates the artifact for each request", async () => {
    const fixture = await loadFixture();
    const artifactPath = await writeArtifact(fixture);
    const { baseUrl } = await start(artifactPath);

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    await writeFile(artifactPath, "{invalid", "utf8");

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      error: "public_evidence_unavailable",
    });
  });

  it("keeps the public entrypoint free of private runtime imports", async () => {
    const files = [
      "src/public-server.ts",
      "src/public/public-config.ts",
      "src/public/public-artifact-source.ts",
      "src/public/public-answer-service.ts",
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
      "OPENAI_API_KEY",
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
    answers: new DeterministicPublicAnswerService(),
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
