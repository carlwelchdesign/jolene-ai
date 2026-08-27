import { runPublicCareerExport } from "./application/public-career-export-runner.js";

const result = await runPublicCareerExport({
  databasePath: process.env.JOLENE_DATABASE_PATH ?? "/data/jolene.sqlite",
  outputPath: process.env.JOLENE_PUBLIC_CAREER_EXPORT_PATH ??
    "/exports/public-career-evidence.json",
  actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
  workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
