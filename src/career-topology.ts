import path from "node:path";

import {
  assessCareerRelationshipTopology,
  SqliteCareerRelationshipTopologySource,
} from "./evaluation/career-relationship-topology.js";

const databasePath = path.resolve(
  process.cwd(),
  process.env.JOLENE_DATABASE_PATH ?? ".jolene/jolene.sqlite",
);
const scope = {
  actorId: process.env.JOLENE_OWNER_ACTOR_ID ?? "carl",
  workspaceId: process.env.JOLENE_CAREER_WORKSPACE_ID ?? "professional",
};

let source: SqliteCareerRelationshipTopologySource | undefined;
try {
  source = new SqliteCareerRelationshipTopologySource(databasePath);
  const report = assessCareerRelationshipTopology(source.snapshot(scope));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.gate === "fail") process.exitCode = 1;
} catch {
  process.stderr.write(
    "Career relationship topology audit is unavailable or invalid.\n",
  );
  process.exitCode = 2;
} finally {
  source?.close();
}
