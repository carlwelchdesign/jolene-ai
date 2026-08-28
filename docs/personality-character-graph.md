# Personality character graph

`research/personality-character-graph-v1.json` is Jolene's versioned, machine-readable
map from the reviewed personality corpus to its admission decisions. It is a local
research artifact, not a runtime prompt or deployment authorization.

The graph contains:

- eight trait nodes with their admitted or deferred state, evidence-diversity counts,
  decision reason, owner-decision state, and any original designed behavior rule;
- content-minimized observation-reference nodes for every supporting or contradictory
  observation used by the admission audit;
- explicit support and counterexample edges from observations to traits;
- seven anti-caricature constraint nodes connected to every trait; and
- fingerprints binding the graph to the exact reviewed corpus and admission audit.

Observation nodes deliberately omit excerpts, paraphrases, source URLs, locators,
alternative interpretations, and source-expression fingerprints. The graph preserves
provenance and contradiction structure without becoming a transcript or quotation
archive.

Generate and validate it with:

```sh
npm run research:personality:character-graph:v1:generate
npm run research:personality:character-graph:v1
```

Generation is deterministic: the admission audit's completion time is used as the
artifact timestamp, nodes and edges have stable ordering, and the graph fingerprint is
computed over every field except the fingerprint itself. Validation reconstructs the
expected graph from the bound source artifacts and rejects dangling relationships,
changed decisions, stale fingerprints, or prohibited source-content fields.

Current reviewed state: one admitted trait (`uncertainty-humility`), seven deferred
traits, 111 referenced observations, and seven anti-caricature constraints. Runtime
activation remains prohibited by this artifact; runtime admission is governed separately.
