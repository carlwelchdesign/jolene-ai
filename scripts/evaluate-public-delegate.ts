import { readFile } from "node:fs/promises";
import path from "node:path";

import { evaluatePublicDelegateSuite } from
  "../src/evaluation/public-delegate-evaluation.js";

const fixturePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "evaluations/public-delegate-v1.json",
);

try {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  const report = await evaluatePublicDelegateSuite(fixture);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.gate === "fail") process.exitCode = 1;
} catch {
  process.stderr.write("Public delegate evaluation fixture is invalid or unavailable.\n");
  process.exitCode = 2;
}
