import { randomUUID } from "node:crypto";

import { createApplication } from "./app.js";
import { loadConfig } from "./config.js";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  process.stderr.write('Usage: npm run chat -- "Your message"\n');
  process.exit(2);
}

const application = await createApplication(loadConfig());

try {
  const result = await application.service.chat({
    eventId: randomUUID(),
    actorId: "carl",
    workspaceId: "personal",
    channelKind: "cli",
    channelId: "local-cli",
    threadId: "main",
    message,
  });

  process.stdout.write(`${result.response ?? "Jolene is still processing that request."}\n`);
} finally {
  application.close();
}
