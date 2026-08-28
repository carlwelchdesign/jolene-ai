# Exact action approvals

Jolene can stage an external message for review, but this slice cannot send it.
The registered `external_message.send` capability is explicitly
`proposal_only`, requires exact-argument approval, and requires an audit trail.

## Exact approval contract

Each proposal binds:

- actor and workspace;
- optional task identity;
- private origin channel;
- capability and effective risk;
- destination type and stable destination ID;
- complete message content;
- data classification and stated purpose;
- an expiration no more than 24 hours after creation.

The action arguments are canonically serialized and fingerprinted. A future
delivery adapter must present the same capability, task, destination, content,
data class, and purpose. Any mismatch fails before a one-time action claim is
created. A consumed approval cannot authorize another request; an exact retry
with the same request ID returns the original claim.

General content is classified as `external_write`. Private, restricted, and
sensitive content is classified as `sensitive_disclosure`. Restricted and
sensitive proposals must be tied to an actor/workspace-owned task.

## Local proposal API

### Graphical review

With Jolene's HTTP service running, open
`http://127.0.0.1:8421/approvals`. The local review screen supports:

- exact recipient and complete-message review;
- sensitivity, task, purpose, risk, fingerprint, and expiry inspection;
- explicit approval or rejection;
- staging a local proposal without sending it;
- waiting, approved, rejected, expired, and consumed history;
- visible reminders that approval is not delivery.

The screen deliberately contains no send or execution control. It uses the same
browser-local actor/workspace scope as Memory Review and remains a local-pilot
surface rather than an authenticated remote administration boundary.

### HTTP routes

List the registry:

`GET /v1/capabilities`

The registry also includes Jolene's current private read-only model tools. See
[Private capability registry](capability-registry.md). External messaging
remains proposal-only and has no model tool.

Create a proposal:

`POST /v1/action-proposals`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "capabilityId": "external_message.send",
  "taskId": null,
  "originChannelKind": "private_chat",
  "destinationKind": "client_ai",
  "destinationId": "jenny-ai",
  "content": "Please review the bounded workflow draft.",
  "dataClass": "general",
  "purpose": "Clarify the client review workflow.",
  "expiresAt": "2026-08-25T23:30:00.000Z"
}
```

Review proposals:

`GET /v1/action-proposals?actorId=carl&workspaceId=personal&status=pending`

Decide a proposal:

`POST /v1/action-proposals/{proposalId}/decision`

```json
{
  "actorId": "carl",
  "workspaceId": "personal",
  "decision": "approved",
  "payloadFingerprint": "<the exact 64-character fingerprint returned for the reviewed proposal>",
  "authority": {
    "source": "authenticated_owner_review_ui",
    "authority": "user",
    "taintIds": [],
    "derivationIds": []
  }
}
```

Repeated identical decisions are safe. Contradictory decisions return a
conflict, expired approvals return `410`, and proposals from shared channels are
denied. The decision is accepted only for the exact reviewed payload fingerprint
and direct current-owner review authority. Conversation history, retrieved
content, tool results, tasks, memories, another AI, and encoded or quoted claims
of approval cannot supply this authority. Approval does not imply or record
delivery.

## Current boundary

The internal one-time claim contract is available for a future trusted adapter,
but it is deliberately absent from the HTTP API and model tools. There is no
Slack, email, client-AI, publishing, purchasing, or other external execution in
this slice. Delivery attempts and receipts remain a separate implementation gate.
Any future consequential capability must remain proposal-only until it has the
same exact-argument fingerprint, owner/workspace scope, bounded expiry, direct
owner-review authority, one-time claim, and separate delivery-outcome audit.
