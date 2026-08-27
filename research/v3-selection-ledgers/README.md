# V3 selection-ledger boundary

This directory is reserved for complete-boundary, metadata-only ledgers created after sampling
plan v3 was frozen in commit `c8348fc`.

Every source ledger must use schema
`jolene.personality-source-selection-ledger.v3` and bind:

- sampling plan fingerprint
  `sha256:94b07d436aa053801e8ea1de484035635bb9d19bb10c78d4ace5531dd21c5c3f`;
- source register fingerprint
  `sha256:b17ed2346343313d1940071177573c95a7ecaf5bcc273e1da09b3592639d1db1`;
- the exact source/event allocation and segmentation rule in `sampling-plan-v3.yaml`.

Ledger files retain IDs, ordinals, controlled tags/reasons, stable locators, segment SHA-256
fingerprints, and reviewer metadata only. Source text, excerpts, lyrics, transcripts, audio,
and video are prohibited. A ledger is not accepted until a separate reviewer confirms its
complete boundary count and ordered unit fingerprints. No observation may be coded until all
11 ledgers and the cross-review manifest are frozen.
