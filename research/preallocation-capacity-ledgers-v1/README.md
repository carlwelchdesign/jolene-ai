# Preallocation capacity ledgers v1

This directory is reserved for complete-boundary, metadata-only capacity ledgers created after
source-register v3 and boundary protocol v1 are frozen. No sampling allocation exists yet.

Each accepted source ledger must bind:

- source-register v3 fingerprint
  `sha256:29dcfbe68ffc7b7be13758be298739179146dab5041ff73ee9e49fc74218481f`;
- boundary protocol fingerprint
  `sha256:7ef6eba7a8eee9fde9be225f4e4b3dc7045a5165974091e008e41a592330bda7`;
- high-risk taxonomy fingerprint
  `sha256:e56f2bd612a511a18eb9c1b47fc51b51715cdf1ed0e6bd6209f700c72351ee07`;
- the exact source/event/content fingerprint and prospective segmentation rule.

Two independent reviewers must reproduce every source boundary. Eligible units retain only
IDs, ordinals, stable generic locators, segment SHA-256 fingerprints, and controlled high-risk
labels. Excluded ranges retain controlled reasons and combined segment fingerprints. Source
text, excerpts, transcripts, lyrics, audio, video, and recognizable expression are prohibited.

Disputed high-risk labels are omitted from consensus capacity; disputed eligibility or
exclusion fails the source ledger. No v4 allocation, selection, observation coding, trait
admission, owner decision, prompting, voice behavior, or runtime activation may occur until
all ten source ledgers and their aggregate manifest pass independent review.

PDF generation is currently fail-closed before ledger creation. The metadata-only
`pdf-cue-adjudication-audit-v1.yaml` reproduces S04's exact bytes and 101-unit boundary, but
shows that four literal readings of the frozen cue rules yield 40, 44, 45, or 49 eligible
target blocks rather than the frozen 48. No exception was invented to force the count. A
prospective cue-adjudication amendment now passes two independent full-boundary reviews. It
excludes all four performance-bearing target blocks before any residual-payload evaluation,
then strips nonverbal and unreadable cues from the remaining blocks. The reviewed S04 capacity
is 45, not 48 or 49. The versioned amendment and its 101-unit metadata-only manifest must bind
every future S04 ledger; the failed v3 plan and predecessor audit remain immutable.

The four PDF ledgers are now frozen under the reviewed amendment and canonical fingerprint
conversion:

- S04: 101 boundary units, 45 eligible, 56 excluded;
- S08: 199 boundary units, 88 eligible, 111 excluded;
- S09: 11 boundary units, 5 eligible, 6 excluded;
- S18: 19 boundary units, 2 eligible, 17 excluded.

Each ledger binds both the reviewed boundary-manifest fingerprint and a separately reviewed
map to the frozen normalized, length-prefixed, ordered-segment ledger fingerprint. Both
reviewers reproduced all 330 mappings with zero discrepancies. High-risk labels retain each
reviewer's metadata-only judgment and admit only exact tag intersections. Nine units with
reviewer ambiguity or cross-run instability are explicitly marked `uncertainty-withheld`; no
uncertain tag is admitted to consensus. The review-evidence artifact binds the two external
metadata-only review-report fingerprints without storing source content.

Regenerating these ledgers requires explicit paths to the two independently produced review
reports:

```sh
JOLENE_PRIMARY_PDF_REVIEW=/secure/path/primary.json \
JOLENE_INDEPENDENT_PDF_REVIEW=/secure/path/independent.json \
npx tsx scripts/generate-personality-pdf-capacity-ledgers.ts
```

These ledgers do not select turns, code observations, admit traits, or activate runtime
behavior. The remaining six source ledgers and aggregate manifest must still be completed
before a prospective v4 sampling plan can be frozen.
