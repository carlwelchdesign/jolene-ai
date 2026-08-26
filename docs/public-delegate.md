# Public delegate boundary

Jolene includes a separate local reference process for the first public
portfolio-delegate contract slice. It consumes only a versioned public career
evidence artifact. It does not load the private Jolene application or its
configuration, SQLite database, Obsidian vault, Slack adapter, durable memory,
or OpenAI client.

This slice exists to verify the frozen portfolio v1 manifest contract. It is
not a public deployment and does not implement portfolio answers, job-fit
comparison, contact intent, CORS, rate limiting, or model access.

## Local configuration

Copy `.env.public.example` to `.env.public.local` if overrides are needed. The
process reads `.env.public.local`, not `.env.local`. All settings are optional:

```dotenv
JOLENE_PUBLIC_HOST=127.0.0.1
JOLENE_PUBLIC_PORT=8431
JOLENE_PUBLIC_ARTIFACT_PATH=.jolene/exports/public-career-evidence.json
```

Only `127.0.0.1`, `::1`, and `localhost` are accepted as hosts in this slice.
The artifact path must point to the generated public export, never the private
SQLite database or vault.

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

The artifact is re-read, schema-validated, and hash-verified on every request.
Missing, malformed, incompatible, internally inconsistent, or tampered
artifacts fail closed with a non-disclosing `503` response. Responses use
`no-store` and restrictive security headers. No CORS policy is enabled.

All other routes return `404`; unsupported methods on known routes return
`405`. The server bounds header size, header count, request time, keep-alive
requests, and URL length.

## Remaining boundary

`JOL-CAREER-005` remains incomplete. Answer, job-fit, and contact-intent
behavior still require separate contract, privacy, abuse, cost, evaluation,
and human-approval gates. Adding a production bind address, container service,
public hostname, reverse proxy, CORS policy, or deployment requires explicit
approval and a reviewed deployment topology.
