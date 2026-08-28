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
- durable review-only client-AI task packets for the exact Jenny and Maria
  project identities, with bounded context, expiry, turn limits, append-only
  transcripts, exact-action approval per Jolene turn, reviewed handoff, and a
  local owner control surface;
- a CLI and an HTTP API with `/health` and `/v1/chat`;
- a Slack Socket Mode adapter for owner-only DMs and explicit channel mentions;
- a durable Slack delivery ledger that retries failed posts without another model call;
- deterministic daily or weekly private-owner briefings with a durable SQLite
  schedule/outbox, bounded retries and history, exact-owner Slack delivery, and
  local pause/resume controls;
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
  maturity, explicit relationships, review freshness, claim supersession, and
  durable owner-reviewed unresolved conflict groups;
- bounded Obsidian career ingestion that preserves structured note metadata,
  imports section claims as private review candidates, and records deletions;
- private hybrid career retrieval over freshly reviewed evidence, with stable
  semantic chunks, lexical/vector fusion, exact claim/source citations, and a
  deterministic lexical fallback;
- a content-minimizing career-retrieval audit ledger that retains query
  fingerprints and citation IDs but not queries or evidence excerpts;
- an immutable typed registry for Jolene's five current private model tools and
  inert external-message proposal boundary, with registry-derived context
  enforcement and a durable content-minimizing invocation ledger;
- a local read-only professional-context MCP stdio adapter with exact
  actor/workspace/client scope, approved-evidence search and inspection,
  conservative private job comparison, and its own content-minimizing audit
  ledger;
- a versioned synthetic multi-hop career retrieval benchmark that compares the
  production lexical index with a bounded evaluation-only relationship
  traversal before any GraphRAG or graph-database decision;
- a network-disabled, read-only canonical career relationship topology audit
  that separates precise claim links from broad source inheritance and emits
  only aggregate readiness evidence;
- a local, owner-scoped Career Evidence screen for source-first internal/public
  approval, rejection, validation review, revocation, and explicit two-to-five
  claim conflict declaration and resolution, with registry-wide search and
  synchronized paginated navigation for larger private evidence sets;
- a deny-by-default offline public-evidence artifact with a versioned manifest,
  reproducible corpus hash, revocation list, and adversarial leak checks;
- a separate loopback-only public-delegate process boundary that validates that
  artifact and exposes health, the frozen v1 manifest, and deterministic
  citation-complete public-evidence answers and conservative job-description
  comparisons, plus consented local contact-intent staging, a runtime kill
  switch, bounded local admission, a content-minimizing local audit ledger,
  and a separate private operations listener for readiness and aggregate
  content-free request metrics;
- a deterministic public-response disclosure guard that replaces unsafe egress
  with a generic fail-closed response before content leaves the process;
- isolated hosted grounded OpenAI answer synthesis that can change only answer
  prose, sends only selected public evidence, and falls back exactly to the
  deterministic response on provider or validation failure;
- optional public hybrid RAG that embeds only the 41-record public artifact,
  caches those vectors per warm runtime, fuses semantic and deterministic
  ranking, and never connects the public delegate to private SQLite, Obsidian,
  memory, graph traversal, or MCP;
- a versioned offline public-delegate evaluation harness with precommitted
  blocker thresholds, deterministic/fake-provider fixtures, real
  evidence-lifecycle/export and contact-staging scenarios, red-team egress
  checks, explicit semantic-conflict refusal, deterministic adversarial mutation
  matrices, privacy-safe machine reports, and
  nonzero hard-gate failure exits;
- a private owner-scoped Contacts screen that can review or delete staged
  requests and save inert local reply drafts without sending anything;
- a versioned nine-scenario conversational-quality suite plus owner-only review
  screen for scoring exact captured answers, citations, follow-ups, warmth,
  restraint, boundaries, calibration, and originality without activating or
  deploying the personality;
- contract tests that make no live OpenAI requests.

The Slack adapter is active for a local pilot, with live mention-and-reply behavior verified. One bounded private-owner briefing schedule and Project Watch monitoring are implemented locally. The client-AI packet lifecycle is implemented as a private review-only core, but no client transport or autonomous exchange is active. General scheduled work, specialist agents, always-on hosting, and voice remain later gates.

The conversational Obsidian bridge still uses deterministic lexical retrieval.
The governed career registry now has a separate private hybrid retrieval path;
only current owner-approved sources and claims are eligible. The versioned
export remains a local ignored artifact. An isolated hosted public process
serves its validated manifest, grounded answers, and job-fit comparisons from
exact exported claims.
Job-fit results distinguish unknown public evidence from missing experience and
are not recommendations or blanket fit scores. Consented contact requests can
be staged in a separate owner-only, retention-bounded local queue and reviewed
through the private local service. Reply drafts remain inert in that queue; no
outbound contact is implemented. Model-generated answer synthesis and the
same-origin portfolio BFF are deployed through an isolated bearer-authenticated
Vercel service. The deployed public boundary still contains only the reviewed
public artifact; private retrieval, MCP, memory, Slack, and Obsidian remain
local and unavailable to visitors.
The first private MCP interoperability slice is implemented as a local stdio
adapter over approved professional evidence. It is not a remote service and has
no write tools. See [Private professional-context MCP](docs/private-career-mcp.md)
and the [professional context architecture](plans/JOLENE_PROFESSIONAL_CONTEXT_ARCHITECTURE.md).
The [private capability registry](docs/capability-registry.md) documents the
current model-tool inventory, approval behavior, and invocation audit boundary.

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

   Run the public-delegate offline release baseline separately:

   ```bash
   npm run eval:public
   ```

   Run the offline relationship-retrieval benchmark separately:

   ```bash
   npm run eval:career:relationships
   ```

   Audit the canonical private relationship topology separately:

   ```bash
   npm run career:relationships:audit
   ```

   Build the production service separately with:

   ```bash
   npm run build
   ```

   For the containerized API and Slack runtime, follow
   [Docker runtime](docs/docker.md).

   Before starting the private Compose stack, split the configured credentials
   into ignored file-mounted secrets and a non-secret runtime environment:

   ```bash
   npm run secrets:migrate-compose
   ```

   The command prints secret names only. It never prints their values and is
   safe to rerun when the source and generated files are unchanged.

4. Run a private CLI turn:

   ```bash
   npm run chat -- "What can you help me with?"
   ```

5. Start the HTTP service:

   ```bash
   npm run dev
   ```

   After a production build, use `npm start` instead.

   The private control plane requires `JOLENE_PRIVATE_CONTROL_TOKEN` (or its
   `_FILE` alternative) and rejects non-loopback hostnames. API clients send
   `Authorization: Bearer $JOLENE_PRIVATE_CONTROL_TOKEN`. A browser uses its
   native HTTP authentication prompt: enter `jolene` as the username and the
   private control token as the password. The unauthenticated `/health` route
   exposes only the fixed local readiness summary.

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

   Open [http://127.0.0.1:8421/client-ai](http://127.0.0.1:8421/client-ai)
   to create and review bounded Jenny/Maria task packets, inspect immutable
   fingerprints and transcript provenance, cancel active packets, and review
   versioned handoffs. The page exposes no conversation, model, Slack, or send
   control; each future outbound message still requires separate exact-action
   approval.

   Open [http://127.0.0.1:8421/contacts](http://127.0.0.1:8421/contacts)
   to review consented portfolio contact requests, mark them reviewed, save a
   local reply draft, or permanently delete them after explicit confirmation.
   Visitor text is treated as untrusted data. This screen cannot send email,
   post to Slack, schedule a meeting, or authorize any external action.

   Open [http://127.0.0.1:8421/workflows](http://127.0.0.1:8421/workflows)
   to start task-bound work, record exact step evidence, request revisions,
   approve completion, or cancel while retaining the history. Completing work
   does not authorize any external action.

   `POST /v1/chat` accepts:

   ```json
   {
     "eventId": "local-001",
     "channelId": "local",
     "threadId": "main",
     "taskId": "00000000-0000-4000-8000-000000000001",
     "includeSensitiveMemory": false,
     "message": "Summarize the current Jolene project direction."
   }
   ```

   Actor, workspace, private channel kind, and disclosure scope are derived
   from the authenticated server configuration. Supplying any of those fields
   in the JSON body is rejected.

   Configuration, browser/API usage, rotation, and failure behavior are
   documented in [Private control authentication](docs/private-control-authentication.md).

   Task and memory-management endpoints are documented in [Task and memory API](docs/task-memory-api.md).
   The six reviewable work types and their lifecycle are documented in
   [Personal work workflows](docs/personal-workflows.md).

   The private review-only Jenny/Maria coordination lifecycle and its local API
   are documented in [Client-AI task packets](docs/client-ai-task-packets.md).

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

   After approving internal evidence, synchronize its local lexical retrieval
   chunks with:

   ```bash
   npm run career:index:lexical
   ```

   This is deterministic lexical indexing by default. Semantic embeddings are
   a separate private-data egress decision: set
   `JOLENE_CAREER_EMBEDDINGS_ENABLED=true` only when you intend to send eligible
   reviewed chunks and private search queries to the configured OpenAI
   embedding model.

   Generate the local deny-by-default public handoff artifact with:

   ```bash
   npm run career:export-public
   ```

   This command builds and runs a network-disabled one-shot container against
   the canonical private Docker data volume. The export job receives no OpenAI,
   Slack, Obsidian, portfolio, or monitoring configuration. Use
   `career:export-public:host` only for an explicitly selected development
   database; it is not the canonical review-state path.

   The default output is ignored at
   `.jolene/exports/public-career-evidence.json`. The current approved artifact
   contains 41 public claims and one supersession revocation under schema `1.0.0`. This
   command does not publish, deploy, or start a public endpoint.

   The isolated local manifest boundary is documented in
   [Public delegate boundary](docs/public-delegate.md). It is a development
   contract surface, not a public deployment.

   The offline and explicitly opt-in live-model evaluation paths are documented
   in [Public delegate evaluation](docs/public-delegate-evaluation.md). Ordinary
   tests never call a provider; live measurement requires a separate public-only
   environment and always stages its representative outputs for Carl's review.

   Open [http://127.0.0.1:8421/public-evaluation](http://127.0.0.1:8421/public-evaluation)
   to inspect that ignored owner-only review packet and save an explicit human
   decision bound to its exact suite hash. The screen cannot run a provider,
   spend budget, alter evidence, activate the portfolio, message anyone, deploy,
   or authorize launch. A new packet hash makes an earlier decision stale.

   Open [http://127.0.0.1:8421/conversation-evaluation](http://127.0.0.1:8421/conversation-evaluation)
   to review the current owner-only conversational-quality capture. Every case
   requires seven explicit 0–4 scores and optional hard-failure findings. The
   saved mode-`0600` decision is bound to the exact packet hash and becomes
   stale after recapture. This screen cannot call the model, publish, deploy,
   contact anyone, or activate Jolene's personality.

   Trusted local MCP hosts can use the canonical professional-context adapter
   documented in [Private professional-context MCP](docs/private-career-mcp.md).
   It is a network-disabled tools-profile container over the canonical private
   data volume; it does not expose the vault, private memory, Slack, or the
   public delegate.

## Slack pilot

Jolene can connect through a dedicated Slack app using Socket Mode. The checked-in manifest grants only the scopes needed for owner DMs, explicit mentions, and replies.

See [Slack setup](docs/slack-setup.md) for the credential and workspace activation steps. Once configured, run:

```bash
npm run slack
```

Carl's configured Slack workspace/member pair is the only DM identity permitted
to use private context. A matching member ID from another workspace is ignored.
All channel mentions are treated as shared and receive no Obsidian tool.
For that configured owner DM, private work lookup resolves to
`JOLENE_OWNER_ACTOR_ID` and `JOLENE_OWNER_WORKSPACE_ID`; Slack conversation and
delivery identity remain tied to the originating Slack user, workspace, channel,
and thread.

## Security boundary

- `.env.local`, `.env.runtime.local`, `.jolene/secrets`, the SQLite database,
  and generated evaluation results are ignored. Private Compose services use
  file-mounted secrets; rendered Compose configuration contains paths, not
  credential values.
- The isolated public audit ledger records only fixed operations, outcomes,
  timing, corpus version, and counts; it never stores request bodies, visitor
  identity, session tokens, source addresses, citations, or response text.
- The isolated public operations listener is loopback-only and not host-published
  by the reference Compose topology. Its strict snapshots contain fixed
  component states and aggregate counters only—never prompts, answers, job
  descriptions, contact fields, client addresses, headers, URLs, or stack traces.
- Offline public export and runtime public egress share one disclosure policy
  for private paths and hosts, file or Obsidian links, likely secrets, email
  addresses, and phone numbers.
- Obsidian access is read-only and limited to configured relative path prefixes.
- Knowledge-search audit records retain scope, outcome, query fingerprints, and citations—but never raw queries or note excerpts.
- Shared channels receive no Obsidian search tool.
- Every private control/UI route except content-minimizing `/health` requires a
  dedicated high-entropy credential; loopback and same-origin checks are
  additional containment and do not establish identity.
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
- Watched-project inspection is read-only and omits root paths from registry
  listings. Explicit owner configuration may enable a dedicated local worker
  with bounded cadence, daily budget, terminal run count, pause state, and
  retained history.
- Conversational Project Watch is exposed only when the resolved work scope
  exactly matches the configured canonical owner. It reads no plan contents or
  diffs and exposes no edit, build, commit, push, deploy, publish, repair,
  or notification operation. Scheduled checks use the same read-only inspector;
  build verification remains unavailable.
- Project Watch notifications are separately disabled by default and, when
  explicitly enabled, can address only the configured Slack owner DM. Only
  scheduled alert-set transitions create durable outbox items; unchanged and
  manual checks stay silent, and messages omit project paths, contents, diffs,
  raw errors, credentials, private memory, and arbitrary destinations.
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
- A single [channel-aware retrieval policy](docs/channel-retrieval-policy.md)
  governs same-thread conversation history, durable memory, Obsidian, career
  evidence, and public export. Shared Slack cannot retrieve private sources;
  owner-DM access requires the verified canonical-owner scope; portfolio access
  permits only `public_approved` artifact records.
- The [conversational-quality evaluation](docs/conversational-quality-evaluation.md)
  blocks canned PR language, empty evidence, privacy/fabrication failures,
  personality-over-substance, citation drift, and unsuppressed high-stakes wit
  across nine required public and private scenarios. Passing requires complete
  human review; validating the fixture does not make a provider request.
- Public career queries exclude stale, revoked, superseded, unapproved, and
  publicly uncitable evidence by construction.
- The offline public export emits only fresh `public_approved` claim/citation
  records, uses `limited` strength until that field is explicitly reviewed,
  and fails closed on private paths, contacts, secrets, Obsidian links, and
  citation destinations that are not site-relative portfolio paths.

See [the architecture plan](plans/JOLENE_SYSTEM_ARCHITECTURE_PLAN.md), [the personality plan](plans/JOLENE_PERSONALITY_RESEARCH_AND_SPECIFICATION_PLAN.md), the [personality renderer boundary](docs/personality-renderer.md), and the [non-activating tuning decision](docs/personality-tuning.md).

Architecture visuals:

- [Agent interactions](docs/agent-interactions.png)
- [Request sequence](docs/agent-sequence.png)
