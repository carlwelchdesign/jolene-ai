# Private professional-context MCP

`JOL-CAREER-007A` exposes Jolene's current owner-approved professional evidence
to trusted local MCP hosts. It is a process-spawned stdio server, not a network
service. It never loads `.env.local`, an OpenAI key, Slack credentials, the
Obsidian vault, durable conversation memory, or the public delegate artifact.

The adapter is designed for local clients such as Codex and controlled admin
tooling. Its trust boundary is the operating-system process launch: the host
must explicitly supply the actor, workspace, stable client identity, and
database path. Those values scope access and audit identity; they are not a
substitute for remote authentication. Remote MCP transport is intentionally
absent.

## Tools

All three tools advertise MCP read-only, non-destructive, idempotent, and
closed-world annotations:

- `career_search` searches at most eight current approved claims and returns
  bounded propositions, contributions, maturity, visibility, conflict state,
  conservative strength, and source citations;
- `career_inspect` returns one currently eligible approved claim by UUID, or a
  non-disclosing unavailable result; and
- `career_compare_job` segments at most twelve requirements and classifies each
  as `direct`, `adjacent`, or `unknown`. It never emits a blanket qualification
  score, and instruction-like job text does not trigger retrieval.

Internal-approved evidence is available because this is Carl's private tool.
That does not make it public-approved or authorize disclosure. Unreviewed,
stale, missing, superseded, revoked, or rejected evidence is excluded. Claims
in unresolved conflict groups remain labeled during search/inspection and are
excluded from job comparisons.

## Canonical Docker launch

Build the reviewed private image before registering the MCP server:

```bash
docker compose --profile tools build jolene-career-mcp
```

The recommended host command uses the canonical `jolene-data` volume while
retaining stdio as the only transport:

```bash
docker compose --profile tools run --rm --no-deps -T jolene-career-mcp
```

The tools-profile service has no network, ports, secrets, `.env` file, vault,
portfolio, review-packet, or public-state mount. It receives only the canonical
data volume and four non-secret scope values. It does not restart or replace
the API, Slack, or monitor services.

An MCP host entry follows this shape; replace the working directory and Docker
executable with real absolute paths supported by that host:

```json
{
  "mcpServers": {
    "jolene-career": {
      "command": "/absolute/path/to/docker",
      "args": [
        "compose",
        "--project-directory",
        "/absolute/path/to/jolene-ai",
        "--profile",
        "tools",
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "jolene-career-mcp"
      ],
      "env": {
        "JOLENE_MCP_CLIENT_ID": "codex-local"
      }
    }
  }
}
```

The server supports the official MCP TypeScript SDK's current stdio negotiation
path. Standard output is reserved for the MCP protocol; fixed operational
errors go only to standard error.

## Host-development launch

For an explicitly selected host database—not as canonical runtime evidence—run:

```bash
JOLENE_MCP_DATABASE_PATH=/absolute/path/to/jolene.sqlite \
JOLENE_MCP_ACTOR_ID=carl \
JOLENE_MCP_WORKSPACE_ID=professional \
JOLENE_MCP_CLIENT_ID=codex-local \
npm run mcp:career:dev
```

Production builds use `npm run start:mcp:career` with the same explicit
configuration. The database must already exist; startup fails before creating
an empty replacement.

## Audit boundary

Every handled tool call writes a durable content-minimizing MCP access record:

- event, actor, workspace, and stable client identity;
- tool name and timestamp;
- a process-keyed request fingerprint;
- completed, refused, or failed outcome;
- result count and approved claim UUIDs; and
- a fixed error code when refused or failed.

Arguments that do not satisfy the advertised MCP schema are rejected by the SDK
before the application handler runs. They cannot query private evidence and do
not create an application audit event; schema-valid requests are audited whether
they complete, are refused, or fail closed.

The ledger never stores query text, job descriptions, evidence prose,
provenance values, database paths, credentials, or provider errors. Under the
same explicit host configuration, inspect the most recent records with:

```bash
npm run mcp:career:audit -- 50
```

This first slice does not expose raw Obsidian search, private memory, evidence
editing, approvals, correction proposals, external messages, public endpoints,
provider calls, embedding activation, remote administration, deployment, or
launch controls.
