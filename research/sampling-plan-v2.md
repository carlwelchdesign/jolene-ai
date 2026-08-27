# Personality v2 precommitted sampling plan

**Status:** frozen before v2 observation coding

**Runtime status:** prohibited

**Machine-readable plan:** `research/sampling-plan-v2.yaml`

This plan is bound to the exact reviewed source register. If that register, any coding-ready
source, or any source fingerprint changes, the plan becomes stale and sampling stops.

## Fixed allocation

The baseline target is 120 atomic target-speaker turns: 96 systematic and 24 purposive
high-risk selections. All 11 coding-ready source events are included. No source may exceed
15%, no publisher family 20%, and no time band 40%.

| Source | Total | Systematic | High risk |
|---|---:|---:|---:|
| S02 | 8 | 6 | 2 |
| S03 | 12 | 10 | 2 |
| S04 | 12 | 10 | 2 |
| S05 | 8 | 6 | 2 |
| S07 | 8 | 6 | 2 |
| S08 | 12 | 10 | 2 |
| S09 | 8 | 6 | 2 |
| S10 | 8 | 6 | 2 |
| S13 | 12 | 10 | 2 |
| S16 | 16 | 12 | 4 |
| S17 | 16 | 14 | 2 |

The allocation yields 11 source events, eight conservative publisher families, eight setting
families, and all four time bands. NPR's three distributed events total exactly 20%; the two
Library of Congress events total 13.3%.

## Eligible universe

For each source, reviewers enumerate every publisher-order boundary unit under the frozen
segmentation rule below and retain only uninterrupted, atomic target-speaker turns with stable
locators. They record each eligible unit's source ordinal, eligible ordinal, source locator,
SHA-256 segment fingerprint, and applicable high-risk strata. They retain no source text.
Ineligible units are represented in the exclusion ledger by locator or contiguous locator
range, fingerprint, and one controlled reason:

- advertisement or promotion;
- duplicate or overlap;
- interviewer or other speaker;
- lyric or performance;
- non-verbal material;
- not atomic;
- unclear speaker attribution;
- too fragmentary;
- unreviewable boundary.

Lyrics, performances, interviewer turns, unattributed captions, and non-verbal material can
never become eligible merely to satisfy a quota. A source that cannot supply its allocation
fails the plan; another source is not silently substituted.

### Operational segmentation rules

| Rule | Sources | Atomic boundary |
|---|---|---|
| `paragraph-speaker-blocks-v1` | S02, S05, S07, S13, S16 | Walk publisher paragraphs in document order. A paragraph containing exactly one explicit speaker block is one source unit. A paragraph with multiple speaker labels or an interrupted exchange stays one source unit but is excluded as `not-atomic`; it is never split after inspection. Metadata paragraphs without a target-speaker block are excluded. |
| `cnn-speaker-label-blocks-v1` | S03 | Walk the canonical CNN body’s nonempty line units. A line beginning with a speaker label starts one source unit; unlabeled continuation lines attach through the next label. Preamble or unlabeled material before the first label is excluded. |
| `pdf-speaker-label-blocks-v1` | S04, S08, S09 | Extract text in page order. A printed speaker label starts one source unit; following lines attach through the next label. Headers, footers, and non-dialogue matter are excluded. Page breaks do not create units. |
| `vtt-speaker-cue-blocks-v1` | S10 | Walk timed cues in order. A cue with a stable explicit speaker label starts one unit; consecutive cues with the same explicit label join until another label. Unlabeled or ambiguous cues are excluded rather than attributed from context. |
| `indexed-caption-speaker-blocks-v1` | S17 | Walk publisher-indexed captions in order. An explicit prompt or speaker transition starts a unit; consecutive captions from the same unambiguous speaker join through the next transition. Ambiguous spans are excluded. |

The full source boundary must be partitioned exactly once between eligible units and exclusion
ranges. Missing or overlapping source-unit ordinals fail validation. Each source ledger binds
the plan fingerprint, register fingerprint, segmentation rule, complete boundary-unit count,
and content-minimizing eligibility/exclusion records. The ledger is committed and fingerprinted
before exact selection IDs are computed and before observation coding begins.

Segment fingerprints normalize each transient source segment to Unicode NFC, collapse
whitespace, length-prefix its UTF-8 bytes with an unsigned 64-bit big-endian length, and hash
the ordered sequence with SHA-256. A multi-line or multi-cue unit retains segment order. The
normalization occurs in memory; only the digest is written to the ledger.

### Operational high-risk tags

Tags use the exact definitions frozen in the YAML plan:

- `belief`: explicit religion, spirituality, or moral-conviction discussion;
- `biography`: personal history, family, health, relationship, or career-history account;
- `boundary`: explicit refusal, limit, condition, correction, or protected line;
- `contradiction`: explicit tension, change, counterevidence, or competing claim;
- `grief-or-hurt`: loss, injury, shame, failure, grief, or described emotional pain;
- `humor`: observable joke, wordplay, self-deprecation, comic reversal, or laughter cue;
- `identity-trait`: explicit self-description as a type of person or stable attribute;
- `politics`: policy, elected office, civic controversy, or partisan positioning;
- `voice-adjacent`: accent, singing, vocal sound, or voice-performance discussion;
- `workplace-sexual-boundary`: workplace conduct, harassment, sexualized treatment, or
  appearance boundary.

Tags are applied to the complete eligible universe before selection. Untagged units remain
eligible for SAM-001. Tags do not imply trait admission and cannot be changed after the ledger
is frozen to alter SAM-002.

## SAM-001 systematic selection

Systematic selection is blind to trait, tone, fame, quotability, positivity, and anticipated
product usefulness. For a source with `N` eligible target-speaker turns and systematic target
`K`, select the zero-based eligible ordinals:

```text
floor((i + 0.5) * N / K), for i = 0 ... K - 1
```

The validator recomputes these ordinals from the metadata-only eligible universe. Duplicated
ordinals or an eligible universe smaller than the allocation fail closed.

## SAM-002 purposive high-risk selection

After removing SAM-001 selections, walk the predeclared stratum priority in plan order. For
each stratum, select the earliest remaining publisher-order eligible unit bearing that stratum.
Repeat the priority cycle until the source quota is full. A cycle with no new match before the
quota is full fails closed. The validator recomputes this selection from the metadata-only
universe; reviewers cannot replace difficult turns with more flattering or memorable ones.

The high-risk tags are research flags, not assertions about identity. They exist to force later
review of boundaries, contradictions, hurt, humor, workplace sexual boundaries, voice-adjacent
material, identity framing, politics, belief, and biography. Every high-risk selection must be
independently reviewed in JOL-PER-005D.

## Primary coding

Selected units are coded as observations with exact source provenance, normalized locator,
segment fingerprint, controlled speech act/context/trait-family categories, seriousness pivot,
confidence, alternative interpretation, and a paraphrase written from scratch. The original
expression is not retained. At least 24 turns must reject the proposed trait inference and at
least 24 must reject direct product adaptation so the corpus cannot pass as a positive-only
collection.

Once the complete ledger is frozen, selected IDs are immutable. Research-context labels,
trait-family labels, confidence, valence, positive or negative interpretation, adaptation
decision, and later reviewer outcomes cannot cause replacement or resampling. If the immutable
sample misses a context or negative-evidence acceptance threshold, this baseline fails. A retry
requires a separately versioned prospective sampling plan and a new ledger; the failed result
remains visible.

The primary-coded baseline is not a validated final personality corpus. Independent assignments,
reconciliation, agreement and kappa thresholds belong to JOL-PER-005D. Rights, contradiction,
anti-caricature, trait admission, and Carl's owner decisions belong to later gates.

## Non-goals

This ticket does not create a personality prompt, behavior specification, character graph,
runtime setting, Slack behavior, public delegate behavior, voice, quotation library, biography,
belief system, dialect, or default form of address. It does not activate Jolene presentation.
