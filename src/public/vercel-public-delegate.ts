import type { IncomingMessage } from "node:http";

import { z } from "zod";

import { DeterministicPublicAnswerService } from "./public-answer-service.js";
import {
  HttpsPublicArtifactSource,
} from "./public-artifact-source.js";
import {
  createPublicDelegateRequestHandler,
} from "./public-delegate-server.js";
import { DeterministicPublicJobFitService } from "./public-job-fit-service.js";
import { FixedWindowPublicRequestAdmission } from "./public-request-admission.js";
import { PublicContactQueueUnavailableError } from "./public-contact-intent-queue.js";

const vercelPublicEnvironmentSchema = z.object({
  JOLENE_PUBLIC_ENABLED: z.literal("true"),
  JOLENE_PUBLIC_AUTH_MODE: z.literal("bearer"),
  JOLENE_PUBLIC_API_TOKEN: z.string().trim().min(32),
  JOLENE_PUBLIC_ARTIFACT_URL: z.string().url().startsWith("https://"),
  JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION: z.string()
    .regex(/^career:[a-f0-9]{64}$/),
  JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS: z.coerce.number().int().min(1_000)
    .max(30_000).default(5_000),
  JOLENE_PUBLIC_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600)
    .default(60),
  JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(64)
    .default(8),
});

export function createVercelPublicDelegateHandler(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = vercelPublicEnvironmentSchema.parse(environment);
  const artifacts = new HttpsPublicArtifactSource({
    url: config.JOLENE_PUBLIC_ARTIFACT_URL,
    expectedCorpusVersion: config.JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION,
    timeoutMilliseconds: config.JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS,
  });

  return createPublicDelegateRequestHandler({
    enabled: true,
    artifacts,
    answers: new DeterministicPublicAnswerService(),
    jobFit: new DeterministicPublicJobFitService(),
    contactIntents: {
      stage: async () => {
        throw new PublicContactQueueUnavailableError();
      },
    },
    admissions: new FixedWindowPublicRequestAdmission({
      requestsPerWindow: config.JOLENE_PUBLIC_REQUESTS_PER_MINUTE,
      maxConcurrentRequests: config.JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS,
    }),
    clientKey: vercelClientKey,
    apiToken: config.JOLENE_PUBLIC_API_TOKEN,
  });
}

function vercelClientKey(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",", 1)[0]?.trim() ||
    request.socket.remoteAddress ||
    "unknown";
}
