import OpenAI from "openai";

import { loadPublicDelegateConfig } from "./public/public-config.js";
import {
  FilePublicArtifactSource,
  HttpsPublicArtifactSource,
} from "./public/public-artifact-source.js";
import {
  DeterministicPublicAnswerService,
  GroundedPublicAnswerService,
} from "./public/public-answer-service.js";
import { createPublicDelegateServer } from "./public/public-delegate-server.js";
import { DeterministicPublicJobFitService } from "./public/public-job-fit-service.js";
import { FixedWindowPublicRequestAdmission } from "./public/public-request-admission.js";
import { FilePublicContactIntentQueue } from "./public/public-contact-intent-queue.js";
import { FilePublicAuditLedger } from "./public/public-audit-ledger.js";
import { OpenAIPublicAnswerGenerator } from "./public/openai-public-answer-generator.js";
import { OpenAIPublicEmbeddingProvider } from
  "./public/openai-public-embedding-provider.js";
import { HybridPublicEvidenceRetriever } from
  "./public/public-hybrid-evidence-retriever.js";
import {
  FilePublicModelRequestBudget,
} from "./public/public-model-request-budget.js";
import {
  buildPublicReadinessSnapshot,
  createPublicOperationsServer,
} from "./public/public-operations-server.js";
import {
  InMemoryPublicOperationalTelemetry,
} from "./public/public-operational-telemetry.js";
import { closePublicServers } from "./public/public-server-lifecycle.js";

const config = loadPublicDelegateConfig();
const artifactSource = config.artifactSource === "https"
  ? new HttpsPublicArtifactSource({
      url: requireArtifactUrl(config.artifactUrl),
      expectedCorpusVersion: requireExpectedCorpusVersion(
        config.expectedCorpusVersion,
      ),
      timeoutMilliseconds: config.artifactTimeoutMilliseconds,
    })
  : new FilePublicArtifactSource(config.artifactPath);
const telemetry = new InMemoryPublicOperationalTelemetry();
const modelBudget = config.answerMode === "openai"
  ? new FilePublicModelRequestBudget({
      filePath: config.openaiBudgetPath,
      maxRequestsPerWindow: config.openaiRequestsPerDay,
      windowMilliseconds: 24 * 60 * 60 * 1_000,
    })
  : undefined;
let modelBudgetAvailable = true;
if (config.enabled && modelBudget) {
  await modelBudget.initialize().catch(() => {
    modelBudgetAvailable = false;
    process.stderr.write(
      "Jolene public model budget is unavailable; model generation is disabled.\n",
    );
  });
}
const activeModelBudget = modelBudget && modelBudgetAvailable
  ? modelBudget
  : { reserve: async () => false };
const answers = config.answerMode === "openai"
  ? new GroundedPublicAnswerService(new OpenAIPublicAnswerGenerator({
      client: new OpenAI({ apiKey: requireOpenAIApiKey(config.openaiApiKey) }),
      model: config.openaiModel,
      timeoutMilliseconds: config.openaiTimeoutMilliseconds,
      personalityMode: config.personalityMode,
    }), {
      budget: activeModelBudget,
      ...(config.retrievalMode === "hybrid"
        ? {
          retriever: new HybridPublicEvidenceRetriever(
            new OpenAIPublicEmbeddingProvider(
              config.openaiEmbeddingModel,
              requireOpenAIApiKey(config.openaiApiKey),
            ),
          ),
        }
        : {}),
    })
  : new DeterministicPublicAnswerService();
const contactIntents = new FilePublicContactIntentQueue({
  filePath: config.contactQueuePath,
  maxEntries: config.contactQueueMaxEntries,
  retentionMilliseconds: config.contactRetentionDays * 24 * 60 * 60 * 1_000,
});
let contactQueueAvailable = true;
if (config.enabled) {
  await contactIntents.initialize().catch(() => {
    contactQueueAvailable = false;
    process.stderr.write(
      "Jolene public contact queue is unavailable; contact staging is disabled.\n",
    );
  });
}
const audits = new FilePublicAuditLedger({
  filePath: config.auditPath,
  maxEntries: config.auditMaxEntries,
  retentionMilliseconds: config.auditRetentionDays * 24 * 60 * 60 * 1_000,
});
let auditAvailable = true;
await audits.initialize().catch(() => {
  auditAvailable = false;
  process.stderr.write(
    "Jolene public audit ledger is unavailable; public responses remain isolated.\n",
  );
});
const server = createPublicDelegateServer({
  enabled: config.enabled,
  artifacts: artifactSource,
  answers,
  jobFit: new DeterministicPublicJobFitService(),
  contactIntents,
  audits,
  telemetry,
  admissions: new FixedWindowPublicRequestAdmission({
    requestsPerWindow: config.requestsPerMinute,
    maxConcurrentRequests: config.maxConcurrentRequests,
  }),
  ...(config.authMode === "bearer" && config.apiToken
    ? { apiToken: config.apiToken }
    : {}),
});
const operationsServer = createPublicOperationsServer({
  telemetry,
  readiness: async () => {
    const publicEvidenceReady = await artifactSource.read()
      .then((artifact) => Boolean(artifact))
      .catch(() => false);
    return buildPublicReadinessSnapshot({
      checkedAt: new Date(),
      delegateEnabled: config.enabled,
      publicEvidenceReady,
      contactIntentQueueReady: contactQueueAvailable,
      auditLedgerReady: auditAvailable,
      modelRequestBudget: config.answerMode === "deterministic"
        ? "not_required"
        : modelBudgetAvailable
          ? "ready"
          : "unavailable",
    });
  },
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Jolene public delegate is listening at http://${config.host}:${config.port}\n`,
  );
});
operationsServer.listen(config.operationsPort, config.operationsHost, () => {
  process.stdout.write(
    `Jolene public operations is listening at http://${config.operationsHost}:${config.operationsPort}\n`,
  );
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const result = await closePublicServers([server, operationsServer]);
    process.exit(result.forced ? 1 : 0);
  });
}

function requireOpenAIApiKey(value: string | undefined): string {
  if (!value) throw new Error("Public OpenAI mode requires an API key.");
  return value;
}

function requireArtifactUrl(value: string | undefined): string {
  if (!value) throw new Error("HTTPS public artifact mode requires a URL.");
  return value;
}

function requireExpectedCorpusVersion(value: string | undefined): string {
  if (!value) {
    throw new Error("HTTPS public artifact mode requires an expected corpus version.");
  }
  return value;
}
