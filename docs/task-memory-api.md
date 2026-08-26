# Task and memory API

Jolene's local HTTP service supports durable task context and reviewable long-term memory. It binds to `127.0.0.1`; this is a local-pilot interface, not a production authentication boundary.

## Memory Review screen

With the HTTP service running, open `http://127.0.0.1:8421/memory`. The local
screen supports the governed lifecycle without requiring direct API calls:

- review and approve or reject pending proposals;
- inspect active, expired, corrected, and forgotten records;
- propose a correction while leaving the original active until approval;
- confirm explicit forgetting before content is scrubbed;
- preview the exact authorized records and ranking evidence for a request;
- opt sensitive memory into only the current private preview;
- review a scoped task's durable timeline newest-first and record factual
  progress, evidence, decisions, blockers, or next actions.

The Task timeline tab displays the selected task's objective, current status,
and recent history. It supports task switching, refresh, empty and unavailable
states, and a mobile form-first layout. New entries use the same-origin,
actor/workspace/task-scoped event contract described below. The interface does
not expose task deletion, status mutation, scheduling, external delivery, or
public administration controls.

The selected person/workspace scope is stored only in that browser's local
storage. This makes local use convenient; it does not replace authentication or
authorization for any remotely exposed deployment.

## Memory contract

- Chat history remains isolated by actor, workspace, channel, and thread.
- A chat request may include a task UUID. Jolene loads that task only when it belongs to the same actor and workspace.
- The selected private task contributes at most 20 recent chronological task
  events by default. Events from other tasks never enter that context.
- Private chat receives approved global memories plus approved memories linked to that task.
- Shared channels receive no task or durable personal-memory context.
- Restricted memory must be linked to the selected task.
- Sensitive memory must be linked to the selected task and requires `includeSensitiveMemory: true` on that individual chat request.
- Expired, superseded, and forgotten records never enter model context.
- Authorized candidates are ranked against the current request, selected task, and memory kind before the configured limit is applied.
- Creating a proposal does not create durable memory. Only an explicit `approved` decision does that.
- Repeating the same decision is safe. A contradictory second decision returns a conflict.

## Create a task

`POST /v1/tasks`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "title": "Plan the Jolene private pilot",
  "objective": "Prepare and verify a bounded private pilot."
}
```

Use the returned task `id` as the optional `taskId` on `POST /v1/chat`.

## Review tasks

`GET /v1/tasks?actorId=carl&workspaceId=personal&status=running`

Omit `status` to list every task for that actor and workspace.

## Update task status

`PATCH /v1/tasks/{taskId}/status`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "status": "running"
}
```

Task creation and status transitions append durable timeline events in the same
database transaction. Repeating the current status is idempotent and does not
create another event.

## Record task progress

`POST /v1/tasks/{taskId}/events`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "kind": "evidence",
  "summary": "The focused persistence tests pass.",
  "details": "Restart, scope-isolation, ordering, and bounded-context cases passed."
}
```

Manual kinds are `progress`, `evidence`, `decision`, `blocker`, and
`next_action`. `created` and `status_changed` are system-owned so callers cannot
forge lifecycle history. Browser mutations must be same-origin.

Review a task's most recent events with:

`GET /v1/tasks/{taskId}/events?actorId=carl&workspaceId=personal&limit=20`

The response is chronological within the requested recent window and is capped
at 100 events. Events are actor/workspace/task scoped and persist across
restart. They are private historical context—not authority, instructions, or
proof that an external action occurred.

Supported states are `pending`, `running`, `approval_needed`, `failed`, `retryable`, `completed`, and `cancelled`.

## Propose memory

`POST /v1/memory-proposals`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "taskId": null,
  "kind": "standing_rule",
  "content": "Never silently turn chat content into durable memory.",
  "source": "Carl's direct architecture decision.",
  "sensitivity": "private",
  "expiresAt": null,
  "replacesMemoryId": null
}
```

Supported kinds are `preference`, `project_decision`, `standing_rule`, and `corrected_fact`.

Sensitivity may be `private`, `restricted`, or `sensitive`. Restricted and sensitive proposals require a `taskId`. `expiresAt` accepts an ISO 8601 timestamp with an offset and is normalized to UTC.

## Review proposals

`GET /v1/memory-proposals?actorId=carl&workspaceId=personal&status=pending`

Omit `status` to list proposals in every state.

## Decide a proposal

`POST /v1/memory-proposals/{proposalId}/decision`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "decision": "approved"
}
```

Use `rejected` to retain the review record without making the proposal available as memory.

## Review durable memory

`GET /v1/memories?actorId=carl&workspaceId=personal`

Each record reports `active`, `expired`, `superseded`, or `forgotten` state. Non-active records are retained only for review and audit; they are excluded from model context.

## Preview contextual selection

`POST /v1/context-preview`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "taskId": null,
  "query": "What remains for the audio plugin release?",
  "includeSensitiveMemory": false,
  "memoryLimit": 24,
  "taskEventLimit": 20
}
```

This read-only endpoint returns the exact task, recent task events, and memories
Jolene would authorize, plus deterministic selection evidence: candidate count,
normalized query terms, score, matched terms, and selection reasons.

The `deterministic_lexical_v1` strategy scores current-request matches most strongly, then task-term matches and selected-task scope. Standing rules and preferences retain small baseline scores because they may apply across requests. Global project decisions and corrected facts with no request or task relevance are excluded. Ties use newest-first ordering and then stable memory ID ordering.

Selection first retrieves a privacy-filtered candidate set capped at 500 records and normally at eight times the requested output limit, with a minimum candidate window of 64. Privacy, task, sensitivity, expiry, correction, and forgetting gates run before ranking.

## Correct memory

Create another memory proposal and set `replacesMemoryId` to the active memory being corrected. The original remains active until the correction proposal is approved. Approval atomically activates the correction and marks the original as superseded.

Corrections must remain in the same global or task scope as the original. Sensitivity and expiry may be changed through the reviewed replacement proposal.

## Forget memory

`POST /v1/memories/{memoryId}/forget`

```json
{
  "actorId": "carl",
  "workspaceId": "personal"
}
```

This explicit destructive operation removes the retained content from both the durable-memory record and its source proposal. Jolene keeps only identifiers, timestamps, state, and `[forgotten]` tombstones so the system can prove that the record is no longer usable.

## Current limitations

- There is no bulk retention manager or automatic compaction workflow yet.
- The task timeline is a local review and context-entry surface; it does not
  search, rank, edit, or delete historical events.
- The graphical review interface is a local-pilot surface without production authentication.
- Ranking is deterministic lexical matching, not embedding or model-based semantic similarity; meaningfully related records that use entirely different vocabulary may be missed.
- Only the bounded authorized candidate window is ranked; an older relevant record outside that window may be missed until a future index-backed retriever is added.
- Slack does not yet expose task creation or memory-review controls.
