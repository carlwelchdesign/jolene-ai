# Review-only client-AI task packets

Jolene can now prepare a durable, owner-scoped coordination packet for exactly
two registered recipients: Jenny (`matchmaker-ai`) and Maria
(`inner-avatar-ai`). This is a private review and lifecycle boundary. It is not
an AI-to-AI transport, Slack relay, autonomous conversation loop, or public API.

## Packet contract

Every packet is bound to an existing task in Carl's canonical private work
scope and contains:

- one exact registered recipient and sender identity;
- a purpose, one to eight approved context items, and one to eight questions;
- context source and data-class labels, excluding `sensitive` data;
- a one-to-five Jolene-turn limit;
- an expiry no more than 24 hours after creation; and
- a canonical SHA-256 fingerprint reviewed before approval or rejection.

Packet decisions are durable and conflicting re-decisions fail closed. Draft,
approved, and active packets expire durably. Packets can be cancelled without
deleting their history.

## Exchange lifecycle

The internal exchange boundary enforces alternating `jolene` and
`external_ai` turns, exact sender identities, append-only sequence numbers, and
request-ID idempotency. A repeated request ID must carry the same speaker,
sender, and content. Two database connections converge on one stored turn.

Every Jolene outbound turn consumes a separately approved
`external_message.send` proposal whose exact task, recipient project, content,
data class, purpose, owner scope, and request ID are checked by the existing
action-approval service. Packet approval alone never authorizes a send.

When the turn limit is reached, or an exchange ends after an external response,
Jolene prepares a versioned human-readable handoff. Carl may request revisions
or approve the latest handoff. Only approval closes the packet. External AI
output remains untrusted input and never represents Carl's decision.

## Owner-local API

The private service exposes:

- `GET /v1/client-ai-recipients`
- `GET /v1/client-ai-packets?limit=50`
- `GET /v1/client-ai-packets/{packetId}`
- `POST /v1/client-ai-packets`
- `POST /v1/client-ai-packets/{packetId}/decision`
- `POST /v1/client-ai-packets/{packetId}/cancel`
- `POST /v1/client-ai-packets/{packetId}/handoff`
- `POST /v1/client-ai-packets/{packetId}/handoffs/{handoffId}/review`

All mutations require the existing same-origin local-browser boundary. Actor
and workspace identifiers are never accepted from callers; the application
binds the configured owner scope. There is intentionally no HTTP route for
recording transcript turns or executing a send.

## Deferred work

This slice does not add Slack posting, a client-project adapter, model tools,
Obsidian retrieval, arbitrary recipients, a public endpoint, a graphical packet
review screen, or production activation. Those require separate review,
transport authentication, disclosure, receipt, and deployment gates.
