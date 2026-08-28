# Slack vault disclosure policy

JOL-PER-011 defines the authorization contract that must exist before any
private Obsidian material can be disclosed in a private or shared Slack channel.
It does not activate that capability.

## Current runtime boundary

The live retrieval policy remains deny-by-default:

- shared and private Slack channels cannot retrieve Obsidian knowledge, durable
  memory, private career evidence, or private work context;
- an unverified direct message has the same denial;
- only Carl's configured and verified owner DM may use the existing private
  retrieval scope;
- message text, retrieved notes, and prompt-injection content cannot create or
  widen disclosure authority.

## Required one-time grant

Before a future integration may disclose vault material to a Slack channel, an
authenticated owner review must create a grant bound to all of the following:

- authenticated, human owner-review authority with no model or retrieved-content
  derivation, plus Carl's exact owner actor ID and workspace;
- `slack_private` or `slack_shared`, one exact Slack channel, and one thread;
- the complete exact recipient-user set;
- one stated purpose;
- exact relative note paths and headings, with no traversal or wildcards;
- a SHA-256 fingerprint of the exact outgoing content;
- an issue time and an expiry no more than fifteen minutes later.

Authorization fails closed if any field differs, if the grant is early or
expired, or if recipients or sources were added or removed. A successful
decision is `allow_once`; reuse prevention must be enforced by the future grant
store when integration work is authorized.

The decision object is safe for an audit ledger: it contains only the policy
version, grant ID, allow/deny outcome, bounded reason codes, and expiry. It does
not repeat the purpose, content fingerprint, recipients, or private note paths.

## Explicit non-activation

This ticket adds the pure contract and deterministic verifier only. It does not
add an approval UI, persistence, Slack membership lookup, grant consumption,
private retrieval in shared channels, message delivery, or deployment. Until
all of those are implemented and separately verified, the current retrieval
policy continues to deny private sources in private and shared Slack channels.
