# Private RAG security boundary

Status: locally implemented and verified for `JOL-SEC-007`. This document does
not claim deployment, provider activation, Slack activation, or production
verification.

## Enforced boundary

Jolene treats retrieved and replayed private content as data with authority
`none`. The current authenticated user message supplies intent; notes,
recommendations, history, memory, task events, work-status results, and watched
project observations cannot authorize tools or change policy.

Before private context is copied to OpenAI, the runtime binds it to the current
actor, workspace, channel, thread, event, disclosure ceiling, namespace,
origin, classification, payload class, and size budget. Provider egress is
`local_only` by default. `approved_openai` is an explicit operator setting, not
a model decision.

The provider gate rejects or quarantines:

- instruction-like, authority-claiming, or cross-source retrieval text;
- split instructions detected across a collection;
- alternate encodings, credential-shaped text, private paths/hosts, and
  contact data;
- namespace, origin, classification, scope, freshness, revocation, budget, or
  provider-payload-class drift; and
- a later record carrying a taint that is already quarantined.

Quarantine storage is content-minimizing: it records fingerprints, taint IDs,
risk codes, scope, and timestamps, not the source text. Taint propagates to
derived indexes, summaries, caches, packets, and model copies. Parent
revocation or a compromised-turn reset invalidates descendants transitively.
Safe release is explicit; recurring poisoned content reactivates quarantine.

If no record can cross the provider boundary, Jolene emits fixed fallback
metadata without excerpts, counts, paths, contact data, or credentials. The
current user message remains provider-visible because the private chat itself
is provider-backed; that message is not treated as retrieved evidence.

## Usefulness boundary

Under explicit approved-provider egress, ordinary recipes, personal
preferences, reviewed career evidence, recommendations, safe same-thread
history, task context, and read-only tool observations remain usable. All
provider-visible envelopes retain authority `none` and provenance/taint
lineage.

## Residual risk and non-claims

- Pattern and fixture coverage is finite. Novel multilingual, semantic,
  steganographic, or model-specific attacks can evade detection.
- Collection-level quarantine is deliberately conservative and may suppress
  benign context that arrived beside suspicious content.
- The private career MCP is a local read-only evidence boundary. A separate
  client that forwards MCP results to a model must enforce its own egress gate;
  Jolene cannot govern an external client after delivery.
- Provider retention, provider-account compromise, endpoint compromise,
  backups, and already-copied external data are not erased by local revocation.
- The authenticated current user can intentionally ask the provider to process
  sensitive text. This control prevents retrieved content from silently
  escalating authority; it is not a substitute for the owner's judgment.
- No consequential or mutating capability is exposed to the model. Adding one
  requires a separate release-blocking security review and exact-action human
  approval.

## Verification

Run with Node 22 or newer:

```sh
npm run security:private-rag:validate
npm run security:prompt-injection:validate
npm run security:tool-authorization:validate
npm run security:untrusted-content:validate
npm run check
npm run build
```

The validator binds this document, the versioned fixture suite, the gate,
quarantine/derivation store, runtime integration points, and regression tests.
Docker and public-delegate checks remain separate verification steps; passing
them does not constitute deployment.
