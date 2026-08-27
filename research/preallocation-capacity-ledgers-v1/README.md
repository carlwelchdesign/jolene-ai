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
prospective cue-adjudication amendment requires two independent full-boundary reviews before
any PDF draft or capacity ledger can be accepted.
