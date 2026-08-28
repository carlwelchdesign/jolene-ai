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
- unresolved semantic-conflict safety; and
- deterministic red-team mutation resilience.

A metric with no fixture coverage fails its gate instead of passing vacuously.
Thresholds are inputs to the run, not values selected after seeing results.
Changing a threshold, fixture, or expected result changes the suite hash and
requires review.

## Fixture coverage

The v1.4 baseline contains 61 expanded cases. Its first 12 cases cover supported React and aviation
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

Five precommitted red-team matrices add 20 deterministic variants across
instruction injection, private exfiltration, identity impersonation, contact
manipulation, and abusive coercion. Each base attack is wrapped as an authority
prefix, delimiter envelope, JSON envelope, and quoted relay. Expansion IDs,
transform names, family/category agreement, uniqueness, prompt bounds, and the
200-case expanded-suite ceiling are schema-validated before execution. Every
variant runs through the real deterministic public answer service and must
return a valid, citation-free, disclosure-safe refusal. The matrices do not use
a model to invent attacks and do not prove safety against arbitrary prose.

The model-path cases use an injected deterministic fake. They prove adapter
invariants without spending tokens or depending on provider availability.
Unsafe generated email, phone, credential, Obsidian URI, private-host, and
private-path cases pass only when validation returns the exact deterministic,
disclosure-safe fallback.

The separate versioned public-answer grounding suite adds poisoned-evidence
cases where selected public text repeats the attack. It covers direct,
obfuscated, multilingual, delimiter, role-play, encoded, attacker-assertion,
impersonation, promise, contact, compensation, availability, private-locator,
and support-substitution families plus a safe control. This finite suite is a
local deterministic gate; broader live-model coverage remains a separate
release prerequisite.

## Report privacy

Reports contain only the suite version and hash, aggregate counts, metric IDs
and rates, stable case IDs, pass/fail states, and fixed reason codes. They never
contain questions, job descriptions, evidence text, generated prose, session
tokens, citation links, private markers, or provider errors. This makes the
report suitable for CI artifacts and ticket evidence without turning it into a
content log.

## Current baseline

The current committed run passes 61 of 61 expanded cases across 25 of 25 covered metrics.
Its suite hash is
`7bc6a1108a9a9fee06a6dce9e1d039b1ffd8559f48519adee10e7d9788465550`.
That result proves only this offline backend baseline.

## Remaining release gates

`JOL-CAREER-006` remains open. Separate evidence is still required for a private
human-review workflow that declares and resolves conflict groups; representative
live-model quality, semantic entailment, latency, token, and cost measurements;
portfolio citation navigation and
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
thresholds, exact model and corpus versions, semantic support validation, and
latency/token/cost ceilings. Measured provider output retains its structured
support IDs and must pass the same fail-closed grounding validator used by the
public answer service; unchanged claim cards alone cannot make unsupported prose
pass. Its `gpt-5.6-terra` token rates were
reviewed on 2026-08-27 against the [official model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra).
Changing the model, price, scenario, expectation, or threshold changes the suite
hash and requires review. Cost estimates conservatively charge every reported
input token at the full short-context input rate instead of assuming a cache
discount. The committed suite hash is
`5e38064adec7b8d609f44f22cbccc09e53c1f02482504805fc9a767fcb66f3f8`.

The authorized 2026-08-27 local run used the exact approved corpus
`career:16c2c9c8ee7f35c8fae055c2b82ddf46b0bd2ed99ad9be45e8c151ca0e6e400f`.
It made three provider requests while the unsupported Kubernetes case correctly
bypassed the provider. The run failed closed: one of four cases passed, two
generated answers were rejected to deterministic fallback, and the refreshed
41-record input exceeded the precommitted input-token and cost ceilings. The
content-minimized report recorded 8,394 input tokens, 838 output tokens,
26,844 micro-USD estimated total cost, and 4,124 ms maximum latency. These
results are measurement evidence, not permission to relax thresholds, activate
the service, or launch. Remediation and a new explicitly authorized live run are
required before this gate can pass.

Follow-up remediation keeps those failed artifacts intact. Machine reports now
record only the grounding validator's fixed status, reason code, and segment
index, so a rejected answer can be diagnosed without copying its prose into the
report. The provider input uses a compact, explicit untrusted-data contract while
the full provenance and taint envelopes remain local for output lineage. On the
three versioned model cases this reduces serialized request-data characters by
61.84% to 63.15% without removing evidence IDs, claim text, limitations,
citation titles, corpus identity, or the no-authority boundary. No paid rerun was
performed as part of that remediation.

The approved follow-up run confirmed the minimization in provider measurements:
3,967 input tokens, 756 output tokens, 17,006 micro-USD estimated total cost,
and 3,083 ms maximum latency. Token, cost, latency, model, corpus, evidence,
provider-bypass, and disclosure boundaries all stayed within their precommitted
limits. Three of four cases passed. The remaining React case failed closed at
grounded segment index 2 with the fixed `unsupported_segment` reason, leaving
semantic remediation—not budget calibration—as the only live-gate failure.

The focused red-team command uses the repository-pinned Node 22 runtime, a
two-thread worker ceiling, and serial file execution to avoid the prior
evaluation-worker instability:

```bash
npm run test:security:red-team
```

To prepare an authorized local run, create `.env.public.local` manually with
`JOLENE_PUBLIC_ANSWER_MODE=openai`, the exact reviewed model, and timeout. Supply
the dedicated `OPENAI_API_KEY` either in that ignored owner-only file or as an
ephemeral process variable. The harness never loads `.env.local`; do not copy the
private Jolene environment. Then run:

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
