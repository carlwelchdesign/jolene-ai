import { createApplication } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const application = await createApplication(config);
let running = false;
let shuttingDown = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await application.projectMonitoring.runDue();
  } finally {
    running = false;
  }
}

const timer = setInterval(() => {
  if (!shuttingDown) {
    void tick().catch(() => process.stderr.write("Project monitor tick failed.\n"));
  }
}, 30_000);
await tick();

async function shutdown(): Promise<void> {
  shuttingDown = true;
  clearInterval(timer);
  while (running) await new Promise((resolve) => setTimeout(resolve, 10));
  application.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
