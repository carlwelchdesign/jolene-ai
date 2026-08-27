# Docker runtime

Jolene runs as three processes built from one image:

- `jolene-api` serves the local control center and HTTP API on `127.0.0.1:8421`;
- `jolene-slack` runs the existing Slack Socket Mode adapter and drains durable
  owner-only Project Watch alerts and private briefings; and
- `jolene-monitor` performs bounded read-only Project Watch checks.

The API image healthcheck is disabled for the Slack worker because that process
maintains a Socket Mode connection and does not serve an HTTP port.

All three processes share one durable Docker volume for SQLite and receive the
Obsidian vault as a read-only bind mount. The image contains no `.env` files,
database, vault content, or local project configuration.

## Configure

Keep direct host-development credentials in the existing ignored `.env.local`
file. Before using the private Compose stack, separate those values into
owner-only secret files and a non-secret runtime environment:

```bash
npm run secrets:migrate-compose
```

The migration creates ignored mode-`0600` files under `.jolene/secrets` and an
ignored mode-`0600` `.env.runtime.local`. It prints only the migrated variable
names, never their values. An unchanged rerun is idempotent. Changed source
values require the explicit `--replace` argument; ordinary credential rotation
may instead update the three secret files directly.

`.env.runtime.example` documents the non-secret runtime variables. Do not add
credentials to that file or to `.env.runtime.local`.

Private Compose does not load `.env.local`. The API and monitor receive only
the OpenAI secret file. Slack receives the OpenAI, Slack app, and Slack bot
secret files. The one-shot career exporter receives none. Application config
accepts either a direct variable for host development or one matching `*_FILE`
path, never both, and rejects missing, empty, oversized, or multiline files.

Create an ignored `.env` file for Docker Compose interpolation:

```dotenv
JOLENE_OBSIDIAN_VAULT_HOST_PATH=/absolute/path/to/Carl Knowledge Vault
```

The path must exist before Compose starts. Inside the containers it is always
mounted at `/vault`, and Compose overrides `JOLENE_OBSIDIAN_VAULT_ROOT` with
that container-safe path.

## Run

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f jolene-api jolene-slack jolene-monitor
```

Open `http://127.0.0.1:8421/work` or `http://127.0.0.1:8421/projects`, or request
`http://127.0.0.1:8421/health`.

If port 8421 is already occupied by a local Jolene process:

```bash
JOLENE_HOST_PORT=8423 docker compose up --build -d
```

The container still listens on 8421; only the host-side port changes.

The HTTP process binds to `0.0.0.0` only inside its private container network;
Compose publishes it exclusively on the host loopback address. A direct local
run continues to default to `127.0.0.1` through `JOLENE_HOST`.

## Safely promote an existing local database

Treat a switch from a host-run Jolene database to the Compose volume as a data
migration. Do not start both API or Slack processes against different copies and
assume they will reconcile later.

1. Confirm which processes are running with `docker compose ps --all` and a
   process check for `dist/slack` or `src/slack.ts`. Only one Slack Socket Mode
   listener may run at a time.
2. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` against the local
   source database.
3. Build the current image and start it on an alternate loopback port against a
   disposable clone of the source database. Verify `/health`, the required UI
   routes, expected record counts, and the database checks before touching the
   live service.
4. Create a SQLite-native backup of the Compose database. Store a second copy
   outside the Docker volume so the rollback does not depend on that volume.
5. Stop only `jolene-api`, preserve the old database and WAL sidecars with a
   timestamped name, copy the validated source database into `jolene-data`, and
   recreate only `jolene-api` with the validated image.
6. Require a healthy container, verify the loopback routes and record counts,
   and rerun both database checks. Keep the old image ID and backups until the
   cutover has been reviewed.

Do not use `docker compose down -v`, replace the volume without a backup, or
start `jolene-slack` as part of an API-only cutover.

## Data and safety boundaries

- The container root filesystem is read-only.
- The process runs as the unprivileged `node` user with Linux capabilities
  dropped and privilege escalation disabled.
- Only `/data` and the bounded `/tmp` tmpfs are writable.
- The named `jolene-data` volume persists SQLite across container replacement.
- The Obsidian bind mount is read-only at the container boundary in addition
  to Jolene's application-level allowlist.
- The services bind the HTTP port to loopback, not the public network.
- `docker compose config` renders secret file locations rather than credential
  values. Treat the source `.env.local` and generated secret files as sensitive
  even though neither is committed or copied into the image.

`docker compose down` preserves the named data volume. Do not run
`docker compose down -v` unless deleting Jolene's containerized SQLite history
is explicitly intended.

The Docker runtime does not make the private Jolene API suitable for public
hosting. The portfolio chatbot must use a separate public delegate and an
approved public career-evidence corpus.

Before moving Slack from the current host process into Compose, stop the host
listener and decide whether its existing SQLite history should be migrated into
the `jolene-data` volume. Running both listeners can duplicate Socket Mode
delivery.

## Private career MCP tool container

The `jolene-career-mcp` tools-profile service exposes the canonical approved
professional corpus over stdio to an explicitly launched local MCP host:

```bash
docker compose --profile tools build jolene-career-mcp
docker compose --profile tools run --rm --no-deps -T jolene-career-mcp
```

It mounts only `jolene-data`, uses no network, publishes no port, receives no
secret or `.env` file, and has no vault, portfolio, review-packet, or public
state access. The service writes only derived retrieval state and
content-minimizing access ledgers; it cannot change career evidence or approval
state. Its provider-free lexical query path preserves any existing stored
embeddings rather than purging or regenerating them.

Running the tools-profile process does not restart the API, Slack, or monitor.
MCP host registration, exact scope configuration, tool behavior, and audit
inspection are documented in
[Private professional-context MCP](private-career-mcp.md).

## Isolated public delegate container

The public portfolio delegate has a separate Compose project and image. It does
not extend the private Compose file and does not receive `.env.local`,
`jolene-data`, the Obsidian mount, Slack configuration, private SQLite, or
private durable memory.

Generate and review the public artifact before starting it, then run the
deterministic container explicitly:

```bash
npm run career:export-public
docker compose -f compose.public.yaml up --build -d
docker compose -f compose.public.yaml ps
```

The export command runs a network-disabled one-shot job against the canonical
private Compose data volume and writes only the public-safe artifact to the
ignored host handoff path. `career:export-public:host` is development-only and
must not be used as evidence of canonical review state.

Open `http://127.0.0.1:8431/health` or request
`http://127.0.0.1:8431/v1/public-evidence/manifest`. Compose binds port 8431
only to host loopback. The process listens on `0.0.0.0` only inside its isolated
container, guarded by `JOLENE_PUBLIC_CONTAINER_MODE=true`; a direct host process
still rejects that bind address.

The same process has a separate operations listener at container loopback
`127.0.0.1:8432`. Compose does not publish that port. Its `/live`, `/ready`, and
`/metrics` routes contain only fixed component states and aggregate
content-free counters; the container healthcheck uses `/ready`. Inspect it only
through an explicit local container operation when troubleshooting. Do not add
an operations-port mapping without a separately reviewed deployment topology.

The reviewed artifact is bind-mounted read-only at
`/public-data/public-career-evidence.json`. A missing artifact is not created as
a directory and the service fails closed. The only writable persistent mount is
the dedicated `jolene-public-state` volume for the minimized contact-intent,
audit, and aggregate model-budget files. The root filesystem is read-only, the
process is non-root, Linux capabilities are dropped, privilege escalation is
disabled, and `/tmp` is a bounded tmpfs.

The default is deterministic and receives an empty `OPENAI_API_KEY`. To run an
explicit model evaluation, pass `.env.public.local` with `--env-file` and use
the separate `JOLENE_PUBLIC_CONTAINER_OPENAI_API_KEY`; never copy the private
Jolene environment automatically:

```bash
docker compose --env-file .env.public.local -f compose.public.yaml up -d
```

Stop the public process without affecting private Jolene:

```bash
docker compose -f compose.public.yaml down
```

That preserves `jolene-public-state`. Removing the volume is a separate
destructive operation and is not part of ordinary rollback. This local
container is an integration-test boundary, not a public hostname, reverse
proxy, deployment, or launch authorization.
