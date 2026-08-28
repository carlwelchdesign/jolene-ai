# Shared hosted coordination

`JOL-SEC-010` adds a provider-neutral Redis-compatible HTTPS coordination
boundary for the isolated public Jolene delegate. It is local development work,
not provider provisioning or deployment authorization.

The implementation follows the Redis REST JSON-array, transaction, and `EVAL`
contracts documented by Upstash. A compatible service may be used only after
its exact behavior, retention, billing, region, access, and deletion settings
are independently approved. The code has not created or contacted a real
database.

Primary protocol references:

- <https://upstash.com/docs/redis/features/restapi>
- <https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval>

## Trust boundary

The coordination endpoint and token are server-only. The standard write token
must never appear in browser code, a `NEXT_PUBLIC_*` value, Git, Asana, Slack,
logs, screenshots, Docker build arguments, or public responses. The endpoint is
accepted only as an exact allowlisted HTTPS origin. Redirects, credentials in
the URL, paths, queries, fragments, oversized responses, provider error bodies,
malformed results, and timeouts fail closed.

The store receives only:

- HMAC-derived 128-bit client tokens, never IP addresses or visitor identity;
- opaque UUID admission leases and aggregate limits;
- aggregate model-request counts;
- strict public audit fields such as operation, method, status, fixed outcome,
  duration, corpus hash, and bounded counts;
- strict security events containing closed reason/surface/capability/outcome
  values, opaque correlation/taint IDs, hashes, counts, and timing.

It never receives prompts, answers, contact messages, emails, job descriptions,
evidence bodies, Obsidian material, SQLite data, paths, credentials, provider
errors, or private Jolene memory.

## Atomic operations and keys

Every state-changing decision is one controlled `EVAL` request. Scripts can
access only the configured namespace.

| Key suffix | Data | Expiry behavior |
|---|---|---|
| `admission:client-{hmac}` | fixed-window start/count | two windows |
| `admission:leases` | expiring UUID concurrency leases | two lease periods |
| `model-budget:requests` | aggregate model request count | exact budget window |
| `public-audit:events` | strict public audit JSON sorted by time | configured retention and maximum entries |
| `public-audit:counters` | fixed aggregate counters/duration | configured retention from last event |
| `security-events:events` | strict security-event JSON sorted by time | configured retention and maximum entries |
| `security-events:counters` | fixed security counters | configured retention from last event |
| `preflight:probe` | random content-free challenge | deleted inside the same script; 5-second failsafe TTL |

Admission removes expired leases before counting concurrency. Exact release is
idempotent; if release transport fails, the lease expires automatically. Model
budget exhaustion returns the deterministic grounded answer. Coordination
unavailability returns the sanitized public `503` before artifact or model work.

## Server configuration

All fields below are required for hosted coordination. Incomplete, malformed,
or incompatible configuration leaves the adapter disabled.

```text
JOLENE_PUBLIC_COORDINATION_URL
JOLENE_PUBLIC_COORDINATION_HOST
JOLENE_PUBLIC_COORDINATION_TOKEN
JOLENE_PUBLIC_COORDINATION_NAMESPACE
JOLENE_PUBLIC_CLIENT_HASH_KEY
```

Optional bounded controls are documented in `.env.public.example`. The client
hash key is independent from the Redis token and public BFF bearer token.

## Preflight and activation

Before delegating a request, each runtime performs a cached protocol preflight:

1. `PING` must return `PONG`.
2. transaction `ECHO` must return the exact content-free challenge.
3. controlled `EVAL` must set, read, and delete the namespaced ephemeral probe.

Preflight proves command shape and write permission, not operational approval.
Activation additionally requires owner approval, a provisioned least-privilege
database, budget/spend limits, approved retention and region, credential
rotation evidence, isolated preview verification, and the existing release
evidence gates. No Vercel setting or deployment is changed by this ticket.

## Cost and capacity boundary

The provider documentation states REST usage is billed under its command/request
pricing. A normal deterministic request uses one admission operation, one exact
release, and one audit/telemetry operation. A model request adds one budget
reservation. Cached preflight adds a transaction and one ephemeral-write script
per runtime freshness window. Confirm current provider pricing and set an
account-level spend cap before activation; these development estimates are not
a billing guarantee.

## Rotation and deletion

Disable the public delegate before rotating either coordination secret. Revoke
the old token at the provider, install the replacement only in the server secret
store, run preflight in an isolated preview, and record only an opaque
fingerprint and timestamp. Rotate the client-HMAC key only with an explicit
decision to invalidate existing admission windows. Emergency deletion removes
the exact namespace after the delegate is disabled and evidence retention/hold
requirements are resolved. Never use broad recursive deletion commands from
the application runtime.
