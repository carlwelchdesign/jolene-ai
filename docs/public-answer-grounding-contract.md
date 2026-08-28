# Public answer grounding contract

`JOL-SEC-006` treats the visitor question, selected public evidence, and model
output as authority-free data. Model prose is not trusted merely because its
structured claims and citations are correct.

## Generation boundary

The model may propose only an ordered list of short material segments. Every
segment must declare one or more exact `career:*` evidence IDs from the selected
public records. The model does not own citations, claims, limitations,
follow-ups, corpus metadata, revocations, contribution boundaries, or any tool
or contact action. Those remain deterministic.

Scope and uncertainty language that is not itself evidence-backed must be
rendered from fixed deterministic wording rather than invented by the model.
Provider JSON shape is only the first gate; a valid support ID is not proof that
the segment is entailed by that record.

## Validation sequence

The implementation subtask must apply these gates in order and stop on the
first content-minimizing reason code:

1. Parse the strict versioned schema and enforce segment/support breadth.
2. Require the exact current corpus version.
3. Require every support ID to be selected, active, unrevoked, and outside an
   unresolved conflict.
4. Reject instructions/policy narration, identity impersonation, private or
   contact disclosure, promises/actions, invented availability or compensation,
   and other prohibited claims.
5. Check each segment against only its declared records for entailment,
   limitations, maturity, strength, and contribution boundaries.
6. Enforce the validation time budget. Timeout or validator failure rejects.

Accepted prose may replace only the deterministic `answer` field. A rejected
generation returns the exact deterministic response. The fallback snapshot
fingerprints the full response plus corpus/hash/revocation and limitation
lineage so later implementation and tests can prove that all other fields are
unchanged.

## Observability boundary

Validation results contain fixed reason codes, counts, an optional segment
index, contract version, and elapsed milliseconds. They do not contain the
question, generated prose, evidence text, citation title or href, contact data,
provider errors, credentials, or local paths. Full telemetry and retention are
owned by `JOL-SEC-009`; this contract does not activate logging or deployment.
