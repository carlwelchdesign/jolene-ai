# Private capability registry

`JOL-ARCH-001A` makes Jolene's current private model-tool surface and inert
external-message proposal boundary explicit. The registry is an immutable
runtime value returned by `GET /v1/capabilities`; it does not discover tools,
grant new authority, or turn proposals into execution.

## Current inventory

| Capability | Runtime | Model tool | Risk | Approval | Audit |
|---|---|---|---|---|---|
| `knowledge.search` | Read-only model tool | `search_obsidian` | Private read | None after exact private scope authorization | Capability invocation plus knowledge-access ledger |
| `career_evidence.search` | Read-only model tool | `search_career_evidence` | Private read | None after exact private scope authorization | Capability invocation plus career-retrieval ledger |
| `work_status.review` | Read-only model tool | `review_work_status` | Private read | None after exact private scope authorization | Capability invocation ledger |
| `watched_projects.list` | Read-only model tool | `list_watched_projects` | Private read | None after exact private scope authorization | Capability invocation ledger |
| `watched_projects.review` | Read-only model tool | `review_watched_project` | Private read | None after exact private scope authorization | Capability invocation ledger |
| `external_message.send` | Proposal only | None | External write, escalating for non-general data | Exact arguments required | Action-approval ledger |

Every definition also declares Carl as authority owner, supported data classes,
private-only context, versioned input/output contract identifiers, and its
audit mechanisms. The registry is the source for model tool names and context
enforcement. A shared channel resolves to no private model capabilities.
Career, work-status, and watched-project tools remain absent when their existing
scope checks say they are unavailable.

## Invocation ledger

Every attempted model-tool execution records exactly:

- invocation ID and inbound event ID;
- actor and workspace;
- registered capability ID and model tool name;
- `completed` or `failed`; and
- timestamp.

The table has no columns for tool arguments, queries, results, errors, channel
IDs, thread IDs, paths, credentials, or provider details. A successful private
tool call fails closed if this record cannot commit. A failed tool call records
only the fixed `failed` outcome and then preserves the original tool failure.

Specialized ledgers remain authoritative for their narrower evidence: Obsidian
search keeps its keyed query fingerprint and citations, while career retrieval
keeps its own content-minimizing evidence-access record. The capability ledger
does not duplicate either payload.

With the local private service running, inspect bounded records using:

```text
GET /v1/capability-invocations?actorId=carl&workspaceId=personal&limit=50
```

An optional exact `eventId` narrows the list. This is a local-pilot review route,
not authenticated remote administration.

## Remaining boundary

This slice inventories the current reasoning-model tools and external-message
proposal boundary only. Local graphical/admin API operations, background worker
operations, the isolated public delegate, future email/calendar integrations,
specialists, remote MCP, and any trusted delivery adapter require separate
registry additions and delivery gates. No external execution is implemented.
