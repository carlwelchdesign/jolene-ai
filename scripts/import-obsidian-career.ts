import { ObsidianCareerImporter } from "../src/application/obsidian-career-importer.js";
import { loadConfig } from "../src/config.js";
import { SqliteCareerEvidenceStore } from "../src/persistence/sqlite-career-evidence-store.js";

const config = loadConfig();
if (!config.vaultRoot) {
  throw new Error("JOLENE_OBSIDIAN_VAULT_ROOT is required for career ingestion.");
}
if (config.careerVaultAllowlist.length === 0) {
  throw new Error(
    "JOLENE_CAREER_OBSIDIAN_ALLOWLIST must explicitly name at least one professional folder.",
  );
}

const store = new SqliteCareerEvidenceStore(config.databasePath);
try {
  const report = await new ObsidianCareerImporter({
    store,
    vaultRoot: config.vaultRoot,
    allowlist: config.careerVaultAllowlist,
    actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
    workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
  }).import();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  store.close();
}
