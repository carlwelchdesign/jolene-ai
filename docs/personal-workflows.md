# Personal work workflows

Jolene's personal-work layer turns an actor/workspace-owned task into a durable,
reviewable sequence. It structures work without granting new tools or permission
to act outside the local system.

## Supported workflow types

- `research`
- `project_planning`
- `drafting`
- `repository_work`
- `briefing`
- `follow_up_preparation`

Each type has five explicit steps and a completion-evidence description. Step
completion requires a non-empty evidence summary. Steps cannot be skipped, and
only the exact current step can advance.

Completing the last step moves the workflow to `awaiting_review`, never directly
to `completed`. Human review may:

- approve the workflow;
- request changes and return it to an exact template step with feedback; or
- cancel it.

The event history retains workflow start, step evidence, review submission,
revision requests, approval, and cancellation. Actor/workspace scoping applies
to every read and transition. Only one active workflow of the same type may
exist for a task at a time.

## Local API

List the templates:

`GET /v1/workflow-templates`

Start a workflow for an existing task:

`POST /v1/workflows`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "taskId": "00000000-0000-4000-8000-000000000001",
  "kind": "research"
}
```

List scoped workflows:

`GET /v1/workflows?actorId=carl&workspaceId=personal&taskId=<task-id>&status=active`

Read a workflow and its event history:

`GET /v1/workflows/<workflow-id>?actorId=carl&workspaceId=personal`

Complete the exact current step:

`POST /v1/workflows/<workflow-id>/steps/<step-id>/complete`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "summary": "The scope, exclusions, and success criteria are recorded."
}
```

Review a completed workflow packet:

`POST /v1/workflows/<workflow-id>/review`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "decision": "changes_requested",
  "feedback": "Repeat the verification step with the complete test suite.",
  "returnToStepId": "verify"
}
```

For `approved` or `cancelled`, omit `returnToStepId`. Approval is a workflow
state decision only; it does not authorize sending, publishing, repository
writes, or another external side effect.

## Current boundary

This slice provides the deterministic templates, persistence, event history,
revision loop, and API. It does not yet let the model create or advance runs,
does not render a graphical workflow console, and does not schedule work. Any
future tool binding must preserve exact actor/workspace/task scope and the
existing capability-approval boundary for external actions.
