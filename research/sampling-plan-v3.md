# Personality v3 prospective sampling plan

**Status:** failed before any v3 selection ledger or observation coding

**Runtime status:** prohibited

**Machine-readable plan:** `research/sampling-plan-v3.yaml`

**Machine-readable outcome:** `research/sampling-plan-v3-outcome.yaml`

Under the frozen `pdf-speaker-label-blocks-v1` rule, S09 contains five eligible
target-speaker blocks, but this plan allocated eight. The outcome record binds that failure to
the immutable plan and register fingerprints. This plan cannot drive selection, coding, trait
admission, or runtime behavior. A capacity audit and new prospective plan version are required;
the v3 allocation must not be edited or backfilled.

This plan replaces, but does not rewrite, the failed v2 plan. It is bound to repaired source
register fingerprint
`sha256:b17ed2346343313d1940071177573c95a7ecaf5bcc273e1da09b3592639d1db1`.
Any register, coding-ready status, allocation, method, or fingerprint change makes v3 stale and
requires another prospective plan version. No outcome-dependent replacement is allowed.

## Fixed allocation

The target remains 120 atomic target-speaker turns: 96 systematic and 24 purposive high risk.
S10 is absent because its captions cannot support explicit attribution. S18 contributes both
of its two attributable statement blocks to systematic coverage and no high-risk quota; this
avoids forcing a sensitive tag onto a statement merely to satisfy allocation arithmetic.

| Source | Total | Systematic | High risk |
|---|---:|---:|---:|
| S02 | 8 | 6 | 2 |
| S03 | 12 | 10 | 2 |
| S04 | 14 | 12 | 2 |
| S05 | 8 | 6 | 2 |
| S07 | 8 | 6 | 2 |
| S08 | 12 | 10 | 2 |
| S09 | 8 | 6 | 2 |
| S13 | 12 | 10 | 2 |
| S16 | 18 | 12 | 6 |
| S17 | 18 | 16 | 2 |
| S18 | 2 | 2 | 0 |

No source exceeds 15%, no publisher family exceeds 20%, and no time band exceeds 40%. The
allocation covers 11 source events, nine publisher families, eight setting families, and all
four time bands.

## Eligibility ledger

Every source boundary must be walked completely in publisher order. Each source unit appears
exactly once as eligible or in an exclusion range. Eligible records contain only IDs, ordinals,
locators, controlled high-risk tags, reviewer metadata, and a SHA-256 segment fingerprint.
Excluded records use one frozen reason. No excerpts, transcript text, lyrics, audio, or video
are retained.

The operational rules are:

| Rule | Sources | Atomic boundary |
|---|---|---|
| `paragraph-speaker-blocks-v1` | S02, S05, S07, S13, S16 | Walk publisher paragraphs in order. A paragraph containing exactly one explicit speaker block is one unit. Multi-speaker or interrupted paragraphs remain one excluded `not-atomic` unit. |
| `cnn-speaker-label-blocks-v1` | S03 | Walk canonical CNN body lines. A speaker label starts a unit; unlabeled continuations attach through the next label. Material before the first label is excluded. |
| `pdf-speaker-label-blocks-v1` | S04, S08, S09 | Extract in page order. A printed speaker label starts one unit; following lines attach through the next label. Page furniture and non-dialogue matter are excluded. |
| `indexed-caption-speaker-blocks-v1` | S17 | Walk publisher-indexed captions. An explicit prompt or speaker transition starts a unit; unambiguous same-speaker captions join through the next transition. |
| `pdf-attributed-statement-blocks-v1` | S18 | Walk extracted paragraphs in page and reading order. A quoted block is eligible only when introduced by the target speaker's printed full name or when the immediately following quoted block uses an explicit grammatical continuation referring to that same named speaker before any intervening speaker. All other paragraphs are excluded. |

Ambiguous attribution, lyrics or performance, interviewer/other-speaker material, promotional
furniture, non-verbal content, fragments, duplicates, non-atomic units, and unreviewable
boundaries are excluded rather than inferred. A source that cannot supply its quota fails the
plan; no other source is silently substituted.

## Selection and coding gates

SAM-001 selects midpoint ordinals
`floor((i + 0.5) * N / K)` for each source's eligible universe. SAM-002 then walks the frozen
high-risk priority list and takes the earliest remaining publisher-order match per stratum,
repeating until the source quota is full. A stalled cycle fails closed. Tags are completed
before selection and do not imply trait admission.

The complete metadata-only ledgers and their boundary counts/fingerprints require independent
review before selection. Selected IDs then become immutable. Coding must include alternative
interpretations and the required negative/counterexample minimums. Trait reconciliation,
personality admission, owner approval, model prompting, Slack behavior, voice behavior, and
runtime activation remain outside this plan and prohibited.
