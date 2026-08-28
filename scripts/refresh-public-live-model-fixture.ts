import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { publicCareerEvidenceArtifactSchema } from "../src/domain/public-career-evidence.js";
import { refreshPublicLiveModelEvaluationSuite } from
  "../src/evaluation/public-live-model-fixture-refresh.js";
import { publicLiveModelEvaluationSuiteSchema } from
  "../src/evaluation/public-live-model-evaluation.js";

const fixturePath = path.resolve(
  argumentValue("--fixture") ?? "evaluations/public-live-model-v1.json",
);
const artifactPath = path.resolve(
  argumentValue("--artifact") ?? ".jolene/exports/public-career-evidence.json",
);
const [template, artifact] = await Promise.all([
  readFile(fixturePath, "utf8").then((value) =>
    publicLiveModelEvaluationSuiteSchema.parse(JSON.parse(value))),
  readFile(artifactPath, "utf8").then((value) =>
    publicCareerEvidenceArtifactSchema.parse(JSON.parse(value))),
]);
const refreshed = refreshPublicLiveModelEvaluationSuite({ template, artifact });
const temporaryPath = `${fixturePath}.${process.pid}.${randomUUID()}.tmp`;
try {
  await writeFile(temporaryPath, `${JSON.stringify(refreshed, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, fixturePath);
} finally {
  await rm(temporaryPath, { force: true });
}
process.stdout.write(`${JSON.stringify({
  fixtureRefreshed: true,
  corpusVersion: refreshed.corpusVersion,
  evidenceCount: refreshed.evidence.length,
  caseCount: refreshed.cases.length,
}, null, 2)}\n`);

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}
