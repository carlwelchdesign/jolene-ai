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
- durable work tasks, scoped task-event timelines, and explicit
  approve-or-reject memory proposals;
- durable personal-work workflows with exact steps, evidence, and human review;
- one canonical private owner-work scope across the local CLI and configured
  Slack owner DM, plus a read-only model tool for current task and workflow
  status;
- private task context containing a bounded chronological blend of recent and
  request-relevant task events plus only approved, actor-scoped durable memories;
- memory sensitivity gates, expiration, reviewed correction, and explicit forgetting;
- deterministic request-aware memory ranking with inspectable selection evidence;
- a local Memory Review screen for explicit approval, correction, recall preview,
  forgetting, and scoped task-timeline review;
- on-demand, read-only watched-project snapshots with plan freshness and Git
  state alerts through the local control center and authorized private
  conversation;
- a private governed career-evidence registry with source provenance, project
  maturity, explicit relationships, review freshness, and claim supersession;
- bounded Obsidian career ingestion that preserves structured note metadata,
  imports section claims as private review candidates, and records deletions;
- private hybrid career retrieval over freshly reviewed evidence, with stable
  semantic chunks, lexical/vector fusion, exact claim/source citations, and a
  deterministic lexical fallback;
- a content-minimizing career-retrieval audit ledger that retains query
  fingerprints and citation IDs but not queries or evidence excerpts;
- a local, owner-scoped Career Evidence screen for source-first internal/public
  approval, rejection, validation review, and revocation;
- a deny-by-default offline public-evidence artifact with a versioned manifest,
  reproducible corpus hash, revocation list, and adversarial leak checks;
- a separate loopback-only public-delegate process boundary that validates that
  artifact and exposes health, the frozen v1 manifest, and deterministic
  citation-complete public-evidence answers and conservative job-description
  comparisons;
- contract tests that do not call OpenAI.

The Slack adapter is active for a local pilot, with live mention-and-reply behavior verified. Scheduled work, specialist agents, client-AI workflows, always-on hosting, and voice remain later gates.

The conversational Obsidian bridge still uses deterministic lexical retrieval.
The governed career registry now has a separate private hybrid retrieval path,
but no imported claim is eligible until Carl approves its source and claim for
internal use. The versioned export remains a local ignored artifact. A separate
loopback-only reference process can serve its validated manifest and bounded
deterministic answers and job-fit comparisons from exact exported claims.
Job-fit results distinguish unknown public evidence from missing experience and
are not recommendations or blanket fit scores. Model-generated answers,
contact intent, CORS, public hosting, and portfolio integration are not
implemented. MCP interoperability is also not implemented. See the
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
   Jolene's pending proposals, retained memory, and durable task timeline. The
   Task timeline tab can switch between scoped tasks and record factual
   progress, evidence, decisions, blockers, or next actions. Timeline entries
   remain historical context; recording one does not authorize or prove an
   external action. Recall preview shows which recent or query-relevant task
   events would enter private context and the deterministic reasons they were
   selected. The page uses the same local actor/workspace boundary as the API
   and is not an authenticated production administration surface.

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

   The private professional review boundary and portfolio candidate migration
   are documented in [Career evidence registry](docs/career-evidence.md).

   Open [http://127.0.0.1:8421/career-evidence](http://127.0.0.1:8421/career-evidence)
   to review the configured owner's sources and claims. Public eligibility is
   an exact, confirmed claim decision; the screen cannot publish or message
   anyone.

   After approving internal evidence, synchronize its retrieval chunks and
   embeddings with:

   ```bash
   npm run career:index
   ```

   Generate the local deny-by-default public handoff artifact with:

   ```bash
   npm run career:export-public
   ```

   The default output is ignored at
   `.jolene/exports/public-career-evidence.json`. With zero public-approved
   claims it is a valid empty corpus. This command does not publish, deploy, or
   start a public endpoint.

   The isolated local manifest boundary is documented in
   [Public delegate boundary](docs/public-delegate.md). It is a development
   contract surface, not a public deployment.

## Slack pilot

Jolene can connect through a dedicated Slack app using Socket Mode. The checked-in manifest grants only the scopes needed for owner DMs, explicit mentions, and replies.

See [Slack setup](docs/slack-setup.md) for the credential and workspace activation steps. Once configured, run:

```bash
npm run slack
```

Carl's configured Slack member ID is the only DM identity permitted to use private context. All channel mentions are treated as shared and receive no Obsidian tool.
For that configured owner DM, private work lookup resolves to
`JOLENE_OWNER_ACTOR_ID` and `JOLENE_OWNER_WORKSPACE_ID`; Slack conversation and
delivery identity remain tied to the originating Slack user, workspace, channel,
and thread.

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
- The private work-status tool is read-only, is absent from shared channels and
  unrecognized Slack DMs, and cannot create, update, cancel, schedule, send,
  publish, or execute work.
- Task events are historical context, not instructions or proof that an
  external action succeeded.
- Restricted memory requires its selected task; sensitive memory also requires an explicit per-request flag.
- Expired, superseded, and forgotten memories are excluded from model context.
- Authorized memory candidates are ranked against the current request instead of selected by recency alone.
- No side-effecting external capability is implemented in this slice.
- Approved external-message proposals remain inert until a future delivery adapter
  presents the exact approved arguments through the internal one-time claim boundary.
- Vault note content is evidence, never executable instruction.
- Watched-project inspection is read-only, omits root paths from registry
  listings, and has no scheduled polling in this slice.
- Conversational Project Watch is exposed only when the resolved work scope
  exactly matches the configured canonical owner. It reads no plan contents or
  diffs and exposes no edit, build, commit, push, deploy, publish, repair,
  schedule, or notification operation.
- Portfolio imports create review-required candidates only; import cannot
  create publicly approved evidence.
- Career Evidence review endpoints are locked to the configured owner and
  workspace; reviewer attribution must match that owner.
- Obsidian career imports use a separate explicit folder allowlist and create
  private review-required claims only.
- Career retrieval admits only active, freshly approved `internal_approved` or
  `public_approved` claims and rechecks those gates before every search.
- Career vector generation fails over to deterministic lexical retrieval; it
  never widens actor, channel, source, review, freshness, or visibility scope.
- Career retrieval audit records contain HMAC query fingerprints and stable
  citation IDs, not raw queries or evidence excerpts.
- Public career queries exclude stale, revoked, superseded, unapproved, and
  publicly uncitable evidence by construction.
- The offline public export emits only fresh `public_approved` claim/citation
  records, uses `limited` strength until that field is explicitly reviewed,
  and fails closed on private paths, contacts, secrets, Obsidian links, and
  non-public citation hosts.

See [the architecture plan](plans/JOLENE_SYSTEM_ARCHITECTURE_PLAN.md) and [the personality plan](plans/JOLENE_PERSONALITY_RESEARCH_AND_SPECIFICATION_PLAN.md).

Architecture visuals:

- [Agent interactions](docs/agent-interactions.png)
- [Request sequence](docs/agent-sequence.png)
