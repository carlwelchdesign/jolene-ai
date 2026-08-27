# Personality preallocation boundary drafts v1

These six YAML files are machine-generated structural drafts for the coding-ready HTML
sources in source-register v3. They contain only generic locators, hashes, and controlled
eligibility or exclusion labels. They do not contain transcript text, excerpts, quotes,
lyrics, or other source content.

These files are not capacity ledgers. Their status is
`machine-generated-awaiting-dual-review-and-tags`; every file explicitly records that
semantic review, independent review, and selection have not occurred. They cannot satisfy
the independently reviewed capacity-ledger schema and cannot authorize allocation,
observation coding, personality activation, or public use.

Regenerate the complete HTML set with:

```sh
npm run research:personality:boundary-drafts:html
```

Generation re-fetches each registered same-origin content boundary, verifies it against the
registered content fingerprint, applies the source-specific structural rule, checks complete
non-overlapping coverage, and fails closed if the precommitted capacity counts change. All six
drafts are validated before any output file is written.

Expected structural capacities:

| Source | Boundary units | Structurally eligible units |
| --- | ---: | ---: |
| S02 | 257 | 43 |
| S03 | 543 | 270 |
| S05 | 72 | 29 |
| S13 | 61 | 23 |
| S19 | 118 | 58 |
| S20 | 25 | 25 |

Next gate: two genuinely independent reviewers must reproduce each boundary, agree on final
eligibility and exclusion reasons, and independently apply the frozen high-risk taxonomy.
Only their consensus may be frozen into a preallocation capacity ledger.
