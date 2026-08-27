import OpenAI from "openai";

import { loadPublicDelegateConfig } from "./public/public-config.js";
import { FilePublicArtifactSource } from "./public/public-artifact-source.js";
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
import {
  FilePublicModelRequestBudget,
} from "./public/public-model-request-budget.js";

const config = loadPublicDelegateConfig();
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
    }), {
      budget: activeModelBudget,
    })
  : new DeterministicPublicAnswerService();
const contactIntents = new FilePublicContactIntentQueue({
  filePath: config.contactQueuePath,
  maxEntries: config.contactQueueMaxEntries,
  retentionMilliseconds: config.contactRetentionDays * 24 * 60 * 60 * 1_000,
});
if (config.enabled) await contactIntents.initialize();
const audits = new FilePublicAuditLedger({
  filePath: config.auditPath,
  maxEntries: config.auditMaxEntries,
  retentionMilliseconds: config.auditRetentionDays * 24 * 60 * 60 * 1_000,
});
await audits.initialize().catch(() => {
  process.stderr.write(
    "Jolene public audit ledger is unavailable; public responses remain isolated.\n",
  );
});
const server = createPublicDelegateServer({
  enabled: config.enabled,
  artifacts: new FilePublicArtifactSource(config.artifactPath),
  answers,
  jobFit: new DeterministicPublicJobFitService(),
  contactIntents,
  audits,
  admissions: new FixedWindowPublicRequestAdmission({
    requestsPerWindow: config.requestsPerMinute,
    maxConcurrentRequests: config.maxConcurrentRequests,
  }),
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Jolene public delegate is listening at http://${config.host}:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

function requireOpenAIApiKey(value: string | undefined): string {
  if (!value) throw new Error("Public OpenAI mode requires an API key.");
  return value;
}
