# Public delegate offline evaluation

`JOL-CAREER-006A` adds the first repeatable release-gate baseline for Jolene's
isolated public delegate. It evaluates domain and provider-boundary behavior
offline. It does not call OpenAI, bind a public host, inspect the private vault,
or authorize portfolio integration or launch.

Run the human-readable command:

```bash
npm run eval:public
```

For machine-readable JSON without npm's command banner:

```bash
npm run --silent eval:public
```

The command exits with `0` when all blocker thresholds pass, `1` when a valid
suite misses a blocker threshold, and `2` when the fixture is missing or
invalid. The canonical fixture is
`evaluations/public-delegate-v1.json`. An alternate fixture path may be passed
after `--` for a controlled failure or candidate comparison.

## Precommitted gates

The fixture versions both cases and thresholds. Every current metric is a
blocker with a required pass rate of 10,000 basis points (100%):

- contract validity;
- evidence selection;
- citation resolution;
- limitation preservation;
- maturity preservation;
- no-evidence precision;
- conservative job-fit classification;
- grounding invariance outside answer prose;
- provider-input minimization;
- exact deterministic fallback reliability; and
- response-disclosure safety.

A metric with no fixture coverage fails its gate instead of passing vacuously.
Thresholds are inputs to the run, not values selected after seeing results.
Changing a threshold, fixture, or expected result changes the suite hash and
requires review.

## Fixture coverage

The v1 baseline contains 12 cases covering supported React and aviation
answers, unknown Kubernetes evidence, an adversarial public-only answer,
direct/adjacent/unknown job-fit behavior, job-description injection refusal,
safe grounded synthesis, no-evidence provider bypass, provider-error fallback,
empty and oversized output fallback, and unsafe generated-output detection.

The model-path cases use an injected deterministic fake. They prove adapter
invariants without spending tokens or depending on provider availability. The
unsafe case uses a synthetic private-path marker and passes only when the shared
egress policy recognizes that the response must be blocked.

## Report privacy

Reports contain only the suite version and hash, aggregate counts, metric IDs
and rates, stable case IDs, pass/fail states, and fixed reason codes. They never
contain questions, job descriptions, evidence text, generated prose, session
tokens, citation links, private markers, or provider errors. This makes the
report suitable for CI artifacts and ticket evidence without turning it into a
content log.

## Current baseline

The first committed run passes 12 of 12 cases across 11 of 11 covered metrics.
Its suite hash is
`56d0c1015c8e8c33da4a1155eee7de5bd01f626be3b307e4f021ced163536573`.
That result proves only this offline backend baseline.

## Remaining release gates

`JOL-CAREER-006` remains open. Separate evidence is still required for stale,
revoked, superseded, and conflicting source lifecycle behavior; representative
live-model quality, latency, token, and cost measurements; broader abuse and
impersonation cases; portfolio citation navigation and accessible highlighting;
production admission and observability; and Carl's review of representative
outputs. Passing this command never authorizes public launch.
