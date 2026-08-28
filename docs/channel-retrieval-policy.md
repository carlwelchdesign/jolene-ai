# Channel-aware retrieval policy

Jolene resolves one versioned policy before loading conversation history,
durable memory, Obsidian knowledge, career evidence, or private work tools.
Message text and retrieved content are never policy inputs, so prompt injection
inside a note, recommendation, memory, or quoted conversation cannot widen the
active source set.

## Retrieval matrix

| Surface | Conversation history | Durable memory | Obsidian personal knowledge | Career evidence |
|---|---|---|---|---|
| CLI / private local chat | Same thread only | Approved owner scope; sensitive items require an explicit request | Allowed with exact note-path and heading citations | `internal_approved` and `public_approved`, with source and claim IDs |
| Slack owner DM | Same thread only | Allowed only after the configured owner identity resolves to the canonical private scope | Allowed only under that same verified owner-DM scope | `internal_approved` and `public_approved` only under the verified owner-DM scope |
| Unverified Slack DM | Same thread only | Denied | Denied | Denied |
| Private/shared Slack channel | Same thread only | Denied | Denied | Denied |
| Public portfolio | None | Denied | Denied | `public_approved` artifact records only, cited by public evidence ID |

Shared Slack remains deny-by-default because the current runtime has no exact,
expiring per-disclosure scope for private material. A private Slack channel is
not treated as proof that every participant may receive Carl's private context.
Client-AI task packets and external-message approvals remain separate systems;
neither one silently widens this retrieval policy.

The non-activating authorization contract in
`docs/slack-vault-disclosure-policy.md` defines the exact owner, workspace,
channel, thread, recipient, source, content-fingerprint, purpose, and expiry
binding a future integration must satisfy. Defining that contract does not make
private retrieval available on either shared or private Slack.

## Enforcement points

- `JoleneService` resolves the policy before loading same-thread history or
  approved durable context.
- The model capability selector checks the resolved policy before exposing
  Obsidian, career, work-status, or Project Watch tools.
- Tool results retain their existing citation contracts and are labeled as
  untrusted evidence, never instructions, in the model input.
- The public exporter verifies the portfolio policy permits a claim's
  visibility before serializing it. The public runtime still receives only the
  isolated, versioned artifact and has no private storage or vault route.

## Non-goals

This policy does not add a disclosure-approval UI or store, one-time grant
consumption, Slack membership verification, shared-Slack private retrieval,
client-AI delivery, cross-channel conversation memory, semantic retrieval,
deployment, or Vercel configuration. Those require separate scoped
authorization and verification.
