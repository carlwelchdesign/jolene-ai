# Career relationship topology readiness audit

`JOL-CAREER-008B` adds a content-minimizing gate before Jolene authors or
activates a private multi-hop career benchmark. It measures whether the
canonical reviewed evidence registry has enough precise claim-level
relationships to support meaningful question review.

Run the canonical-volume audit with:

```bash
npm run career:relationships:audit
```

Exit `0` means every data-readiness threshold passes. Exit `1` means the audit
ran correctly but the current corpus is not ready. Exit `2` means the database
or schema was unavailable or invalid.

## Read boundary

The packaged operation has no network, ports, secrets, provider configuration,
vault mount, public artifact, or write-capable database mount. It opens the
canonical SQLite database in read-only mode and selects only:

- stable source, claim, and relationship IDs;
- actor/workspace scope;
- lifecycle, review, visibility, and review-time fields; and
- typed relationship endpoints.

It does not select source or claim titles, propositions, contributions,
provenance, metadata, Obsidian paths, retrieved excerpts, or private notes. The
report contains a one-way corpus fingerprint, aggregate counts, basis-point
coverage, fixed metric IDs, gates, and fixed recommendation codes.

## Topology policy

The policy is fixed in code before reading the canonical corpus:

| Metric | Gate |
|---|---:|
| Direct claim-linked coverage | at least 2,500 bps |
| Effective relationship coverage | at least 8,000 bps |
| Shared entity count | at least 10 |
| Exact two-hop candidate pairs | at least 20 |
| Largest component concentration | at most 9,000 bps |

The 2,500-basis-point direct floor prevents the review set from being dominated
by broad source inheritance while still allowing enrichment to proceed in
bounded increments. The effective-coverage and candidate-pool floors require a
usable graph, while the component ceiling rejects a near-total undifferentiated
hairball.

Direct coverage counts only eligible claims with an active relationship
explicitly attached to that claim. Effective coverage conservatively lets an
active source-level relationship apply to every eligible claim from that same
reviewed source. The audit reports these separately because broad source tags
and wiki links can create a large candidate graph without proving precise
claim-to-entity relevance.

One-hop pairs share at least one typed entity. Two-hop pairs are non-adjacent
claims connected through exactly one intermediate claim. Counts are unique and
content-free. Unreviewed, stale, revoked, superseded, missing-source,
cross-scope, and cross-source claim relationships are excluded.

## Canonical result

The packaged audit ran against the canonical Docker volume on
2026-08-27 at `2026-08-27T06:24:56.845Z`. Corpus fingerprint:
`5ca6869f1ac0525620ed64aaea05d4ced61d1b3edc6977427704b9a376c4cf8b`.

| Measure | Result |
|---|---:|
| Eligible sources | 38 |
| Eligible claims | 143 |
| Eligible relationships | 190 |
| Claim-linked relationships | 39 |
| Source-level relationships | 151 |
| Directly linked claims | 10 |
| Effectively related claims | 130 |
| Shared entities | 121 |
| One-hop pairs | 3,738 |
| Exact two-hop pairs | 1,100 |
| Connected components | 16 |
| Largest component | 102 claims |
| Isolated claims | 13 |

Effective coverage passes at 9,090 basis points. Shared entities, two-hop
candidate volume, and largest-component concentration also pass. Direct
claim-linked coverage fails at 699 basis points. At the current 143-claim
corpus size, the 2,500-basis-point floor requires 36 directly linked claims;
26 additional eligible claims need reviewed claim-level relationships.

The resulting readiness code is
`claim_relationship_enrichment_required`, with recommendation
`enrich_claim_relationships_before_private_benchmark`.

## Decision boundary

This audit does not create relationships, infer relevance, author benchmark
questions, approve expected answers, alter production retrieval, or activate a
provider. The high source-inherited candidate count is not evidence that a
graph database would improve quality. `JOL-CAREER-008` remains open. The next
justified work is a review-controlled claim-relationship enrichment workflow,
followed by another audit and only then an owner-reviewed private benchmark.
GraphRAG or a dedicated graph database remains unjustified.
