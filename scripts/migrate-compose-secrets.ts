import path from "node:path";

import { migrateComposeSecrets } from
  "../src/application/compose-secret-migration.js";

const replace = process.argv.slice(2).includes("--replace");
const result = await migrateComposeSecrets({
  sourceEnvironmentPath: path.resolve(".env.local"),
  runtimeEnvironmentPath: path.resolve(".env.runtime.local"),
  secretsDirectory: path.resolve(".jolene/secrets"),
  replace,
});

process.stdout.write(`${JSON.stringify({
  migratedSecretNames: result.migratedSecretNames,
  runtimeEnvironmentCreated: result.runtimeEnvironmentCreated,
  valuesPrinted: false,
}, null, 2)}\n`);
