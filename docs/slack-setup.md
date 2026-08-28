# Jolene Slack Setup

The standalone Jolene service uses Slack Socket Mode for its first local pilot. Socket Mode connects outward from Carl's Mac, so this phase does not require a public webhook URL.

The ChatGPT Slack connection and this standalone Slack app are separate integrations. The existing ChatGPT connection does not provide the bot and app tokens required by Jolene's runtime.

## Create or configure the Slack app

1. Open Slack's app-management page and create an app **from a manifest**.
2. Select the Jolene workspace and paste [`slack/manifest.yaml`](../slack/manifest.yaml).
3. Install the app to the workspace.
4. Under **OAuth & Permissions**, copy the Bot User OAuth Token beginning with `xoxb-`.
5. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope and copy the token beginning with `xapp-`.
6. Copy Carl's Slack member ID from his Slack profile using **Copy member ID**.
   Copy the workspace ID from the Slack app/workspace URL or app-management
   workspace details. The workspace ID begins with `T`.
7. Add these values to `.env.local` without committing the file for direct host
   development:

   ```dotenv
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   SLACK_OWNER_USER_ID=U...
   SLACK_OWNER_TEAM_ID=T...
   JOLENE_OWNER_ACTOR_ID=carl
   JOLENE_OWNER_WORKSPACE_ID=personal
   ```

8. For the private Compose runtime, migrate them to file-mounted secrets:

   ```bash
   npm run secrets:migrate-compose
   ```

   After a credential rotation, replace the ignored secret-file contents and
   recreate the affected services. Do not paste tokens into Compose YAML,
   Asana, Slack messages, Git, or diagnostic output.

The manifest requests only:

- `chat:write` to reply as Jolene;
- `app_mentions:read` to receive explicit channel mentions;
- `im:history` to receive direct messages.

It subscribes only to `app_mention` and `message.im`.

## Run the local pilot

```bash
npm run slack
```

Then:

- DM Jolene from Carl's configured Slack account; or
- invite Jolene to a channel and explicitly mention `@Jolene`.

Jolene replies in the originating thread. A durable delivery ledger suppresses completed replays. If Slack explicitly rejects a post, a replay reuses the stored answer and retries delivery without another model call.

When a watched project explicitly enables `slack_owner_dm` notifications, the
same Slack process also drains Project Watch's durable transition outbox. These
messages can address only `SLACK_OWNER_USER_ID`; unchanged scheduled checks and
manual checks do not send anything. This is separate from conversational reply
delivery and does not authorize shared-channel or arbitrary outbound messages.

When private briefings are explicitly enabled, the Slack process also drains
their durable owner-only outbox. The first application start schedules the next
configured occurrence rather than sending immediately. Briefings are
deterministic minimized summaries and cannot address a channel, client AI, or
another Slack user. See [Private owner briefings](private-briefings.md).

## Privacy behavior

- Only direct messages matching the exact `SLACK_OWNER_TEAM_ID` and
  `SLACK_OWNER_USER_ID` pair are considered private and may use allowlisted
  Obsidian knowledge. Member-ID-only matches and events from another workspace
  are ignored.
- The configured owner DM resolves private task and workflow reads to
  `JOLENE_OWNER_ACTOR_ID` and `JOLENE_OWNER_WORKSPACE_ID`. Slack conversation
  history and delivery records retain the actual Slack user, workspace, channel,
  and thread identifiers.
- Direct messages from other Slack members are ignored.
- Every channel mention is treated as shared context, including mentions inside Slack private channels. Shared context receives no Obsidian search tool.
- Ambient channel messages, bot messages, and edited-message events are ignored.
- Current-work review is read-only. The model cannot create, advance, cancel,
  schedule, send, publish, or execute work through this tool.

## Current pilot limitations

- The process must remain running on Carl's Mac.
- A process crash while a delivery is marked `processing` requires operator reconciliation. Automatic stale-claim recovery is intentionally deferred because blindly replaying after Slack accepted a message could create a duplicate.
- There is no Slack approval-card interface, general-purpose scheduled work,
  client-AI task packet, or always-on deployment yet. The bounded owner briefing
  and Project Watch schedules are the only implemented scheduling paths.
