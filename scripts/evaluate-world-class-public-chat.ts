import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { evaluateWorldClassPublicChatSuite } from
  "../src/evaluation/world-class-public-chat-evaluation.js";
import { publicCareerEvidenceArtifactSchema } from
  "../src/domain/public-career-evidence.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";

const suitePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "evaluations/world-class-public-chat-v1.json",
);
const artifactPath = path.resolve(
  process.cwd(),
  process.argv[3] ?? ".jolene/exports/public-career-evidence.json",
);
const outputDirectory = path.resolve(
  process.cwd(),
  process.argv[4] ?? ".jolene/evaluations",
);
const reportPath = path.join(outputDirectory, "world-class-public-chat-report.json");
const reviewPath = path.join(outputDirectory, "world-class-public-chat-review.json");

try {
  const [suite, artifactInput] = await Promise.all([
    readJson(suitePath),
    readJson(artifactPath),
  ]);
  const artifact = publicCareerEvidenceArtifactSchema.parse(artifactInput);
  const answerer = new DeterministicPublicAnswerService();
  const result = await evaluateWorldClassPublicChatSuite(
    suite,
    artifact,
    {
      respond: async (input) => ({
        execution: answerer.execute(artifact, input),
      }),
    },
  );

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writePrivateJson(reportPath, result.report),
    writePrivateJson(reviewPath, result.reviewPacket),
  ]);

  process.stdout.write(`${JSON.stringify({
    suiteVersion: result.report.suiteVersion,
    suiteHash: result.report.suiteHash,
    corpusVersion: result.report.corpusVersion,
    gate: result.report.gate,
    humanReview: result.report.humanReview,
    counts: result.report.counts,
    metrics: result.report.metrics,
    p95LatencyMilliseconds: result.report.p95LatencyMilliseconds,
    reportPath: path.relative(process.cwd(), reportPath),
    reviewPath: path.relative(process.cwd(), reviewPath),
  }, null, 2)}\n`);
  if (result.report.gate === "fail") process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `World-class public chat evaluation failed: ${errorMessage(error)}\n`,
  );
  process.exitCode = 2;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
