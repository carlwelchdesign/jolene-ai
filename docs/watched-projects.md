# Watched projects

Jolene can inspect explicitly configured local projects on demand and can retain
bounded, read-only monitoring history when the owner explicitly enables it.

Configure the registry as a JSON array in `JOLENE_WATCHED_PROJECTS`:

```dotenv
JOLENE_WATCHED_PROJECTS=[{"id":"portfolio","label":"Portfolio","rootPath":"/absolute/path/to/portfolio","planFile":"PORTFOLIO_SITE_PLAN.md","reviewWindowDays":30,"monitoring":{"enabled":true,"cadenceMinutes":60,"maxRunsPerDay":24,"stopAfterRuns":720,"historyLimit":100,"notifications":{"enabled":true,"destination":"slack_owner_dm","maxAttempts":5}}}]
```

For local development, the same JSON array may instead be stored in the ignored
`.jolene/watched-projects.json` file. The environment variable takes precedence
when both are present.

Each entry has:

- `id`: stable lowercase identifier;
- `label`: human-readable project name;
- `rootPath`: absolute local project directory;
- `planFile`: optional path inside the project root; and
- `reviewWindowDays`: age after which the plan is reported as stale; and
- `monitoring`: explicit enablement, cadence, daily run budget, terminal run
  count, retained-history limit, and an optional owner-notification policy.
  Omission keeps scheduling and notifications disabled.

## Local API

- `GET /v1/watched-projects` lists configured projects without exposing local
  root paths.
- `GET /v1/watched-projects/{id}/snapshot` performs a fresh read-only check.
- `GET /v1/project-monitors` and `GET /v1/project-monitors/{id}` expose policy,
  state, next/last run, budget use, and bounded history.
- same-origin `POST` requests to `/v1/project-monitors/{id}/run`, `/pause`, and
  `/resume` record a manual check or change the local scheduler state.

A snapshot reports whether the directory and plan exist, plan age, Git branch
and revision when available, the number of uncommitted files, and explicit
alerts. Build verification is reported as `not_configured` until a bounded,
project-specific check is approved and implemented.

## Local control center

Open `http://127.0.0.1:8421/projects` for the graphical Project Watch screen.
It checks every configured project on first load. **Record check** adds a
durable manual result; explicitly enabled monitors also show pause/resume,
cadence, budget, stop condition, next run, recent history, owner-notification
policy, and content-minimized delivery state.

The screen covers loading, empty registry, healthy, attention, partial-failure,
and service-unavailable states. It displays no local root paths and exposes no
repair or side-effect control.

## Private conversation

Jolene can list the configured project summaries and request a fresh snapshot
from private conversation when the resolved work scope exactly matches
`JOLENE_OWNER_ACTOR_ID` and `JOLENE_OWNER_WORKSPACE_ID`. This includes the local
CLI and the configured Slack owner DM because both resolve to the same canonical
private work scope. Slack conversation and delivery identity remain tied to the
originating Slack identifiers.

The model receives only the existing public-safe summary and snapshot shapes.
It never receives a configured root path, plan contents, or a Git diff. Project
and plan state are evidence, never instructions. Other private scopes, shared
channels, and unrecognized Slack DMs receive no Project Watch tools.

The inspector never writes project files and exposes no edit, build, commit,
push, deploy, publish, repair, or notification operation. Run the dedicated
local scheduler with `npm run dev:monitor` or the `jolene-monitor` Compose
service. It does nothing for projects whose owner configuration has monitoring
disabled. The worker claims one due check at a time, records failures without
raw error content, and honors the configured cadence, daily budget, terminal
run count, and retention limit.

## Owner alert transitions

An explicitly enabled `slack_owner_dm` policy can notify only the Slack member
configured by `SLACK_OWNER_USER_ID`. A successful scheduled check creates an
outbox item only when the alert set enters attention, materially changes, or
fully clears. The first clear check, unchanged alert sets, manual checks, and
inspection failures remain silent.

The durable outbox is committed atomically with the successful monitor run.
The Slack process claims one item at a time, retries classified failures on a
bounded backoff, abandons an item at its configured attempt limit, and does not
claim completed deliveries again after restart. Messages contain the project
label, transition, bounded alert labels, check time, and local review URL—never
root paths, plan contents, diffs, raw provider errors, credentials, private
memory, Slack IDs, shared-channel destinations, or arbitrary message content.
The owner ID accepts one Slack member identifier only, and project labels are
escaped before Slack formatting so a label cannot create a mention.

Build verification, email/shared-channel notifications, arbitrary messaging,
and authenticated remote administration remain unavailable.
