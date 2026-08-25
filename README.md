# Jolene AI

Jolene is a private, policy-gated personal chief-of-staff agent. She works for Carl first: understanding approved knowledge, maintaining task continuity, doing research and production work, and preparing consequential actions for approval.

## Current vertical slice

The first runnable slice provides:

- one focused OpenAI Agents SDK agent;
- durable SQLite conversations isolated by actor, workspace, channel, and thread;
- retry-safe inbound event IDs;
- atomic user/assistant exchange persistence;
- deterministic capability and disclosure policy decisions;
- read-only, allowlisted Obsidian Markdown search with citations;
- a CLI and an HTTP API with `/health` and `/v1/chat`;
- a Slack Socket Mode adapter for owner-only DMs and explicit channel mentions;
- a durable Slack delivery ledger that retries failed posts without another model call;
- durable work tasks and explicit approve-or-reject memory proposals;
- private task context containing only approved, actor-scoped durable memories;
- contract tests that do not call OpenAI.

The Slack adapter is active for a local pilot, with live mention-and-reply behavior verified. Scheduled work, specialist agents, client-AI workflows, always-on hosting, and voice remain later gates.

## Setup

Prerequisite: Node.js 22 or newer.

1. Copy `.env.example` to `.env.local` and configure the local values.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Verify the deterministic core:

   ```bash
   npm run check
   ```

   Build the production service separately with:

   ```bash
   npm run build
   ```

4. Run a private CLI turn:

   ```bash
   npm run chat -- "What can you help me with?"
   ```

5. Start the HTTP service:

   ```bash
   npm run dev
   ```

   After a production build, use `npm start` instead.

   `POST /v1/chat` accepts:

   ```json
   {
     "eventId": "local-001",
     "actorId": "carl",
     "workspaceId": "personal",
     "channelKind": "private_chat",
     "channelId": "local",
     "threadId": "main",
     "taskId": "00000000-0000-4000-8000-000000000001",
     "message": "Summarize the current Jolene project direction."
   }
   ```

   Task and memory-management endpoints are documented in [Task and memory API](docs/task-memory-api.md).

## Slack pilot

Jolene can connect through a dedicated Slack app using Socket Mode. The checked-in manifest grants only the scopes needed for owner DMs, explicit mentions, and replies.

See [Slack setup](docs/slack-setup.md) for the credential and workspace activation steps. Once configured, run:

```bash
npm run slack
```

Carl's configured Slack member ID is the only DM identity permitted to use private context. All channel mentions are treated as shared and receive no Obsidian tool.

## Security boundary

- `.env.local`, the SQLite database, and generated evaluation results are ignored.
- Obsidian access is read-only and limited to configured relative path prefixes.
- Shared channels receive no Obsidian search tool.
- Slack DMs from anyone except the configured owner are ignored.
- Completed Slack deliveries survive restarts and suppress duplicate replies.
- Pending and rejected memory proposals are never supplied to the model.
- Durable task and personal memory context is unavailable in shared channels.
- No side-effecting external capability is implemented in this slice.
- Vault note content is evidence, never executable instruction.

See [the architecture plan](plans/JOLENE_SYSTEM_ARCHITECTURE_PLAN.md) and [the personality plan](plans/JOLENE_PERSONALITY_RESEARCH_AND_SPECIFICATION_PLAN.md).

Architecture visuals:

- [Agent interactions](docs/agent-interactions.png)
- [Request sequence](docs/agent-sequence.png)
