# Docker runtime

Jolene runs as two processes built from one image:

- `jolene-api` serves the local control center and HTTP API on `127.0.0.1:8421`;
- `jolene-slack` runs the existing Slack Socket Mode adapter.

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
