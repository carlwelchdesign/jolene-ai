# Knowledge access ledger

Jolene records each private knowledge-tool search before its results can return
to the model. This creates provenance evidence for read-only Obsidian use without
copying additional private content into the audit database.

## Retained evidence

Each access records:

- actor, workspace, channel, and thread scope;
- the inbound event ID associated with the model turn;
- a keyed SHA-256 query fingerprint, not the raw query;
- completed or failed status, result count, and bounded error classification;
- the exact note path, heading, modification time, and retrieval score for each result.

The fingerprint key is process-local, so common queries cannot be recovered with
a simple hash dictionary and fingerprints are intentionally not stable across
service restarts. The ledger does not retain raw search text or retrieved excerpts. A successful
retrieval fails closed if its access record and citations cannot be committed.
Retrieval failures may be recorded for diagnostics, but never return note content.

## Review access records

`GET /v1/knowledge-accesses?actorId=carl&workspaceId=personal`

Optional query parameters:

- `eventId` limits results to one inbound event;
- `limit` controls the newest-first result count from 1 to 200 and defaults to 50.

The endpoint is actor/workspace scoped and read-only. Like Jolene's other local
HTTP routes, it binds to `127.0.0.1` for the pilot and is not an authenticated
production administration boundary.

## Current boundary

This ledger proves private knowledge access. It is not yet the disclosure ledger
required before Jolene may send private knowledge to another person, client AI,
or external system. No such sharing capability is added by this slice.
