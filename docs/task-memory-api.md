# Task and memory API

Jolene's local HTTP service supports durable task context and reviewable long-term memory. It binds to `127.0.0.1`; this is a local-pilot interface, not a production authentication boundary.

## Memory contract

- Chat history remains isolated by actor, workspace, channel, and thread.
- A chat request may include a task UUID. Jolene loads that task only when it belongs to the same actor and workspace.
- Private chat receives approved global memories plus approved memories linked to that task.
- Shared channels receive no task or durable personal-memory context.
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
  "source": "Carl's direct architecture decision."
}
```

Supported kinds are `preference`, `project_decision`, `standing_rule`, and `corrected_fact`.

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

## Current limitations

- There is no graphical review interface yet.
- There is no edit, forget, expiry, sensitivity label, semantic ranking, or automatic compaction workflow yet.
- Global approved memories are selected by recency, up to `JOLENE_MAX_MEMORY_ITEMS`; task-linked approved memories are added only for the selected task.
- Slack does not yet expose task creation or memory-review controls.
