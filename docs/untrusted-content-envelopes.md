# Untrusted content envelopes

Jolene treats retrieved, remembered, quoted, imported, submitted, tool-returned,
and model-generated content as data with no governing authority. The
`jolene.untrusted-content.v1` envelope makes that boundary runtime-validatable
instead of relying on prompt wording alone.

## Required contract

Every envelope contains:

- a typed origin and stable source ID;
- the literal authority value `none`;
- actor, workspace, channel, and thread scope, or explicit anonymous nulls;
- classification, purpose, and disclosure ceiling;
- review, freshness, and revocation state;
- stable taint and parent-derivation IDs;
- a deterministic SHA-256 fingerprint over the complete envelope body; and
- a text or JSON payload.

Missing fields, unknown fields, malformed state combinations, unsorted or
duplicate lineage, and fingerprint mismatches fail closed. Parsed values are
deep-frozen. Approval means evidence was reviewed; it never changes embedded
content into system, developer, owner, or tool authority.

## Private model boundary

The private agent sends authoritative retrieval policy separately from one JSON
array of envelopes. Current user text, same-thread quotations, tasks, task
events, durable memories, Obsidian excerpts, career records, work-status
snapshots, and watched-project results are never interpolated into named policy
sections. Model tool results use the same envelope contract.

Payloads may contain role labels, XML or Markdown delimiters, JSON-shaped
instructions, Unicode confusables, encoded strings, or quoted commands. Those
forms remain payload data with `authority: none`.

## Public model boundary

Public OpenAI answer and embedding requests receive only public-safe envelopes.
Their scope is fully anonymous, classification and disclosure are public, and
source IDs must match a small public allowlist. Absolute paths, Obsidian IDs,
private actor/workspace/channel IDs, and private classification metadata cannot
cross this boundary.

External-AI prose is immediately re-wrapped as an `external_ai_text` derived
envelope. It inherits every input taint ID and parent fingerprint before its
validated text is used. Public API responses keep their existing minimized
claim/citation contract and do not expose internal lineage metadata.

Job descriptions are ephemeral internal/no-disclosure envelopes. Contact
submissions are sensitive/no-disclosure envelopes stored only in the existing
mode-0600 review queue; the public receipt remains generic.

## Operational boundary

The envelope is a provenance and authority control, not a claim that arbitrary
content has been made safe or truthful. Downstream disclosure policy, capability
authorization, output validation, human approval, rate limits, and audit controls
still apply. This ticket adds no mutating tool, provider activation, process
restart, push, deployment, or production change.

Run the focused contract validator with:

```sh
npm run security:untrusted-content:validate
```
