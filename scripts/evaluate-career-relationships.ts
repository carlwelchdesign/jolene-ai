import { readFile } from "node:fs/promises";
import path from "node:path";

import { evaluateCareerRelationshipSuite } from
  "../src/evaluation/career-relationship-evaluation.js";

const fixturePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "evaluations/career-relationship-v1.json",
);

try {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  const report = await evaluateCareerRelationshipSuite(fixture);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.gate === "fail") process.exitCode = 1;
} catch {
  process.stderr.write(
    "Career relationship evaluation fixture is invalid or unavailable.\n",
  );
  process.exitCode = 2;
}
