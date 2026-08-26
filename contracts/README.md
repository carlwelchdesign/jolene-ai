# Public career evidence contract

This directory defines the offline handoff between private Jolene and the
isolated portfolio delegate. A separate loopback-only reference process may
serve the validated manifest for contract testing; this does not authorize a
public endpoint or deployment.

- `public-career-evidence-v1.schema.json` is the machine-readable artifact
  schema.
- `fixtures/public-career-evidence-empty.json` proves that zero public-approved
  claims produce a valid, deterministic corpus.

The embedded manifest matches the portfolio v1 fixture contract:
`schemaVersion`, `corpusVersion`, `corpusHash`, `generatedAt`, `reviewedAt`,
`evidenceCount`, and `revokedEvidenceIds`. Each evidence record contains one
contract-shaped claim and citation.

The exporter assigns `limited` evidence strength until the private registry has
an explicit human-reviewed strength field. It never infers `strong` or
`moderate` from source type or project maturity.

Generated artifacts belong under the ignored `.jolene/exports` directory.
Before replacement, the exporter validates the prior artifact and carries any
previously exported but now-ineligible IDs into `revokedEvidenceIds`. An
invalid prior artifact blocks replacement instead of resetting that history.
Publishing, copying outside the configured local boundary, or serving an
artifact beyond the loopback reference process remains a separate Carl
approval gate even when its evidence count is zero.
