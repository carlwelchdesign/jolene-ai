# Task and memory API

Jolene's local HTTP service supports durable task context and reviewable long-term memory. It binds to `127.0.0.1`; this is a local-pilot interface, not a production authentication boundary.

## Memory contract

- Chat history remains isolated by actor, workspace, channel, and thread.
- A chat request may include a task UUID. Jolene loads that task only when it belongs to the same actor and workspace.
- Private chat receives approved global memories plus approved memories linked to that task.
- Shared channels receive no task or durable personal-memory context.
- Restricted memory must be linked to the selected task.
- Sensitive memory must be linked to the selected task and requires `includeSensitiveMemory: true` on that individual chat request.
- Expired, superseded, and forgotten records never enter model context.
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

- There is no graphical review interface yet.
- There is no bulk retention manager, semantic ranking, or automatic compaction workflow yet.
- Global approved memories are selected by recency, up to `JOLENE_MAX_MEMORY_ITEMS`; task-linked approved memories are added only for the selected task.
- Slack does not yet expose task creation or memory-review controls.
