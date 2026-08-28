# Private control authentication

The local Jolene control plane is private even though it binds to loopback.
Loopback and same-origin validation reduce exposure; they are not identity
proof. All UI assets and control/API routes require a dedicated high-entropy
credential before routing. `/health` is the only exception and returns only a
fixed minimized readiness summary.

## Authority contract

- The server derives Carl's actor ID, workspace ID, `private_chat` channel, and
  `local_private` disclosure scope from authenticated configuration.
- `POST /v1/chat` rejects caller-supplied actor, workspace, channel-kind, or
  disclosure authority fields.
- Slack is a separate authenticated transport. Private Slack scope requires the
  exact configured `SLACK_OWNER_TEAM_ID` and `SLACK_OWNER_USER_ID` pair.
- Retrieved content, browser input, query parameters, forwarded headers, and
  Slack-like JSON cannot establish identity or disclosure authority.

## Credentials

Direct host development accepts exactly one of:

```dotenv
JOLENE_PRIVATE_CONTROL_TOKEN=<at-least-43-character-high-entropy-value>
JOLENE_PRIVATE_CONTROL_TOKEN_FILE=/absolute/path/to/one-line-secret
```

Never configure both. The secret parser rejects missing, short, whitespace,
multiline, oversized, and ambiguous configurations. Browser access uses native
HTTP Basic authentication with username `jolene` and the private-control token
as the password. API clients use the same value as a Bearer credential.

The credential is a reusable possession secret. If it may have been copied,
logged, or observed, rotate it and restart only the private API. Do not place it
in URLs, browser bookmarks, shell history, tickets, chat, or diagnostics.

## Container migration

`npm run secrets:migrate-compose` creates the ignored mode-`0600`
`.jolene/secrets/private-control-token` file. If no source value exists, it
generates a 256-bit base64url token and never prints it. Idempotent reruns reuse
the existing token. Only `jolene-api` receives this secret; Slack and monitor
workers do not.

## Failure and audit behavior

- Missing, malformed, and mismatched credentials return the same sanitized
  `401 private_control_authentication_required` response.
- Non-loopback or malformed Host values and cross-origin browser requests
  return `403 request_origin_not_permitted`.
- Authentication emits only policy version, outcome, and a fixed reason code.
  It never logs credentials, headers, IP addresses, paths, query strings,
  prompts, payloads, or private identifiers.
- A successful credential does not authorize a new capability. Existing domain
  policy, exact-action approval, and read-only tool boundaries still apply.

## Release boundary

The implementation can be built and tested locally without creating a token or
restarting a service. Credential creation, runtime restart, container cutover,
push, deployment, promotion, and production verification are separate actions.
