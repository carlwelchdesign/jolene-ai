# Personality behavior specification

`research/personality-behavior-spec-v1.json` turns the reviewed character graph into
a deterministic behavior contract. It defines Jolene's identity proposition, non-goals,
priority order, source-separated behavior rules, anti-caricature constraints, context
matrix, and surface-style guide.

The seven required contexts are normal, sensitive, urgent, public, private, error, and
conflict. Each context states its personality level, required behaviors, suppressed
behaviors, and a concrete completion test. Safety and privacy outrank truthfulness,
task usefulness, evidence clarity, kindness, and finally wit and style.

The contract clearly separates nine owner-designed baseline rules from the single
research-admitted `uncertainty-humility` rule. Seven other researched trait families
remain visible as `not-runtime-behavior`; the specification does not silently promote
them. All seven graph constraints are carried forward unchanged.

Generate and validate the artifact with:

```sh
npm run research:personality:behavior-spec:v1:generate
npm run research:personality:behavior-spec:v1
```

The generator binds the specification to the exact character-graph fingerprint and
uses the graph's reviewed timestamp. Validation reconstructs the full artifact and
rejects changed rules, missing contexts, stale graph bindings, or decision drift.

This artifact is reviewed but non-activating. It makes no provider request and does
not authorize a runtime change, push, release, deployment, or voice implementation.
