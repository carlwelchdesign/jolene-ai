# V3 selection-ledger boundary — closed without ledgers

Sampling plan v3 was frozen in commit `c8348fc` and failed closed before any source ledger was
written. S09 had five eligible target-speaker units under its frozen segmentation rule, fewer
than both its six-turn systematic allocation and eight-turn total allocation. The immutable
failure is recorded in `research/sampling-plan-v3-outcome.yaml`.

This directory must remain ledger-free. A later prospective plan version must use its own
versioned directory after a metadata-only allocation-capacity audit.

Had v3 passed its preselection gate, every source ledger would have used schema
`jolene.personality-source-selection-ledger.v3` and bind:

- sampling plan fingerprint
  `sha256:94b07d436aa053801e8ea1de484035635bb9d19bb10c78d4ace5531dd21c5c3f`;
- source register fingerprint
  `sha256:b17ed2346343313d1940071177573c95a7ecaf5bcc273e1da09b3592639d1db1`;
- the exact source/event allocation and segmentation rule in `sampling-plan-v3.yaml`.

Ledger files retain IDs, ordinals, controlled tags/reasons, stable locators, segment SHA-256
fingerprints, and reviewer metadata only. Source text, excerpts, lyrics, transcripts, audio,
and video are prohibited. No v3 observation may be coded and no v3 cross-review manifest may
be created.
