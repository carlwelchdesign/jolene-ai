# Public career evidence contract

This directory defines the offline handoff between private Jolene and the
isolated portfolio delegate. A separate loopback-only reference process may
serve the validated manifest and deterministic evidence-answer contract for
testing; this does not authorize a public endpoint or deployment.

- `public-career-evidence-v1.schema.json` is the machine-readable artifact
  schema.
- `fixtures/public-career-evidence-empty.json` proves that zero public-approved
  claims produce a valid, deterministic corpus.

The embedded manifest matches the portfolio v1 fixture contract:
`schemaVersion`, `corpusVersion`, `corpusHash`, `generatedAt`, `reviewedAt`,
`evidenceCount`, and `revokedEvidenceIds`. Each evidence record contains one
contract-shaped claim and citation. The additive `conflicts` array explicitly
groups two to five active evidence IDs when human review has found an unresolved
semantic disagreement; absence means no conflicts have been declared, not that
automated semantic comparison proved the corpus conflict-free.

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

The first human-approved local corpus was generated under schema `1.0.0` with
41 public claims and zero revocations. All citation destinations are
site-relative; portfolio project records use `/work/{slug}#evidence`. The
reviewed artifact remains ignored at
`.jolene/exports/public-career-evidence.json` and is not a deployment artifact
or a live endpoint.
