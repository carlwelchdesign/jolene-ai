import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  privateRagNamespaceSchema,
  privateRagProviderPayloadClassSchema,
  privateRagRiskSignalSchema,
} from "../src/domain/private-rag-policy.js";
import { untrustedContentOriginKindSchema } from
  "../src/domain/untrusted-content.js";

const fixtureSchema = z.object({
  schemaVersion: z.literal("jolene.private-rag-security-evaluation.v1"),
  cases: z.array(z.object({
    id: z.string().min(1),
    originKind: untrustedContentOriginKindSchema,
    namespace: privateRagNamespaceSchema,
    providerPayloadClass: privateRagProviderPayloadClassSchema,
    sourceId: z.string().min(1),
    fragments: z.array(z.string().min(1)).min(1),
    expected: z.object({
      provider: z.enum(["allow", "deny"]),
      signals: z.array(privateRagRiskSignalSchema),
    }).strict(),
  }).strict()).min(20),
}).strict();

const requiredCaseIds = [
  "poisoned-note-body",
  "poisoned-heading-metadata",
  "cross-note-link-directive",
  "recommendation-injection",
  "durable-memory-injection",
  "history-injection",
  "task-event-injection",
  "tool-result-injection",
  "external-ai-injection",
  "split-turn-injection",
  "retrieval-expansion",
  "percent-encoding",
  "html-entity-encoding",
  "unicode-normalization",
  "base64-secret",
  "credential",
  "absolute-private-path",
  "obsidian-uri",
  "private-host",
  "contact-data",
  "payload-class-drift",
  "namespace-drift",
  "useful-recipe",
  "useful-personal-note",
  "useful-recommendation",
] as const;

const requiredFiles = [
  "docs/private-rag-security.md",
  "evaluations/private-rag-security-v1.json",
  "src/domain/private-rag-policy.ts",
  "src/application/private-rag-provider-gate.ts",
  "src/application/private-rag-security-coordinator.ts",
  "src/persistence/sqlite-private-rag-security-store.ts",
  "tests/private-rag-adversarial-evaluation.test.ts",
  "tests/private-rag-security.test.ts",
  "tests/agent-runner-input.test.ts",
] as const;

const requiredRuntimeMarkers: ReadonlyArray<[string, string]> = [
  ["src/agent/agent-runner.ts", "preparePrivateRunContext("],
  ["src/agent/agent-runner.ts", "gateToolObservations("],
  ["src/application/private-rag-provider-gate.ts", "detectPrivateRagCollectionRiskSignals("],
  ["src/application/private-rag-provider-gate.ts", "provider_payload_drift"],
  ["src/application/private-rag-security-coordinator.ts", 'destination: "model_copy"'],
  ["src/persistence/sqlite-private-rag-security-store.ts", "invalidateDerivations("],
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validatePrivateRagSecurity(projectRoot = process.cwd()) {
  for (const path of requiredFiles) {
    assert(existsSync(resolve(projectRoot, path)), `Missing private-RAG artifact: ${path}`);
  }
  const suite = fixtureSchema.parse(JSON.parse(readFileSync(
    resolve(projectRoot, "evaluations/private-rag-security-v1.json"),
    "utf8",
  )));
  const ids = suite.cases.map(({ id }) => id);
  assert(new Set(ids).size === ids.length, "Private-RAG fixture IDs must be unique");
  for (const id of requiredCaseIds) {
    assert(ids.includes(id), `Missing required private-RAG fixture: ${id}`);
  }
  assert(
    suite.cases.some(({ expected }) => expected.provider === "allow") &&
      suite.cases.some(({ expected }) => expected.provider === "deny"),
    "Private-RAG fixtures must include usefulness and adversarial cases",
  );
  for (const [path, marker] of requiredRuntimeMarkers) {
    assert(
      readFileSync(resolve(projectRoot, path), "utf8").includes(marker),
      `Missing private-RAG runtime marker ${marker} in ${path}`,
    );
  }
  const documentation = readFileSync(
    resolve(projectRoot, "docs/private-rag-security.md"),
    "utf8",
  ).toLocaleLowerCase("en-US");
  for (const boundary of [
    "local_only",
    "approved_openai",
    "authority `none`",
    "residual risk",
    "private career mcp",
    "no consequential or mutating capability",
  ]) {
    assert(documentation.includes(boundary), `Missing documented boundary: ${boundary}`);
  }
  return Object.freeze({
    schemaVersion: suite.schemaVersion,
    cases: suite.cases.length,
    allowedCases: suite.cases.filter(({ expected }) =>
      expected.provider === "allow"
    ).length,
    deniedCases: suite.cases.filter(({ expected }) =>
      expected.provider === "deny"
    ).length,
    runtimeMarkers: requiredRuntimeMarkers.length,
  });
}

function main(): void {
  const summary = validatePrivateRagSecurity();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
