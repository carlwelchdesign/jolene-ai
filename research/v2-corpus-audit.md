# Personality corpus v2 audit and delivery split

**Audit date:** 2026-08-27

**Runtime status:** contract only; not approved or activated

**Prior artifact:** the 25-observation v1 pilot remains unchanged

## Why the pilot cannot simply be enlarged

Two independent research passes found that the v1 artifact is rights-conscious but its
validator can still certify weak research. Its 25 observations use 25 different free-form
trait labels, and its free-form professional tags produce 60 apparent contexts. Five coded
source events are all interview or question-and-answer variants, one source supplies 28% of
the rows, and the earlier review statuses do not retain raw assignments, reviewer identities,
or reconciliation deltas.

Adding rows under that contract would increase a count without establishing recurrence,
editorial diversity, independent agreement, or comparable atomic turns. The v1 pilot is
therefore preserved as historical research evidence. It is not migrated in place.

## Primary-source access audit

The source-coverage reviewer found 14 defensible, paraphrase-only candidate turns for later
coding, but they are not admitted by this ticket:

| Source | Current verified boundary | Candidate count | v2 disposition |
|---|---|---:|---|
| [S02 Fresh Air Archive](https://freshairarchive.org/segments/dolly-parton-fresh-air-interview) | Publisher transcript of a rebroadcast that identifies the interview as recorded in 2001 | 5 | Normalize the event/rebroadcast provenance before sampling. |
| [S05 WFAE/NPR](https://www.wfae.org/2009-02-18/dolly-parton-on-faith-politics-and-hard-times) | Publisher-hosted NPR transcript | 5 | Coding-ready after source normalization and sampling freeze. |
| [S07 WPRL/NPR](https://www.wprl.org/npr-music/2012-11-27/after-decades-of-dreaming-dolly-parton-says-dream-more) | Edited interview highlights, not a full transcript | 4 | Treat as edited highlights; do not imply complete-turn coverage. |
| S15 official-site statement | The registered URL currently redirects and is not reproducibly reviewable | 0 | Leave uncoded until a stable first-party copy is available. |

No lyrics, copied transcript passages, signature quotes, audio, or fabricated locators were
retained. Candidate notes remain research leads, not corpus observations or personality rules.

## Frozen v2 gates

The machine-readable contract is `research/coding-schema-v2.yaml`. The validator requires:

- 100–150 eligible atomic speaker turns;
- at least 10 distinct source events, eight publisher families, eight setting families,
  eight controlled research contexts, and all four time bands;
- at least five turns from two source events per required context;
- no source above 15%, publisher family above 20%, or time band above 40%;
- coding-ready primary-source provenance, exact normalized locators, unique fingerprints,
  source/turn consistency, and duplicate/overlap rejection;
- at least 25% independent review, including two turns per source and context and every
  sensitive or low-confidence turn;
- separate reviewer identities and tool/model versions, raw categorical coding,
  timestamps, reconciliation disposition, adjudicator, and changed fields;
- at least 80% raw categorical agreement and trait-family Cohen kappa of 0.60;
- six fully reviewed supporting turns across three source events, three settings, and two
  time bands before any trait may be considered for admission;
- explicit counterexample search, rights review, anti-caricature review, an original
  designed rule, and Carl's separate owner decision.

The contract prohibits excerpts, lyrics, transcript/audio/video storage, recognizable
expression, biography or belief transfer, dialect imitation, default intimacy, voice
imitation, and runtime activation.

## Delivery sequence

1. `JOL-PER-005A` — v2 contract and validator gates.
2. `JOL-PER-005B` — normalized source provenance and editorial lineage.
3. `JOL-PER-005C` — precommitted sampling and 100–150-turn coding.
4. `JOL-PER-005D` — stratified independent review and reconciliation.
5. `JOL-PER-005E` — rights, contradiction, anti-caricature, and trait-admission audit.

None of these tickets activates the renderer, model, Slack adapter, public delegate, or voice.

## JOL-PER-005B normalized source checkpoint

The machine-readable `research/source-events-v2.yaml` register now maps every v1 source
exactly once into a stable event identity, conservative editorial family, program and
distribution host, event date/time band, controlled setting, medium, content provenance,
access state, retrieval result, content boundary, editorial treatment, delivery structure,
promotional purpose, rights basis, and fingerprint metadata.

Current validated inventory:

| Measure | Coding-ready | V2 minimum | Gap |
|---|---:|---:|---:|
| Source events | 9 | 10 | 1 |
| Publisher families | 6 | 8 | 2 |
| Setting families | 6 | 8 | 2 |
| Time bands | 3 | 4 | 1 |

Editorial lineage is conservative:

- Fresh Air, NPR Tell Me More via WFAE, and NPR highlights via WPRL count as one NPR
  publisher family, while remaining separate events/programs.
- The two Library of Congress sources count as one publisher family.
- Rebroadcasts and archive-page publication dates do not create new source events.

Eight transcript or transcript-like boundaries and the Library of Congress timed-caption
boundary are coding-ready. The [1977 ABC News video](https://abcnews.com/video/66760052/)
remains metadata-only because it has no stable transcript or reviewed timestamp map. The
[2018 Library of Congress interview](https://www.loc.gov/item/2021690731/) is coding-ready
through the official timed captions exposed by the catalog record, with its date corrected
to February 28, 2018. The S15 official-site statement remains unavailable because its exact
article URL redirects to the homepage.

The register stores SHA-256 values only, never source text, transcripts, lyrics, audio, or
video. Retrieved HTML hashes record the exact response bytes observed during normalization.
They are historical retrieval fingerprints, not live freshness checks; canonical retrieval
and comparison semantics must be added before validation can detect source drift. No v2 turns
have been sampled or coded.
