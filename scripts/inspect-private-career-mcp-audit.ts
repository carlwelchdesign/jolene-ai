import {
  assertPrivateCareerMcpDatabase,
  parsePrivateCareerMcpConfig,
} from "../src/mcp/private-career-mcp-config.js";
import { SqlitePrivateCareerMcpAuditStore } from
  "../src/persistence/sqlite-private-career-mcp-audit-store.js";

const config = parsePrivateCareerMcpConfig(process.env);
assertPrivateCareerMcpDatabase(config.databasePath);
const store = new SqlitePrivateCareerMcpAuditStore(config.databasePath);
try {
  const limitArgument = process.argv.slice(2).find((value) => /^\d+$/.test(value));
  const limit = Math.max(1, Math.min(Number(limitArgument ?? 50), 200));
  process.stdout.write(`${JSON.stringify(store.listAccesses({
    actorId: config.actorId,
    workspaceId: config.workspaceId,
  }, config.clientId, limit), null, 2)}\n`);
} finally {
  store.close();
}
