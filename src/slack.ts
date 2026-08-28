import { App, LogLevel } from "@slack/bolt";

import { createApplication } from "./app.js";
import { loadConfig } from "./config.js";
import { handleSlackEvent } from "./slack/event-handler.js";
import { createSlackOwnerNotificationPoster } from "./slack/project-watch-notifications.js";

const config = loadConfig();
if (
  !config.slackBotToken ||
  !config.slackAppToken ||
  !config.slackOwnerUserId
  || !config.slackOwnerTeamId
) {
  throw new Error(
    "Slack is not configured. Provide Slack bot/app credentials directly or through secret files, plus the SLACK_OWNER_TEAM_ID/SLACK_OWNER_USER_ID pair.",
  );
}
const ownerUserId = config.slackOwnerUserId;
const ownerTeamId = config.slackOwnerTeamId;

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
  const result = await handleSlackEvent(
    application.service,
    application.deliveries,
    body,
    context.botUserId,
    ownerUserId,
    ownerTeamId,
    async ({ text, threadTs }) => {
      await say({ text, thread_ts: threadTs });
    },
  );
  process.stdout.write(`Slack event handled: ${result.outcome}\n`);
};

slack.use(async ({ body, next }) => {
  const eventType =
    typeof body === "object" &&
    body !== null &&
    "event" in body &&
    typeof body.event === "object" &&
    body.event !== null &&
    "type" in body.event &&
    typeof body.event.type === "string"
      ? body.event.type
      : "non-event";
  process.stdout.write(`Slack event received: ${eventType}\n`);
  await next();
});

slack.event("app_mention", listener);
slack.event("message", listener);

slack.error(async (error) => {
  process.stderr.write(`Jolene Slack error: ${error.name}\n`);
});

await slack.start();
process.stdout.write("Jolene is connected to Slack in Socket Mode.\n");

const postOwnerNotification = createSlackOwnerNotificationPoster(
  slack.client,
  ownerUserId,
);
let notificationDrain: Promise<void> | null = null;
function drainProjectWatchNotifications(): void {
  if (notificationDrain) return;
  notificationDrain = application.projectNotifications
    .drainPending(postOwnerNotification)
    .then(({ delivered, failed }) => {
      if (delivered > 0 || failed > 0) {
        process.stdout.write(
          `Project Watch notifications handled: delivered=${delivered} failed=${failed}\n`,
        );
      }
    })
    .catch(() => {
      process.stderr.write("Project Watch notification drain failed.\n");
    })
    .finally(() => { notificationDrain = null; });
}
drainProjectWatchNotifications();
const notificationTimer = setInterval(drainProjectWatchNotifications, 30_000);

let briefingDrain: Promise<void> | null = null;
function drainPrivateBriefings(): void {
  if (briefingDrain) return;
  briefingDrain = application.privateBriefing
    .drainPending(postOwnerNotification)
    .then(({ delivered, failed }) => {
      if (delivered > 0 || failed > 0) {
        process.stdout.write(
          `Private briefings handled: delivered=${delivered} failed=${failed}\n`,
        );
      }
    })
    .catch(() => {
      process.stderr.write("Private briefing drain failed.\n");
    })
    .finally(() => { briefingDrain = null; });
}
drainPrivateBriefings();
const briefingTimer = setInterval(drainPrivateBriefings, 30_000);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(notificationTimer);
    clearInterval(briefingTimer);
    void (async () => {
      await notificationDrain;
      await briefingDrain;
      await slack.stop();
    })().finally(() => {
      application.close();
      process.exit(0);
    });
  });
}
