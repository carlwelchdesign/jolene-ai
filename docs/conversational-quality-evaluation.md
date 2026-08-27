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
entire run regardless of the mean score. A continuity answer that denies the
available prior-thread context is also a hard failure; inherited citations
cannot make that response pass.

Validate the immutable scenario contract without making a model request:

```sh
npm run eval:conversation:validate
```

This checkpoint implements the fixture, schemas, deterministic gate, capture,
and owner-only human review. Automated preflight has passed for the current
live capture, but Carl's seven-dimension scoring and explicit decision remain
separate gates. No deployment is required to review or validate the suite.

With an approved existing local API key, capture all public and private cases
into an owner-only packet using an isolated temporary SQLite database:

```sh
npm run eval:conversation:capture -- --live --include-private
```

The command never prints response bodies. It takes a consistent read-only
backup of the current private SQLite store, runs against that owner-only copy,
writes the packet with mode `0600` under `.jolene/evaluations/`, reports only
bounded counts, and deletes the temporary database. The packet can contain private retrieved
material and must not be committed, posted to Asana or Slack, or copied into
the public portfolio.

After a scoped fix, recapture one existing packet case without paying for a
full-suite rerun:

```sh
npm run eval:conversation:capture -- --live --include-private \
  --case conversation:continuity
```

Open `http://127.0.0.1:8421/conversation-evaluation` in the local control
center to inspect exact answers, citations, follow-ups, and expected behaviors.
Every case requires 0–4 scores for task success, evidence transparency, warmth
and kindness, wit and restraint, agency boundaries, situational calibration,
and originality. Carl may also mark any blocking hard failure. The decision is
written mode `0600`, bound to the packet SHA-256, and becomes stale whenever
the capture changes. This page cannot call the model, publish, deploy, contact
anyone, or activate the personality.
