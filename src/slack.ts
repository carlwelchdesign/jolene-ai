import { App, LogLevel } from "@slack/bolt";

import { createApplication } from "./app.js";
import { loadConfig } from "./config.js";
import { handleSlackEvent } from "./slack/event-handler.js";

const config = loadConfig();
if (
  !config.slackBotToken ||
  !config.slackAppToken ||
  !config.slackOwnerUserId
) {
  throw new Error(
    "Slack is not configured. Set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_OWNER_USER_ID in .env.local.",
  );
}
const ownerUserId = config.slackOwnerUserId;

const application = await createApplication(config);
const slack = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

const listener = async ({
  body,
  context,
  say,
}: {
  body: unknown;
  context: { botUserId?: string };
  say: (message: { text: string; thread_ts: string }) => Promise<unknown>;
}) => {
  await handleSlackEvent(
    application.service,
    body,
    context.botUserId,
    ownerUserId,
    async ({ text, threadTs }) => {
      await say({ text, thread_ts: threadTs });
    },
  );
};

slack.event("app_mention", listener);
slack.event("message", listener);

slack.error(async (error) => {
  process.stderr.write(`Jolene Slack error: ${error.name}\n`);
});

await slack.start();
process.stdout.write("Jolene is connected to Slack in Socket Mode.\n");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void slack.stop().finally(() => {
      application.close();
      process.exit(0);
    });
  });
}
