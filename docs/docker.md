# Docker runtime

Jolene runs as two processes built from one image:

- `jolene-api` serves the local control center and HTTP API on `127.0.0.1:8421`;
- `jolene-slack` runs the existing Slack Socket Mode adapter.

The API image healthcheck is disabled for the Slack worker because that process
maintains a Socket Mode connection and does not serve an HTTP port.

Both processes share one durable Docker volume for SQLite and receive the
Obsidian vault as a read-only bind mount. The image contains no `.env` files,
database, vault content, or local project configuration.

## Configure

Keep application credentials in the existing ignored `.env.local` file.

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
docker compose logs -f jolene-api jolene-slack
```

Open `http://127.0.0.1:8421/projects` or request
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
