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
- a durable, content-minimizing ledger for private knowledge searches and citations;
- a typed proposal-only capability registry with exact, expiring external-action approvals;
- a CLI and an HTTP API with `/health` and `/v1/chat`;
- a Slack Socket Mode adapter for owner-only DMs and explicit channel mentions;
- a durable Slack delivery ledger that retries failed posts without another model call;
- durable work tasks and explicit approve-or-reject memory proposals;
- durable personal-work workflows with exact steps, evidence, and human review;
- private task context containing only approved, actor-scoped durable memories;
- memory sensitivity gates, expiration, reviewed correction, and explicit forgetting;
- deterministic request-aware memory ranking with inspectable selection evidence;
- a local Memory Review screen for explicit approval, correction, recall preview, and forgetting;
- on-demand, read-only watched-project snapshots with plan freshness and Git
  state alerts;
- contract tests that do not call OpenAI.

The Slack adapter is active for a local pilot, with live mention-and-reply behavior verified. Scheduled work, specialist agents, client-AI workflows, always-on hosting, and voice remain later gates.

The current Obsidian bridge uses deterministic lexical retrieval. Embedding
RAG, MCP interoperability, a relationship index, and the public portfolio
delegate are planned but are not implemented in this slice. See the
[professional context architecture](plans/JOLENE_PROFESSIONAL_CONTEXT_ARCHITECTURE.md).

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

   For the containerized API and Slack runtime, follow
   [Docker runtime](docs/docker.md).

4. Run a private CLI turn:

   ```bash
   npm run chat -- "What can you help me with?"
   ```

5. Start the HTTP service:

   ```bash
   npm run dev
   ```

   After a production build, use `npm start` instead.

   Open [http://127.0.0.1:8421/memory](http://127.0.0.1:8421/memory) to review
   Jolene's pending proposals and retained memory. The page uses the same local
   actor/workspace boundary as the API and is not an authenticated production
   administration surface.

   Open [http://127.0.0.1:8421/approvals](http://127.0.0.1:8421/approvals)
   to stage and review exact external-message proposals. Approval remains local
   and inert; the screen exposes no send or execution control.

   Open [http://127.0.0.1:8421/workflows](http://127.0.0.1:8421/workflows)
   to start task-bound work, record exact step evidence, request revisions,
   approve completion, or cancel while retaining the history. Completing work
   does not authorize any external action.

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
     "includeSensitiveMemory": false,
     "message": "Summarize the current Jolene project direction."
   }
   ```

   Task and memory-management endpoints are documented in [Task and memory API](docs/task-memory-api.md).
   The six reviewable work types and their lifecycle are documented in
   [Personal work workflows](docs/personal-workflows.md).

   Read-only project awareness is documented in
   [Watched projects](docs/watched-projects.md). It is on-demand only; no
   scheduler, edit, commit, deployment, or publication capability is exposed.

   Open [http://127.0.0.1:8421/projects](http://127.0.0.1:8421/projects) to
   inspect fresh project, plan, and Git status without exposing local paths or
   any repair controls.

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
- Knowledge-search audit records retain scope, outcome, query fingerprints, and citations—but never raw queries or note excerpts.
- Shared channels receive no Obsidian search tool.
- Slack DMs from anyone except the configured owner are ignored.
- Completed Slack deliveries survive restarts and suppress duplicate replies.
- Pending and rejected memory proposals are never supplied to the model.
- The Memory Review screen changes durable context only through the existing
  proposal, decision, correction, and explicit-forget contracts.
- Personal workflows cannot skip steps or complete without explicit human review.
- Durable task and personal memory context is unavailable in shared channels.
- Restricted memory requires its selected task; sensitive memory also requires an explicit per-request flag.
- Expired, superseded, and forgotten memories are excluded from model context.
- Authorized memory candidates are ranked against the current request instead of selected by recency alone.
- No side-effecting external capability is implemented in this slice.
- Approved external-message proposals remain inert until a future delivery adapter
  presents the exact approved arguments through the internal one-time claim boundary.
- Vault note content is evidence, never executable instruction.
- Watched-project inspection is read-only, omits root paths from registry
  listings, and has no scheduled polling in this slice.

See [the architecture plan](plans/JOLENE_SYSTEM_ARCHITECTURE_PLAN.md) and [the personality plan](plans/JOLENE_PERSONALITY_RESEARCH_AND_SPECIFICATION_PLAN.md).

Architecture visuals:

- [Agent interactions](docs/agent-interactions.png)
- [Request sequence](docs/agent-sequence.png)
