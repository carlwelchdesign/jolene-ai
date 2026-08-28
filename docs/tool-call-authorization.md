# Intent-bound tool authorization

Jolene treats model tool selection as a request, never as authority. Every
private tool call must pass a deterministic authorization gate outside the
model before any private source is read.

## Current contract

One immutable `jolene.tool-call-authorization.v1` record is created from the
authenticated current user turn. It binds:

- actor, workspace, channel, thread, and disclosure ceiling;
- the current-turn fingerprint, meaningful intent terms, receipt time, and
  two-minute expiry;
- the allowed capability, purpose, namespace, data classes, and risk tier;
- exact normalized arguments and a SHA-256 argument fingerprint;
- per-capability and per-turn call, item, and character budgets.

History, retrieved evidence, task or memory content, tool results, external-AI
text, and model output have authority `none`. They cannot create or broaden a
grant. An absent or ambiguous current intent produces no grants and fails closed
at invocation time.

## Execution order

1. Resolve authenticated channel and disclosure policy.
2. Create the current-turn authorization independently of model output.
3. Validate the selected capability and exact arguments.
4. Record a content-minimizing authorization event.
5. Consume call budget before private I/O.
6. Run the read-only operation.
7. Settle item and character budgets before returning the result.
8. Record the separate completed or failed invocation outcome.

Denials return only `The private capability could not be completed.` to the
model. The authorization ledger stores a bounded reason code and, for allowed
calls, authorization ID and argument fingerprint. It does not store raw tool
arguments, results, errors, channel IDs, thread IDs, messages, or retrieved
content.

## Fail-closed cases

- missing, ambiguous, or expired current intent;
- capability not named by the current turn;
- actor, workspace, channel, thread, or disclosure mismatch;
- malformed, broadened, cross-source, result-driven, or alternate-encoded
  arguments;
- retry or repeat after a capability or turn budget is consumed;
- oversized, expired, invalid, or repeatedly settled results;
- authority claimed from history, retrieval, tools, tasks, memory, a model, or
  another AI.

Shared Slack exposes no private tools. Private local chat uses
`local_private`; Slack private retrieval requires the exact verified owner DM
scope. Authenticated ingress remains a prerequisite: this control cannot repair
a transport that supplied the wrong principal.

## Consequential actions

No consequential model tool exists. `external_message.send` remains
`proposal_only` and has no model tool name. A future trusted adapter must retain
all of these gates:

- direct authenticated-owner review UI authority with empty taint and
  derivation sets;
- exact reviewed payload fingerprint, actor, workspace, destination, content,
  purpose, data class, and task scope;
- bounded expiry and one-time claim consumed before external I/O;
- independent delivery-outcome audit and a release-blocking adversarial suite.

Approval is permission for one exact action. It is not model authority and is
not evidence that delivery occurred.

## Verification

Run:

```sh
npm run security:tool-authorization:validate
```

The validator covers exact current-turn authorization, broadening, retries,
result limits, untrusted authority sources, channel scope, and the absence of a
consequential model tool. Unit and integration coverage additionally verify
audit minimization and that denied calls never reach private source I/O.
