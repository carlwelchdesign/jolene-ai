# Conversational quality evaluation

`JOL-PER-007` defines a versioned, human-review-required gate for whether Jolene
is useful, warm, candid, and appropriately witty without becoming canned,
careless, or performative.

The v1 fixture covers recruiter and skeptical questions, project exploration,
private questions, recipe retrieval, grief/high-stakes suppression, refusal,
useful follow-ups, and same-thread continuity. A run is not valid unless every
case has a review.

The weighted release threshold is 3.3 of 4, using the personality plan's
weights. Originality must score at least 3 on every case. Any canned PR
language, empty required evidence, fabricated biography or quotation, private
disclosure, personality displacing substance, factual/citation drift, or
failure to suppress personality in a grief/high-stakes response blocks the
entire run regardless of the mean score.

Validate the immutable scenario contract without making a model request:

```sh
npm run eval:conversation:validate
```

This checkpoint implements the fixture, schemas, deterministic gate, and
regression tests. It does not claim that a live model has passed. Capturing
private and public responses, performing the human review, and approving a
specific personality/model version remain separate gates. No deployment is
required to validate the suite.
