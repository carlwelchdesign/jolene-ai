import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import ts from "typescript";

import { PortfolioEvidenceImporter } from "../src/application/portfolio-evidence-importer.js";
import {
  createPortfolioEvidenceImportReviewPacket,
  runPortfolioEvidenceImportAudit,
} from "../src/application/portfolio-evidence-import-audit.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";
import { writePortfolioEvidenceImportReviewPacket } from "../src/publication/portfolio-evidence-import-review-writer.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const portfolioRoot = path.resolve(
  process.env.JOLENE_PORTFOLIO_ROOT ??
    path.resolve(process.cwd(), "../carl-welch-portfolio"),
);
const databasePath = path.resolve(
  process.cwd(),
  process.env.JOLENE_DATABASE_PATH ?? ".jolene/jolene.sqlite",
);
const reviewPacketPath = path.resolve(
  process.cwd(),
  process.env.JOLENE_PUBLIC_CORPUS_REVIEW_PACKET_PATH ??
    ".jolene/evaluations/public-corpus-import-review.json",
);
const dataDirectory = path.join(portfolioRoot, "site/app");
const portfolioDataPath = path.join(dataDirectory, "portfolio-data.ts");
const recommendationsPath = path.join(dataDirectory, "recommendations-data.ts");
const capabilitiesPath = path.join(dataDirectory, "capabilities-data.ts");

const [portfolio, recommendations, capabilities, timestamps] = await Promise.all([
  loadTypescriptData(portfolioDataPath),
  loadTypescriptData(recommendationsPath),
  loadTypescriptData(capabilitiesPath),
  Promise.all([
    stat(portfolioDataPath),
    stat(recommendationsPath),
    stat(capabilitiesPath),
  ]),
]);

const importInput = {
  actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
  workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
  capturedAt: new Date(Math.max(...timestamps.map((entry) => entry.mtimeMs))).toISOString(),
  snapshot: {
    projects: portfolio.projects,
    experience: portfolio.experience,
    recommendations: recommendations.recommendations,
    capabilities: capabilities.capabilities,
  },
};

if (process.argv.includes("--review-packet")) {
  const packet = await createPortfolioEvidenceImportReviewPacket({
    databasePath,
    importInput,
  });
  await writePortfolioEvidenceImportReviewPacket(reviewPacketPath, packet);
  process.stdout.write(`${JSON.stringify({
    packetWritten: true,
    packetHash: packet.packetHash,
    ...packet.summary,
  }, null, 2)}\n`);
} else if (process.argv.includes("--audit")) {
  const report = await runPortfolioEvidenceImportAudit({ databasePath, importInput });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const store = new SqliteCareerEvidenceStore(databasePath);
  try {
    const report = new PortfolioEvidenceImporter(store).import(importInput);
    process.stdout.write(`${JSON.stringify({ databasePath, portfolioRoot, ...report }, null, 2)}\n`);
  } finally {
    store.close();
  }
}

async function loadTypescriptData(filePath: string): Promise<Record<string, unknown>> {
  const source = await readFile(filePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`) as Promise<Record<string, unknown>>;
}
