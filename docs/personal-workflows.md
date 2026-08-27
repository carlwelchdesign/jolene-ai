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

### Graphical workflow console

With Jolene's HTTP service running, open
`http://127.0.0.1:8421/workflows`. The local console supports:

- starting a workflow from an existing task or a newly created task;
- current-step guidance and evidence capture;
- visible progress and durable event history;
- explicit completion review;
- changes requested back to an exact step; and
- cancellation with retained read-only history.

The interface persistently distinguishes workflow completion from permission to
send, publish, modify a repository, or perform another side effect. It uses the
same browser-local actor/workspace scope as Memory and Approvals and is not an
authenticated production administration surface.

### Private work-status tool

In a local CLI turn or a DM from the configured Slack owner, Jolene can review
the canonical owner's persisted tasks and associated workflow progress. The
tool can filter by stored task status and returns bounded task summaries,
status counts, and current workflow steps. It does not infer that an external
action occurred from a task or workflow record.

The tool is absent from shared channels and unrecognized Slack DMs. It is
strictly read-only: it cannot create or update tasks, advance or cancel a
workflow, schedule work, send a message, publish, or execute an external action.
The Slack conversation remains isolated under its Slack identifiers even though
the authorized private work lookup uses the canonical owner scope.

### HTTP routes

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
revision loop, API, local graphical workflow console, and private read-only
model status review. It does not let the model create or advance runs and does
not schedule work. Any future mutating tool binding must preserve exact
actor/workspace/task scope and the existing capability-approval boundary for
external actions.
