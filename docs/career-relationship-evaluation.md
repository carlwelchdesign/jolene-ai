# Career relationship retrieval evaluation

`JOL-CAREER-008A` adds a deterministic offline benchmark for deciding whether
relationship-aware retrieval deserves further investment. It compares the
production SQLite lexical index with an evaluation-only relational baseline.
It does not change Jolene's production retrieval path.

Run the committed benchmark with:

```bash
npm run eval:career:relationships
```

The command exits `0` only when every precommitted blocker threshold passes,
`1` when a valid suite fails a hard gate, and `2` when the fixture cannot be
loaded or validated.

## Benchmark contract

The versioned fixture at `evaluations/career-relationship-v1.json` contains
only synthetic sources, claims, relationships, and questions. Every stable ID,
expected claim set, lexical seed limit, result limit, traversal depth, and
threshold is fixed before execution. Schema validation rejects duplicate IDs,
dangling source/claim references, duplicate expectations, and seed limits that
exceed the result budget.

The v1 baseline has three questions:

- a one-hop connection between governed automation and teaching practice;
- a two-hop connection from typed interfaces through service boundaries to
  release operations; and
- a direct audio-product lookup that must not regress.

The canonical data also attaches unreviewed and revoked decoy claims to the
same high-value entities. Both the production lexical index and the relational
baseline exclude them through the existing source/claim eligibility policy.

## Relational baseline

The production index runs in lexical-fallback mode with embeddings explicitly
disabled. Its top bounded results become the measured baseline. The
evaluation-only relational pass then:

1. takes the precommitted number of highest-ranked lexical claims as seeds;
2. connects each eligible claim to the typed entity endpoints on its active
   relationships;
3. traverses at most two claim-to-claim hops through shared entities;
4. ranks each depth by shared-entity count and stable claim ID; and
5. fills any remaining result capacity with residual lexical results.

The first implementation run exposed an important ranking defect: a weak
one-word lexical match consumed the final result slot before a two-hop
operational claim could be reached. The baseline now makes the seed budget
explicit and ranks bounded relationship expansion before residual weak lexical
matches. The expectation was not weakened.

## Gates and report privacy

All six metrics require a 100% pass rate:

- contract validity;
- lexical baseline coverage;
- relational recall at K;
- relational precision at K;
- relational no-regression; and
- strict relational improvement for the two multi-hop questions.

Reports contain only the suite version/hash, aggregate metric counts/rates,
stable question IDs, pass/fail states, and fixed reason codes. They omit
questions, source and claim prose, claim IDs, relationship IDs, retrieved
excerpts, paths, and provider details.

The current v1 run passes 3/3 questions and 6/6 blocker metrics. Mean recall at
K rises from 6,111 to 10,000 basis points in this synthetic fixture, while
relational precision remains 10,000 basis points. Its fixture hash is
`f1f5df8deb6337096c1c8dd8c023d2abb47ab7bb42f6e80605e798cf7be88254`.

## Decision boundary

This synthetic result shows that the existing relationship model can support a
small deterministic multi-hop baseline. It does not measure Carl's canonical
private corpus, arbitrary questions, embedding quality, latency at production
scale, or graph operations. `JOL-CAREER-008` remains open for a separately
reviewed private-corpus question set and comparative measurement. GraphRAG or a
dedicated graph database remains unjustified until that evidence shows a
material advantage worth its privacy and operational cost.
