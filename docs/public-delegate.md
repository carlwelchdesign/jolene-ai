# Public delegate boundary

Jolene includes a separate local reference process for the first public
portfolio-delegate contract slice. It consumes only a versioned public career
evidence artifact. It does not load the private Jolene application or its
configuration, SQLite database, Obsidian vault, Slack adapter, durable memory,
or OpenAI client.

This slice verifies the frozen portfolio v1 manifest, answer, job-fit, and
contact-intent contracts. It is not a public deployment and does not implement
model-generated answers, autonomous contact, CORS, or model access.

## Local configuration

Copy `.env.public.example` to `.env.public.local` if overrides are needed. The
process reads `.env.public.local`, not `.env.local`. All settings are optional:

```dotenv
JOLENE_PUBLIC_ENABLED=true
JOLENE_PUBLIC_HOST=127.0.0.1
JOLENE_PUBLIC_PORT=8431
JOLENE_PUBLIC_ARTIFACT_PATH=.jolene/exports/public-career-evidence.json
JOLENE_PUBLIC_CONTACT_QUEUE_PATH=.jolene/public/contact-intents.json
JOLENE_PUBLIC_CONTACT_RETENTION_DAYS=30
JOLENE_PUBLIC_CONTACT_QUEUE_MAX_ENTRIES=500
JOLENE_PUBLIC_AUDIT_PATH=.jolene/public/audit.json
JOLENE_PUBLIC_AUDIT_RETENTION_DAYS=30
JOLENE_PUBLIC_AUDIT_MAX_ENTRIES=5000
JOLENE_PUBLIC_REQUESTS_PER_MINUTE=60
JOLENE_PUBLIC_MAX_CONCURRENT_REQUESTS=8
```

Only `127.0.0.1`, `::1`, and `localhost` are accepted as hosts in this slice.
The artifact path must point to the generated public export, never the private
SQLite database or vault.

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

Then start the reference process:

```bash
npm run dev:public
```

After a production build, use `npm run start:public`.

## Routes

- `GET /health` reports only public corpus availability, schema version,
  corpus version, and evidence count.
- `GET /v1/public-evidence/manifest` returns the exact frozen v1 manifest.
- `POST /v1/portfolio/answer` accepts strict JSON with a question of at most
  800 characters and an optional session token of at most 256 characters. It
  returns at most five exact exported claims and their citations.
- `POST /v1/portfolio/job-fit` accepts strict JSON with a job description of at
  most 12,000 characters and an optional session token of at most 256
  characters. It returns at most 24 bounded requirements, conservative
  assessments, and resolving public citations.
- `POST /v1/portfolio/contact-intent` accepts strict JSON with bounded name,
  email, optional organization, message, and literal `consent: true`. A valid
  request returns `202 pending_review` without echoing contact fields.

The artifact is re-read, schema-validated, and hash-verified on every request.
Missing, malformed, incompatible, internally inconsistent, or tampered
artifacts fail closed with a non-disclosing `503` response. Responses use
`no-store` and restrictive security headers. No CORS policy is enabled.

Answers use deterministic lexical overlap with stable evidence-ID tie-breaking.
Carl's name is treated as non-discriminating so it cannot pull unrelated records
into a specific answer. Question text is never executed or copied into the
response. When no reviewed public claim matches—including for unsupported or
injection-like input—the service returns an explicit no-evidence response. An
optional session token is echoed for adapter continuity but is not persisted.

Job-fit comparison deterministically segments the submitted description and
uses lexical overlap against exact public claims and citation titles. A strong
overlap is `direct`; partial overlap is `adjacent`; no support is `unknown`.
This baseline never emits `missing`, because absence from the public corpus is
not evidence that Carl lacks an experience. Results explicitly state that they
are not a recommendation or blanket fit score. The job description is treated
as untrusted ephemeral input: it is not logged, persisted, executed, sent to a
model, or used to access private context. Instruction-like input fails to
citation-free `unknown` results.

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
not a public deployment. They are in-memory and source-address based, so they
reset on restart and are not a substitute for authenticated edge admission,
distributed rate limiting, or portfolio BFF controls.

## Remaining boundary

`JOL-CAREER-005` remains incomplete. The loopback-only private review,
deletion, and inert reply-draft workflow is implemented, but authenticated
production owner access and any outbound reply workflow still require separate
privacy, abuse, evaluation, and human-approval gates. Model-backed answer
quality remains open. A content-minimizing local audit ledger exists, but the
deterministic job-fit baseline still requires integration and evaluation before
any public use. Authenticated audit access, production aggregation and
monitoring, broader redaction policy, cost controls, and distributed abuse
controls remain open. Adding a production bind address, container service,
public hostname, reverse proxy, CORS policy, or deployment requires explicit
approval and a reviewed deployment topology.
