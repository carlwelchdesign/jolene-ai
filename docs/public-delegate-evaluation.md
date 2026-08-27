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
- response-disclosure safety;
- public-evidence eligibility;
- review freshness;
- former-public revocation continuity;
- supersession safety; and
- confidentiality exclusion;
- red-team refusal;
- unsafe generated-egress blocking;
- contact-input validation;
- contact-consent enforcement;
- likely-secret contact rejection;
- contact-staging minimization; and
- instruction-like contact staging as untrusted data; and
- unresolved semantic-conflict safety.

A metric with no fixture coverage fails its gate instead of passing vacuously.
Thresholds are inputs to the run, not values selected after seeing results.
Changing a threshold, fixture, or expected result changes the suite hash and
requires review.

## Fixture coverage

The v1.3 baseline contains 41 cases. Its first 12 cases cover supported React and aviation
answers, unknown Kubernetes evidence, an adversarial public-only answer,
direct/adjacent/unknown job-fit behavior, job-description injection refusal,
safe grounded synthesis, no-evidence provider bypass, provider-error fallback,
empty and oversized output fallback, and unsafe generated-output detection.

Nine lifecycle cases run through the real SQLite career-evidence store and
public exporter. They cover private, internal-approved, and public-candidate
exclusion; stale review expiry; claim and source revocation; missing sources;
changed-source review reset; supersession; and deterministic revocation
continuity for every formerly public evidence ID.

Seventeen red-team and contact cases cover unsupported impersonation,
compensation/contact, abusive, and system-exfiltration requests; generated
email, phone, credential, Obsidian URI, private-host, and private-path output;
and the real contact schema/file queue. Contact cases verify minimized valid
staging, instruction-like text remaining inert data, literal consent, invalid
email and extra-field rejection, message bounds, likely-secret rejection, and
generic non-echoing receipts.

Three semantic-conflict cases use explicit unresolved groups of active evidence
IDs, never inferred text similarity. They verify deterministic answer refusal,
provider bypass for grounded answers, and unknown job-fit treatment with no
conflicted citations. Other eligible evidence remains available.

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

The current committed run passes 41 of 41 cases across 24 of 24 covered metrics.
Its suite hash is
`4828d381bd05d5a49c60a1e6169e2967fd365f58946a6295ada0d61622ca03ed`.
That result proves only this offline backend baseline.

## Remaining release gates

`JOL-CAREER-006` remains open. Separate evidence is still required for a private
human-review workflow that declares and resolves conflict groups; representative
live-model quality, semantic entailment, latency, token, and cost measurements;
additional adaptive red-team coverage; portfolio citation navigation and
accessible highlighting; production admission and observability; and Carl's
review of representative outputs. Passing this command never authorizes public
launch.

## Explicit live-model measurement

`JOL-CAREER-006G` adds a separate live-provider harness. It is inert unless the
operator supplies `--live`; it refuses to load `.env.local` and reads only a
separately created `.env.public.local`. The configured model must exactly match
the reviewed fixture. Ordinary `npm test` and `npm run eval:public` remain fully
offline.

The committed `evaluations/public-live-model-v1.json` fixture precommits four
public-only cases, the expected deterministic evidence selection, 100% blocking
thresholds, and latency/token/cost ceilings. Its `gpt-5.6-terra` token rates were
reviewed on 2026-08-26 against the [official OpenAI API pricing](https://platform.openai.com/pricing).
Changing the model, price, scenario, expectation, or threshold changes the suite
hash and requires review. Cost estimates conservatively charge every reported
input token at the full short-context input rate instead of assuming a cache
discount. The committed suite hash is
`8215efe8e294018fbfc008d0fac67dfe54d9cec387dfc41a9bb83e370b83fd0b`.

To prepare an authorized local run, create `.env.public.local` manually with
`JOLENE_PUBLIC_ANSWER_MODE=openai`, the exact reviewed model, timeout, and a
dedicated `OPENAI_API_KEY`. Do not copy the private Jolene environment. Then run:

```bash
npm run eval:public:live -- --live
```

The command exits with `0` only when every blocking threshold passes, `1` for a
valid failing run, and `2` when opt-in, configuration, or fixture validation
fails. Standard output contains only stable case IDs, fixed reason codes,
aggregate timing/token/cost values, and gates. It excludes questions, evidence,
citations, model prose, and provider errors.

Representative questions, exact public grounding, and outputs are written to
the ignored owner-permission file
`.jolene/evaluations/public-live-model-review.json`. A passing machine report is
therefore still incomplete until Carl reviews that packet. The harness neither
approves evidence nor enables the service, portfolio adapter, CORS, deployment,
or launch.

## Owner-only review control

`JOL-CAREER-006H` adds a local review surface at
[http://127.0.0.1:8421/public-evaluation](http://127.0.0.1:8421/public-evaluation).
It reads only the schema-validated ignored review packet and is scoped to the
exact configured private owner and workspace. Missing, malformed, and changed
packets remain visibly unavailable or stale; they never count as human review.

For every case, Carl records accuracy, grounding, usefulness, and tone as
`pass`, `needs_changes`, or `fail`, with optional bounded notes. A final
`approved` decision is valid only when every case dimension passes. The saved
decision includes the suite ID, model, exact suite hash, reviewer, and review
timestamp and is written atomically to an ignored owner-only file. If a later
run changes the suite hash, the prior decision is retained as stale history and
cannot approve the new packet.

The private Docker API receives the review-packet directory as a read-only
mount. The Slack process does not receive that mount, and the decision stays in
the private data volume. Neither packet nor decision enters public delegate
state, private SQLite, Slack, Obsidian, or audit logs.

This screen has no provider-run, send, evidence-edit, integration, deployment,
or launch control. Human approval of a representative output packet remains
only one input to `JOL-CAREER-006`; it is not publication or deployment approval.
