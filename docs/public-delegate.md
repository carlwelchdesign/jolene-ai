# Public delegate boundary

Jolene includes a separate local reference process for the first public
portfolio-delegate contract slice. It consumes only a versioned public career
evidence artifact. It does not load the private Jolene application or its
configuration, SQLite database, Obsidian vault, Slack adapter, durable memory,
or private retrieval services. OpenAI is available only through an explicit,
disabled-by-default answer-synthesis adapter described below.

This slice verifies the frozen portfolio v1 manifest, answer, job-fit, and
contact-intent contracts. It is not a public deployment and does not implement
autonomous contact, CORS, or public model access.

## Local configuration

Copy `.env.public.example` to `.env.public.local` if overrides are needed. The
process reads `.env.public.local`, not `.env.local`. All settings are optional:

```dotenv
JOLENE_PUBLIC_ENABLED=true
JOLENE_PUBLIC_HOST=127.0.0.1
JOLENE_PUBLIC_PORT=8431
JOLENE_PUBLIC_OPERATIONS_HOST=127.0.0.1
JOLENE_PUBLIC_OPERATIONS_PORT=8432
JOLENE_PUBLIC_ARTIFACT_PATH=.jolene/exports/public-career-evidence.json
JOLENE_PUBLIC_ARTIFACT_SOURCE=file
JOLENE_PUBLIC_ARTIFACT_URL=
JOLENE_PUBLIC_ARTIFACT_ALLOW_LOOPBACK=false
JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS=5000
JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION=
JOLENE_PUBLIC_CONTACT_QUEUE_PATH=.jolene/public/contact-intents.json
JOLENE_PUBLIC_CONTACT_RETENTION_DAYS=30
JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES=500
JOLENE_PUBLIC_AUDIT_PATH=.jolene/public/audit.json
JOLENE_PUBLIC_AUDIT_RETENTION_DAYS=30
JOLENE_PUBLIC_AUDIT_MAX_ENTRIES=5000
JOLENE_PUBLIC_REQUESTS_PER_MINUTE=60
JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS=8
JOLENE_PUBLIC_AUTH_MODE=disabled
JOLENE_PUBLIC_API_TOKEN=
JOLENE_PUBLIC_ANSWER_MODE=deterministic
JOLENE_PUBLIC_OPENAI_MODEL=gpt-5.6-terra
JOLENE_PUBLIC_OPENAI_TIMEOUT_MS=8000
JOLENE_PUBLIC_OPENAI_BUDGET_PATH=.jolene/public/model-budget.json
JOLENE_PUBLIC_OPENAI_REQUESTS_PER_DAY=100
OPENAI_API_KEY=
```

Only `127.0.0.1`, `::1`, and `localhost` are accepted as hosts outside the
isolated container. The public and operations listeners must use different
ports. The artifact path must point to the generated public export, never the
private SQLite database or vault.

### Managed-container artifact source

The default `JOLENE_PUBLIC_ARTIFACT_SOURCE=file` preserves the local,
read-only mount. A managed container that cannot mount the reviewed handoff may
instead use an independently hosted public-safe artifact:

```dotenv
JOLENE_PUBLIC_ARTIFACT_SOURCE=https
JOLENE_PUBLIC_ARTIFACT_URL=https://evidence.example.com/public-career-evidence.json
JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION=career:<reviewed-corpus-hash>
JOLENE_PUBLIC_ARTIFACT_TIMEOUT_MS=5000
```

HTTPS mode accepts only a fixed public HTTPS resource without URL credentials,
query parameters, fragments, redirects, private/reserved IP literals, or local
hostnames. The delegate sends no API key, cookie, or private Jolene credential
to the artifact host because the artifact is already the approved public-safe
boundary. An explicit IP-loopback HTTP override exists only for local
rehearsal and defaults off.

Every read has a bounded timeout and one-megabyte response limit. The complete
artifact is parsed with the frozen schema, its digest is recomputed, and its
corpus version must equal the deployment-pinned expected version. A missing,
oversized, malformed, unreachable, redirected, internally inconsistent,
tampered, or drifted artifact fails the request closed. No stale artifact is
served from an application cache, minimizing the interval in which a revoked
export could remain usable. Hosting and cache headers for the artifact itself
remain deployment responsibilities.

This mode removes the managed host's local-mount dependency; it does not make
private evidence public, publish an artifact, choose an object-storage
provider, or authorize deployment. The artifact location must be populated
only by the reviewed canonical export workflow.

Loopback development defaults to `JOLENE_PUBLIC_AUTH_MODE=disabled`. Before any
Internet-facing deployment, set `JOLENE_PUBLIC_AUTH_MODE=bearer` and provision a
dedicated random `JOLENE_PUBLIC_API_TOKEN` of at least 32 characters through the
deployment platform's secret store. The same value belongs only in the
portfolio BFF's server-side `JOLENE_PUBLIC_API_TOKEN`; it must never use a
`NEXT_PUBLIC_` name or enter browser code, logs, the public evidence artifact,
or private Jolene's environment. Bearer mode fails configuration closed when
the token is absent or too short.

Set `JOLENE_PUBLIC_ENABLED=false` to fail closed before artifact access. The
local process then returns only a non-disclosing `503` response. The admission
controller also limits each socket source address to the configured requests
per fixed one-minute window and caps global in-flight requests. Rejections use
`429` or `503`, include `Retry-After`, preserve restrictive security headers,
and do not read or log request bodies.

Generate the local artifact first:

```bash
npm run career:export-public
```

The currently reviewed local artifact uses schema `1.0.0` and contains 41
public-approved claims with zero revocations. It lives only at the ignored
`.jolene/exports/public-career-evidence.json` handoff boundary. The remaining
102 approved claims are private/internal and are not included. Artifact
generation is not portfolio integration, endpoint activation, deployment, or
launch approval.

For reproducible loopback integration testing, the delegate can also run in
the separate `compose.public.yaml` project. That project mounts only this
artifact read-only and a dedicated public-state volume; it does not share the
private Compose environment, database, vault, Slack configuration, or memory.
See [Docker runtime](docker.md#isolated-public-delegate-container).

Then start the reference process:

```bash
npm run dev:public
```

After a production build, use `npm run start:public`.

## Deployment preflight

Before configuring the portfolio BFF for a hosted delegate, run the compiled
preflight against the exact candidate HTTPS origin:

```bash
JOLENE_PUBLIC_DEPLOYMENT_ORIGIN=https://jolene.example.com \
JOLENE_PUBLIC_API_TOKEN='<dedicated-public-service-token>' \
JOLENE_PUBLIC_EXPECTED_CORPUS_VERSION='career:<reviewed-corpus-hash>' \
npm run start:public:preflight
```

The preflight rejects non-HTTPS, credential-bearing, private-network, or
path-bearing origins. It verifies the unauthenticated health contract, proves
that missing and deliberately invalid credentials receive `401`, validates the
authorized manifest against the expected reviewed corpus, and requires the
restrictive security headers with no browser CORS permission. Responses are
bounded before JSON parsing. Redirects, timeouts, schema drift, corpus drift,
permissive CORS, and missing authentication fail closed.

The successful JSON report contains only the public origin, check states,
corpus version/hash, evidence count, revocation count, and check time. It never
contains the service token or response prose. For an explicit local rehearsal,
set `JOLENE_PUBLIC_DEPLOYMENT_ALLOW_LOOPBACK=true` and use an IP-loopback
origin; this override must remain false for a hosted candidate.

A passing preflight proves only the tested origin at that moment. It does not
provision or rotate secrets, configure an edge firewall or distributed rate
limits, validate telemetry and alerts, approve retention, activate the
portfolio, or authorize public launch.

## Routes

- `GET /health` reports only public corpus availability, schema version,
  corpus version, and evidence count.
- `GET /v1/public-evidence/manifest` returns the exact frozen v1 manifest.
- `POST /v1/portfolio/answer` accepts strict JSON with a question of at most
  800 characters. It returns at most five exact exported claims and their
  site-relative citations.
- `POST /v1/portfolio/job-fit` accepts strict JSON with a job description of at
  most 12,000 characters. It returns at most 24 bounded requirements,
  conservative assessments, and resolving site-relative public citations.
- `POST /v1/portfolio/contact-intent` accepts strict JSON with bounded name,
  email, optional organization, message, and literal `consent: true`. A valid
  request returns `202 pending_review` without echoing contact fields.

When bearer mode is enabled, every `/v1/` route requires the exact configured
token in `Authorization: Bearer <token>`. Missing, malformed, and incorrect
credentials return the existing non-disclosing `401 request_rejected` envelope
and are recorded only as the fixed `unauthorized` audit outcome. Token
comparison uses fixed-size SHA-256 digests and constant-time comparison. The
minimal `/health` route remains credential-free for an external load balancer;
the separate operations listener must remain private.

The artifact is re-read, schema-validated, and hash-verified on every request.
Missing, malformed, incompatible, internally inconsistent, or tampered
artifacts fail closed with a non-disclosing `503` response. Responses use
`no-store` and restrictive security headers. No CORS policy is enabled.

All non-success responses use the frozen safe error envelope: schema version,
one bounded public error code and message, and an opaque per-request ID. A
retryable response may add `retryAfterSeconds`; an artifact schema mismatch
adds the supported schema versions. Internal adapter, provider, filesystem,
and policy failure names never cross the public boundary.

Answers use deterministic lexical overlap with stable evidence-ID tie-breaking.
Carl's name is treated as non-discriminating so it cannot pull unrelated records
into a specific answer. Question text is never executed or copied into the
response. When no reviewed public claim matches—including for unsupported or
injection-like input—the service returns an explicit no-evidence response.
Version 1 has no session field or transcript continuity; questions and job
descriptions remain ephemeral inputs.

## Optional grounded answer synthesis

The default `JOLENE_PUBLIC_ANSWER_MODE=deterministic` makes no answer-model
request and requires no API key. Model synthesis is enabled only when the mode
is explicitly set to `openai` and `.env.public.local` contains a non-empty
`OPENAI_API_KEY`. The public process does not read `.env.local`, and setup does
not copy the private service key into the public environment.

Deterministic evidence selection always runs first. If no reviewed public claim
matches, the service returns the normal no-evidence response without calling
OpenAI. For a supported question, the provider receives only the visitor's
question and each already-public selected claim's text, limitations, and
citation title. It does not receive citation links, session tokens, contact
intents, job descriptions, audit data, private paths, Obsidian content, Slack
content, private memory, or private retrieval results.

The adapter uses the Responses API with `store: false`, no tools, a bounded
output budget, a bounded timeout, and a strict JSON schema containing only an
answer string. The existing deterministic response owns every other field:
claims, citations, limitations, follow-up questions, and corpus version cannot
be replaced by model output. Provider failure,
timeout, refusal, malformed JSON, empty text, or oversized text returns the
exact deterministic answer. The audit ledger records only fixed
`model_supported` or `model_fallback` outcomes and never submitted or generated
content.

`store: false` is an API request control, not a promise about every aspect of a
provider's processing or retention. Visitor questions remain untrusted external
data. Model mode therefore remains a local evaluation feature until provider
terms, prompt-injection and grounding evaluations, cost controls, and the public
deployment topology are reviewed.

Model mode also requires a content-free persistent request budget. The budget
stores only its schema version, window start, and aggregate request count. It is
consulted only after deterministic evidence selection finds support, so
no-evidence requests consume no budget and never call the provider. Each
admitted provider attempt is counted before generation, including failures.
Exhausted, corrupt, or unavailable budget state bypasses the provider and
returns the exact deterministic answer with the fixed
`model_budget_fallback` audit outcome. The default cap is 100 attempts per
fixed 24-hour window; changing it is an operational decision, not permission
to enable model mode.

The first offline backend evaluation baseline is documented in
[Public delegate offline evaluation](public-delegate-evaluation.md). It uses
versioned deterministic and fake-provider fixtures; it does not make a live
provider request or replace the remaining human, portfolio, operational, and
launch gates.

Job-fit comparison deterministically segments the submitted description and
uses lexical overlap against exact public claims and citation titles. A strong
overlap is `direct`; partial overlap is `adjacent`; no support is `unknown`.
This baseline never emits `missing`, because absence from the public corpus is
not evidence that Carl lacks an experience. Results explicitly state that they
are not a recommendation or blanket fit score. The job description is treated
as untrusted ephemeral input: it is not logged, persisted, executed, sent to a
model, or used to access private context. Instruction-like input fails to
citation-free `unknown` results.

Both `missing` and `unknown` assessments are contractually citation-free.
`direct` and `adjacent` require resolving evidence. Citation destinations are
site-relative so the portfolio, rather than the delegate, controls the approved
browser origin.

Contact intents are staged in a dedicated local queue, not Jolene's private
database. The queue stores only the fields the visitor explicitly submitted,
plus an intent ID, submission time, pending-review status, and expiry time. It
uses serialized atomic writes, owner-only directory/file permissions, a maximum
entry count, and configurable retention of at most 90 days. Retention is
enforced on startup and on each new submission. Likely credential material is
rejected rather than stored. Request payloads are not logged, and there is no
public queue-read route.

The local JSON queue is permission-restricted but not application-encrypted.
Disk encryption and physical account security protect this development slice;
encrypted managed storage and a deletion SLA remain production gates.

## Local audit ledger

The public process writes a separate, owner-permission local audit ledger. Each
record has a random event ID, timestamp, one fixed operation name, normalized
method, HTTP status, fixed outcome, bounded duration, optional corpus version,
and non-content result counts. The schema has no fields for raw URLs, request or
response bodies, questions, job descriptions, contact data, session tokens,
source addresses, headers, citations, claim text, or stack traces.

Writes are serialized and atomic. Startup and reads validate the complete file;
retention is capped at 90 days and entry count at 10,000. The default is 30
days and 5,000 entries. There is no HTTP read route. Audit failure is contained
and cannot change or broaden the public response; startup reports only a generic
local warning without disclosing a path or submitted content.

This is development evidence, not production telemetry. Authenticated access,
centralized aggregation, availability monitoring, deletion operations, and an
approved production retention policy remain deployment gates.

## Private operations plane

The reference process starts a second HTTP listener on
`JOLENE_PUBLIC_OPERATIONS_HOST:JOLENE_PUBLIC_OPERATIONS_PORT`. It defaults to
`127.0.0.1:8432`; `compose.public.yaml` does not publish that port to the host.
The frozen portfolio API remains unchanged on port 8431.

The private listener has exactly three read-only routes:

- `GET /live` proves that the operations event loop is serving;
- `GET /ready` reports fixed states for delegate enablement, public evidence,
  the contact queue, audit ledger, and optional model-request budget; and
- `GET /metrics` returns process-start time, observation time, total and
  in-flight request counts, concurrency high-water mark, fixed
  operation/method/outcome counters, status classes, and bounded latency
  buckets.

The schemas have no fields for raw or normalized client identity, IP address,
headers, user agent, URL, request ID, prompt, answer, job description, contact
field, citation, claim text, provider detail, filesystem path, or stack trace.
Metrics are in-memory and reset on restart. A changed or missing public artifact
makes readiness `unready`; unavailable audit or model-budget state makes it
`degraded` without broadening a response. The container healthcheck uses the
private readiness route.

`SIGINT` and `SIGTERM` stop admission by closing both listeners, drain active
requests for up to five seconds, close idle connections immediately, and then
force-close any request that cannot finish. This is a local operational
contract, not centralized production monitoring, an alert destination, or
approval to expose the operations port.

## Response disclosure guard

Every response body passes through one deterministic disclosure policy before
egress. The same policy protects the offline career export, preventing the two
boundaries from drifting. It recursively inspects response values for private
filesystem paths and hosts, file or Obsidian URIs, Obsidian wikilinks, likely
credentials, email addresses, and phone numbers. Values are data only and are
never treated as instructions.

If a value violates the policy—or policy inspection itself fails—the delegate
discards the entire candidate response and returns only the generic no-store
safe `503 unavailable` envelope. It does not disclose the matching value,
field, rule, path, or stack trace. The audit ledger records only the fixed
`response_blocked` outcome without corpus metadata or result counts. Existing
valid manifest, answer, job-fit, contact-intent, admission, and error responses
retain their frozen contracts.

This guard is defense in depth, not a substitute for public-evidence review,
provider-output validation, portfolio BFF controls, or production monitoring.

Staging never sends email or Slack, schedules a meeting, contacts a recruiter,
or authorizes Jolene to negotiate or make promises. The separate private local
service can list the exact owner-scoped queue, mark an item reviewed, save an
inert reply draft in the same queue, and permanently delete an item after exact
confirmation. It does not copy contact fields into the private SQLite database.
The visitor message remains untrusted data. No send, approval, mail-provider,
Slack, scheduling, or negotiation operation is exposed.

All other routes return `404`; unsupported methods on known routes return
`405`. The server bounds header size, header count, request time, keep-alive
requests, URL length, per-client request rate, and global concurrency.

These controls are appropriate for the current loopback reference process,
not a public deployment. Origin bearer authentication now gives the portfolio
BFF a real service credential, but the rate and concurrency controls remain
in-memory and source-address based. They reset on restart and are not a
substitute for authenticated edge admission, distributed rate limiting, or
the portfolio BFF controls.

## Remaining boundary

`JOL-CAREER-005` remains incomplete. The loopback-only private review,
deletion, and inert reply-draft workflow is implemented, but authenticated
production owner access and any outbound reply workflow still require separate
privacy, abuse, evaluation, and human-approval gates. Disabled-by-default
grounded answer synthesis exists, but model-backed answer quality remains open.
A content-minimizing local audit ledger and private aggregate operations plane
exist, but the
deterministic job-fit baseline still requires integration and evaluation before
any public use. Authenticated audit access, production aggregation and
alerting, provider-specific redaction, token/cost reconciliation, and
distributed abuse controls remain open. The isolated loopback container is implemented, but
adding a production bind address, public hostname, reverse proxy, CORS policy,
or deployment requires explicit approval and a reviewed deployment topology.
