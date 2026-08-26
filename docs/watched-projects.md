# Watched projects

Jolene can inspect explicitly configured local projects on demand. This first
slice is read-only and does not schedule polling.

Configure the registry as a JSON array in `JOLENE_WATCHED_PROJECTS`:

```dotenv
JOLENE_WATCHED_PROJECTS=[{"id":"portfolio","label":"Portfolio","rootPath":"/absolute/path/to/portfolio","planFile":"PORTFOLIO_SITE_PLAN.md","reviewWindowDays":30}]
```

For local development, the same JSON array may instead be stored in the ignored
`.jolene/watched-projects.json` file. The environment variable takes precedence
when both are present.

Each entry has:

- `id`: stable lowercase identifier;
- `label`: human-readable project name;
- `rootPath`: absolute local project directory;
- `planFile`: optional path inside the project root; and
- `reviewWindowDays`: age after which the plan is reported as stale.

## Local API

- `GET /v1/watched-projects` lists configured projects without exposing local
  root paths.
- `GET /v1/watched-projects/{id}/snapshot` performs a fresh read-only check.

A snapshot reports whether the directory and plan exist, plan age, Git branch
and revision when available, the number of uncommitted files, and explicit
alerts. Build verification is reported as `not_configured` until a bounded,
project-specific check is approved and implemented.

## Local control center

Open `http://127.0.0.1:8421/projects` for the graphical Project Watch screen.
It checks every configured project on first load and only checks again when the
operator uses **Check all projects**, **Check again**, or **Retry check**.

The screen covers loading, empty registry, healthy, attention, partial-failure,
and service-unavailable states. It displays no local root paths and exposes no
repair or side-effect control.

The inspector never writes project files and exposes no edit, commit, push,
deploy, or publish operation. Scheduled monitoring remains disabled until Carl
approves cadence, cost, notification destination, and a stop condition.
