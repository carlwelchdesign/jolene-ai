import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runSecurityTabletop } from "../src/security/security-tabletop.js";

export { runSecurityTabletop };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(runSecurityTabletop(), null, 2)}\n`);
}
