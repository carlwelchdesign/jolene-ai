# Jolene MVP Build Brief

## Confirmed facts

- Jolene works for Carl first; client-AI coordination is secondary.
- One portable core must serve private chat, Slack, schedules, and later voice.
- Obsidian access is read-only, allowlisted, provenance-backed, and blocked in shared channels by default.
- External, destructive, costly, publishing, sending, and sensitive-disclosure actions require exact approval.
- The earlier Job Search OS Jolene had global-thread contamination, stale history selection, in-memory deduplication, app coupling, and no researched personality engine.
- The personality must be original and useful, with no Dolly Parton impersonation or voice cloning.

## First-slice contract

Input is a message plus stable actor, workspace, channel, thread, and inbound event identity. Output is a Jolene answer and an explicit duplicate indicator. The service may search approved Obsidian notes only in private context. It persists completed exchanges atomically and records retryable failures without creating a dangling conversation turn.

## Tools and state

- Tool: deterministic read-only Obsidian search.
- State: SQLite conversations, inbound events, completed turns, and failures.
- Model: one OpenAI Agents SDK agent; no specialists yet.
- Approval: deterministic policy types are implemented, but no side-effecting tool is exposed.
- Deployment: local HTTP/CLI in this slice; Slack and always-on hosting come later.

## Non-goals

- Live Slack events
- External writes
- Scheduled jobs
- Client-AI conversations
- Specialist-agent handoffs
- Voice
- Broad vault indexing or embeddings
