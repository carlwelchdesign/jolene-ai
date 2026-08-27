import path from "node:path";

import dotenv from "dotenv";

import { runPublicCareerExport } from "../src/application/public-career-export-runner.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const databasePath = path.resolve(
  process.cwd(),
  process.env.JOLENE_DATABASE_PATH ?? ".jolene/jolene.sqlite",
);
const outputPath = path.resolve(
  process.cwd(),
  process.env.JOLENE_PUBLIC_CAREER_EXPORT_PATH ??
    ".jolene/exports/public-career-evidence.json",
);
const scope = {
  actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
  workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
};

const result = await runPublicCareerExport({
  databasePath,
  outputPath,
  ...scope,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
