# Jolene Professional Context Architecture

**Date:** 2026-08-26

**Status:** Docker API, governed career ingestion, private hybrid retrieval, durable owner-reviewed conflict registry, public export, loopback manifest/answer/job-fit/contact-staging/admission/audit/egress-disclosure boundaries, disabled-by-default grounded answer synthesis, private contact review, explicit unresolved public-evidence conflict policy, and an offline response/lifecycle/red-team/contact/conflict evaluation baseline implemented; public integration, full evaluation, and deployment pending

## Product outcome

Jolene should have comprehensive, evidence-backed knowledge of Carl's
professional career while keeping private context private. The public portfolio
delegate should help recruiters and hiring managers understand Carl's work,
compare a supplied job description against supported evidence, and identify
useful interview questions without inventing qualifications or exposing the
private Obsidian vault.

“Know everything” means **cover every reviewed professional source and preserve
its provenance**. It does not mean placing the raw vault, private memory, client
material, correspondence, or unrestricted local filesystem behind a public
chatbot.

## Current implementation truth

| Capability | Current state |
|---|---|
| OpenAI Agents SDK | Implemented |
| Read-only Obsidian access | Implemented with path allowlists and exact note/heading citations |
| Retrieval | Conversational Obsidian remains lexical; reviewed career evidence uses lexical/vector fusion with deterministic fallback |
| Embedding RAG | Implemented for private, freshly reviewed career claims; current eligible corpus is empty pending Carl's review |
| MCP | Not implemented |
| Graph database / GraphRAG | Not implemented |
| Durable private memory | Implemented through explicit proposals and approval |
| Public portfolio evidence boundary | Versioned deny-by-default export plus isolated loopback contracts and disabled-by-default grounded OpenAI answer synthesis implemented; portfolio integration and deployment remain disabled |
| Docker | Image and API container verified; Slack operational cutover and production deployment remain pending |
| Career evidence registry | Implemented with sources, claims, relationships, review freshness, visibility, revocation, and supersession |
| Portfolio candidate migration | Implemented; 26 sources, 41 active claims, and 57 relationships imported with zero public-approved claims |
| Obsidian career ingestion | Implemented for the explicit `01 Career & Job Search` allowlist; 11 notes, 81 active private claims, 106 relationships, zero public-approved claims |

## System boundary

```text
PRIVATE AUTHORING AND REVIEW

Obsidian vault + resumes + repositories + approved recommendations
                              |
                              v
                 Career ingestion and provenance
                              |
                              v
                 Human review and visibility state
                              |
                 +------------+-------------+
                 |                          |
                 v                          v
       Private career index       Versioned public evidence export
                 |                          |
                 v                          v
         Private Jolene             Portfolio Jolene delegate
     full approved context       public-approved evidence only
```

The portfolio runtime never mounts the vault, reads private Jolene memory, or
calls the private Jolene API. The only shared artifact is a versioned,
content-minimized public evidence export produced after human review.

## Docker deployment decision

The private Jolene runtime is a single image with separate API and Slack
processes:

- `jolene-api`: local HTTP API and control center;
- `jolene-slack`: Slack Socket Mode ingress and replies;
- `jolene-data`: durable SQLite volume shared by the two local processes;
- `/vault`: host Obsidian vault mounted read-only; and
- loopback-only HTTP exposure by default.

The container runs as an unprivileged user with a read-only root filesystem,
dropped Linux capabilities, disabled privilege escalation, and a bounded
temporary filesystem. Dockerization improves reproducibility; it does not make
the private service safe to expose publicly.

The bounded career corpus is indexed in the existing private SQLite database.
This avoids making a second database a correctness dependency while only 122
active imported claims exist and none is yet approved for retrieval. The index
adapter, chunk IDs, embedding contract, and ranking policy remain independent
of SQLite. Evaluate PostgreSQL and pgvector when corpus size or measured search
latency makes in-process cosine ranking miss its evaluation target; migration
must not change authorization, citation, freshness, audit, or fallback behavior.

## Professional evidence model

Every professional record should have:

- stable source and claim IDs;
- title and concise evidence text;
- source type: résumé, employer history, recommendation, project, repository,
  release artifact, portfolio page, or Carl-confirmed fact;
- provenance URI or private source reference;
- source timestamp and `lastReviewedAt`;
- Carl's role and contribution;
- project maturity and validation state;
- entities, skills, domains, employers, dates, and explicit relationships;
- visibility: `private`, `internal_approved`, `public_candidate`, or
  `public_approved`;
- reviewer and approval timestamp; and
- supersession or revocation state.

Public export is deny-by-default: only active `public_approved` records may be
included.

## RAG decision

Embedding-backed hybrid RAG is the correct next knowledge capability.

1. Parse reviewed Markdown and structured career sources.
2. Preserve headings, frontmatter, tags, wiki links, dates, and source paths.
3. Chunk by semantic section without losing source identity.
4. Store embeddings in the private retrieval index behind an adapter; the first
   implementation uses SQLite JSON vectors and bounded in-process cosine rank.
5. Combine vector similarity with lexical search and metadata filters.
6. Rerank within the authorized visibility and channel scope.
7. Return exact source IDs and evidence strength with every material claim.
8. Fail closed when provenance or visibility cannot be established.

Private and public retrieval use the same schema but separate indexes or hard
visibility partitions. A public request can never widen its retrieval scope.

## MCP decision

MCP is an interoperability boundary, not Jolene's memory system.

Add a private MCP adapter only when another trusted client—such as Codex, an
admin CMS, or a controlled internal agent—needs to invoke bounded Jolene tools.
Initial tools should be read-only, actor-scoped, audited, and small:

- search approved professional evidence;
- inspect source and freshness;
- compare a job description against evidence; and
- propose a correction or public-evidence candidate for human review.

Do not use MCP to connect the public portfolio directly to the private vault or
private Jolene runtime. Public portfolio integration should use a dedicated
public API or a versioned static evidence snapshot.

## Graph decision

Do not add a separate graph database yet.

Preserve graph-ready structure now: people, employers, roles, projects, skills,
domains, outcomes, sources, and relationships such as `worked_at`, `built`,
`used_skill`, `supports_claim`, and `supersedes`. Keep those relationships in
the governed relational evidence store until evaluation justifies a different
database.

Evaluate GraphRAG or a dedicated graph database only when multi-hop questions
cannot be answered reliably by hybrid retrieval and relational joins. Examples
include tracing a skill across employers and projects or explaining how an
earlier interactive-media capability evolved into current AI product work.

Adopt a graph database only if a fixed multi-hop evaluation set shows a
material quality or maintainability gain that justifies another operational
system.

## Portfolio Jolene contract

The public delegate may:

- answer from `public_approved` evidence;
- cite portfolio pages, résumé sections, projects, and approved recommendations;
- accept a pasted job description as untrusted comparison input;
- classify requirements as `direct`, `adjacent`, `missing`, or `unknown`;
- explain project maturity and remaining evidence gaps; and
- offer a minimized, consented contact handoff.

It may not:

- access private Obsidian notes or durable private memory;
- claim Carl is qualified when the evidence does not support that conclusion;
- invent skills, outcomes, metrics, endorsements, availability, salary,
  authorization, or willingness to relocate;
- browse unrestricted private repositories;
- schedule, negotiate, apply, email, or message anyone; or
- retain pasted job descriptions or full transcripts by default.

Every answer should contain structured claims, evidence IDs, evidence strength,
project maturity, limitations, and suggested follow-up questions.

## Delivery sequence

### JOL-DOCKER-001 — Private runtime container

- Build one reproducible Node 22 image.
- Run API and Slack as separate processes.
- Persist SQLite outside the image.
- Mount Obsidian read-only.
- Verify health, restart behavior, non-root execution, and no secret inclusion.

### JOL-CAREER-001 — Evidence schema and review lifecycle

- [x] Define source, claim, visibility, maturity, relationship, review, and
  supersession contracts.
- [x] Migrate existing portfolio evidence into reviewable records.
- [x] Add validation for missing provenance and stale review dates.

Implementation evidence:

- branch: `codex/jol-career-001-evidence-schema`;
- implementation commit: `3f57a31` (`JOL-CAREER-001 add governed career evidence`);
- SQLite migration is additive and retains existing Jolene tables;
- the canonical portfolio imported 26 sources, 41 active claims, and 57
  relationships;
- all 67 imported review findings are expected approval gates, with no public
  claims produced by import; and
- focused tests cover approval gates, public citation requirements, stale
  review, source reset, revocation, supersession, and idempotent import.

### JOL-CAREER-002 — Obsidian career ingestion

- [x] Add an explicit professional-folder allowlist.
- [x] Parse frontmatter, headings, tags, links, and dates.
- [x] Create draft records only; never auto-promote private notes to public.
- [x] Record import hashes and deletions without copying raw vault history.

Implementation evidence:

- branch: `codex/jol-career-002-obsidian-ingestion`;
- implementation commit: `dd4b984` (`JOL-CAREER-002 ingest Obsidian career evidence`);
- the bounded canonical-vault import discovered and imported 11 notes from
  `01 Career & Job Search`;
- the import produced 81 active private review-required claims and 106 explicit
  tag/wiki-link relationships with zero public-approved claims;
- current file hashes and structured metadata are retained, while Git and
  Obsidian history are not copied;
- deleted or opted-out notes become `missing`, removed sections become
  superseded, and reappearing notes require review again; and
- the existing career-source schema upgrades in place with foreign-key checks
  and a pre-migration local backup.

### JOL-CAREER-003 — Hybrid RAG

- [x] Add a replaceable career retrieval index and embedding-provider boundary.
- [x] Implement stable semantic chunks, embeddings, lexical/vector fusion,
  metadata and review filters, and exact citations.
- [x] Keep deterministic lexical fallback and content-minimizing access logs.
- [x] Recheck actor, private-channel, source state, claim state, visibility,
  review, and 180-day freshness before ranking.

Implementation notes:

- branch: `codex/jol-career-003-hybrid-retrieval`;
- implementation commit: `3c63300` (`JOL-CAREER-003 add governed hybrid retrieval`);
- private Jolene receives `search_career_evidence` only for the configured owner
  in private channels;
- synchronization deletes ineligible chunks before every search and regenerates
  embeddings only for new or changed chunk hashes;
- audit records retain query fingerprints plus chunk/source/claim IDs, never
  query text or evidence excerpts;
- vector-provider failure produces the deterministic `lexical_fallback` mode;
- the real local index currently contains zero chunks because the 122 imported
  claims still require Carl's review; and
- PostgreSQL/pgvector remains a measured scale-up option, not a current runtime
  dependency.

Verification checkpoint:

- 23 test files and 107 tests pass on Node 24.18.0;
- the production TypeScript build and dependency audit pass with zero reported
  vulnerabilities;
- the Node 22 ARM64 Docker image builds and starts healthy as a non-root,
  read-only-root runtime;
- `/health` and the bounded career retrieval audit route respond successfully
  from the container; and
- secret and runtime-image content checks found no `.env.local`, Git metadata,
  development scripts, vault content, or SQLite database baked into the image.

### JOL-CAREER-002A — Human career evidence review control

- [x] Add an owner/workspace-locked local review API over the existing evidence
  policy and SQLite store.
- [x] Add source-first source/claim decisions, validation findings, rejection,
  and confirmation-gated revocation.
- [x] Make public approval a distinct exact-claim confirmation and disable it
  without a public citation.
- [x] Add search, lifecycle filters, summaries, collapsed claim groups, loading,
  empty, error, permission, success, keyboard, and narrow-screen states.

Implementation notes:

- branch: `codex/jol-career-002a-review-control`;
- implementation commit: `35f4406` (`JOL-CAREER-002A add career evidence review control`);
- the local `/career-evidence` control displays the canonical 37 sources and
  122 active claims without exposing a vault filesystem browser;
- all review reads and writes are restricted to the configured career owner and
  workspace, reviewer attribution must match the owner, and browser mutations
  require the same local origin;
- source approval remains a prerequisite for claim approval, and the store's
  freshness, citation, revocation, supersession, missing-source, and public
  eligibility rules remain authoritative;
- the recruiter-facing confirmation changes evidence eligibility only and
  cannot publish, send, apply, or claim that an outside action occurred; and
- the screen is a loopback pilot, not an authenticated remote admin surface.

Verification checkpoint:

- 26 test files and 114 tests pass on Node 24.18.0;
- JavaScript syntax, production TypeScript build, Compose configuration, and
  dependency audit pass with zero reported production vulnerabilities;
- live API checks return 403 for a foreign career scope and cross-origin browser
  mutation, while the same-origin nonexistent-record path returns 404;
- browser verification at 1440 x 1000 and 390 x 844 covers the loaded canonical
  queue, collapsed/expanded groups, confirmation modal, and cross-page nav;
- axe reports zero confirmed WCAG A/AA violations; gradient contrast remains an
  automated incomplete requiring visual/manual judgment; and
- a fresh Docker image build remains unverified in this run because Docker
  Desktop reported that it was unable to start.

### JOL-CAREER-004 — Public evidence export

- [x] Export only active `public_approved` records.
- [x] Produce a versioned manifest, content hash, schema version, and revocation
  list.
- [x] Validate that no private path, note, memory, or contact record is present.

Implementation notes:

- branch: `codex/jol-career-004-public-export`;
- implementation commit: `1e03a08` (`JOL-CAREER-004 add governed public
  evidence export`);
- the artifact is an ignored local file, not a public API, portfolio copy, or
  deployment;
- manifest fields align with the portfolio v1 fixture contract, while the
  embedded evidence records directly provide its public claim/citation shapes;
- corpus version and SHA-256 hash are content-derived and stable across
  generation timestamps;
- removed formerly public claims remain only as stable revoked IDs;
- leak checks reject private paths and hosts, Obsidian syntax, contacts, common
  secret formats, private-only claims, and unsupported career-note sources;
- evidence strength remains conservatively `limited` until a separate reviewed
  strength field exists; and
- the canonical zero-public-claim registry produces a valid empty artifact.

Verification checkpoint:

- 27 test files and 127 tests pass on Node 24.18.0, including deterministic
  hashing, approval withdrawal, supersession, leak rejection, atomic writes,
  prior-artifact validation, and the empty-corpus case;
- production TypeScript build, Compose configuration, JSON Schema fixture
  validation, diff hygiene, and dependency audit pass with zero reported
  production vulnerabilities;
- the canonical local artifact is 407 bytes, owner-readable/writable only, and
  ignored by Git; and
- a fresh Docker image build remains covered by the existing Docker-capacity
  operations ticket because Docker Desktop cannot currently start safely on
  the full data volume.

### JOL-CAREER-005 — Portfolio delegate

- The isolated local process boundary and frozen v1 manifest route are
  implemented in `JOL-CAREER-005A`.
- Deterministic, citation-complete public evidence answers are implemented in
  `JOL-CAREER-005B`; unsupported questions fail to an explicit no-evidence
  response.
- Deterministic public job-description comparison is implemented in
  `JOL-CAREER-005C`; it emits direct, adjacent, or unknown results and never
  treats absent public evidence as proof of missing experience.
- Loopback runtime admission and a fail-closed kill switch are implemented in
  `JOL-CAREER-005D`; production-grade edge, distributed abuse, redaction, and
  cost controls remain separate gates.
- Minimized consented contact-intent staging is implemented in
  `JOL-CAREER-005E`; requests enter a dedicated owner-only, retention-bounded
  local review queue and cannot trigger outbound action.
- Private contact review is implemented in `JOL-CAREER-005F`; the exact owner
  scope can list, mark reviewed, save an inert reply draft, and explicitly
  delete queue records without copying PII into private SQLite or exposing a
  send operation.
- A content-minimizing local audit ledger is implemented in
  `JOL-CAREER-005G`; it records only fixed operational outcomes, bounded timing,
  corpus version, and counts in a separate retention-bounded file with no
  public read route.
- A deterministic response disclosure guard is implemented in
  `JOL-CAREER-005H`; offline export and runtime egress share one private-data
  policy, and unsafe candidate responses become a generic audited `503` with no
  offending content disclosed.
- Disabled-by-default grounded OpenAI answer synthesis is implemented in
  `JOL-CAREER-005I`; deterministic evidence selection precedes the provider,
  no-evidence requests bypass it, successful output can replace only answer
  prose, and all provider or validation failures preserve the deterministic
  response.
- Integrate the isolated Jolene public service through the portfolio adapter.
- Preserve the public-evidence-only source boundary.
- Add production cost ceilings, provider-specific redaction, edge admission, and
  centralized audit monitoring.

`JOL-CAREER-005A/B/C/D/E/F/G/H/I` do not complete this ticket: there is no
evaluated or production-enabled model answer path, outbound reply control, authenticated
production owner surface, CORS, public binding, container service, portfolio
integration, production-grade abuse controls, production audit pipeline, or
deployment path.

`JOL-CAREER-005F` verification checkpoint:

- implementation commit: `1d1a4d9` (`JOL-CAREER-005F add private contact review`);
- 39 test files and 218 tests pass on Node 24.18.0, alongside TypeScript
  validation and the production build;
- Compose configuration and the production dependency audit pass, with zero
  reported production vulnerabilities;
- live API verification confirms exact owner access, wrong-scope and
  cross-origin refusal, exact deletion confirmation, and the absence of a send
  route; and
- desktop and 390 px reduced-motion browser verification confirms the contact
  list, local draft dialog, focus placement, deletion flow, empty state, and no
  horizontal overflow.

`JOL-CAREER-005G` verification checkpoint:

- implementation commit: `6d5689f` (`JOL-CAREER-005G add privacy-safe public audit ledger`);
- 40 test files and 226 tests pass on Node 24.18.0, alongside TypeScript
  validation and the production build;
- Compose configuration, diff hygiene, and the production dependency audit
  pass with zero reported production vulnerabilities; and
- compiled live loopback requests record health, no-evidence answer, job-fit,
  invalid-contact, and unknown-route outcomes while retaining none of the
  submitted marker content.

`JOL-CAREER-005H` verification checkpoint:

- implementation commit: `3ef20f0` (`JOL-CAREER-005H guard public response disclosures`);
- 41 test files and 257 tests pass on Node 24.18.0, alongside TypeScript
  validation and the production build;
- Compose configuration, diff hygiene, secret-pattern scanning, and the
  production dependency audit pass with zero reported vulnerabilities; and
- a compiled live server with deliberately unsafe provider output returns only
  `503 public_response_blocked`, emits the fixed audit outcome, and discloses
  none of the injected private-path marker.

`JOL-CAREER-005I` verification checkpoint:

- implementation commit: `ba2946c` (`JOL-CAREER-005I add grounded OpenAI answers`);
- 43 test files and 270 tests pass on Node 24.18.0, alongside TypeScript
  validation and the production build;
- Compose configuration, diff hygiene, secret-pattern scanning, and the
  production dependency audit pass with zero reported vulnerabilities;
- compiled fake-provider verification confirms model and exact deterministic
  fallback paths while excluding the session token and citation link from the
  provider input; and
- no live provider request, key copy, public binding, CORS, portfolio
  integration, merge, or deployment was performed.

### JOL-CAREER-006 — Evaluation and launch gates

- `JOL-CAREER-006A` implements a versioned offline backend harness with 12
  deterministic/fake-provider cases, 11 precommitted 100% blocker metrics,
  privacy-safe machine output, fail-closed fixture validation, and nonzero
  hard-gate exits.
- `JOL-CAREER-006B` extends that harness through the real SQLite evidence store
  and public exporter with nine confidentiality and lifecycle cases. The v1.1
  baseline now has 21 cases and 16 precommitted 100% blocker metrics.
- `JOL-CAREER-006C` adds 17 impersonation, abuse, exfiltration, unsafe-egress,
  consent, validation, secret-rejection, and real contact-staging cases. The
  v1.2 baseline now has 38 cases and 23 precommitted 100% blocker metrics.
- `JOL-CAREER-006D` adds canonical unresolved-conflict groups over active
  evidence IDs plus deterministic answer refusal, grounded-provider bypass,
  and job-fit exclusion. The v1.3 baseline now has 41 cases and 24
  precommitted 100% blocker metrics.
- `JOL-CAREER-006E` persists owner-reviewed conflict declarations and
  resolutions in the private SQLite registry and makes export consume them
  automatically. Partial-public groups fail closed by omitting eligible members
  rather than revealing private conflict membership.
- Build fixtures for supported, adjacent, missing, stale, confidential, and
  adversarial questions.
- Require citation correctness, maturity preservation, privacy refusal, and
  factual invariance across personality modes.
- Manually review representative answers before public launch.

`JOL-CAREER-006A/B/C/D/E` do not complete this ticket. Visual conflict
declaration/resolution control; live-model
quality/semantic-entailment/latency/token/cost measurement; additional adaptive
red-team coverage; portfolio citation and
accessibility verification; representative human review; production controls;
and launch approval remain open.

`JOL-CAREER-006A` verification checkpoint:

- implementation commit: `84281a9` (`JOL-CAREER-006A add public delegate evaluation harness`);
- canonical baseline: 12 of 12 cases and 11 of 11 metrics pass at precommitted
  10,000-basis-point blocker thresholds;
- suite hash:
  `56d0c1015c8e8c33da4a1155eee7de5bd01f626be3b307e4f021ced163536573`;
- 44 test files and 275 tests pass on Node 24.18.0, including malformed-suite,
  privacy-safe-report, reproducible-failure, and nonzero-exit coverage; and
- no live provider request, public bind, integration, merge, deployment, human
  sign-off, or launch authorization was performed.

`JOL-CAREER-006B` verification checkpoint:

- implementation commit: `2c0f4d5` (`JOL-CAREER-006B evaluate career evidence lifecycle`);
- canonical v1.1 baseline: 21 of 21 cases and 16 of 16 metrics pass at
  precommitted 10,000-basis-point blocker thresholds;
- suite hash:
  `5cc1c27895da47166dde40a3d3ffbde86678a35c3b85823ddf499dd5269ad35e`;
- lifecycle execution uses the production SQLite store and public exporter for
  private/internal/candidate exclusion, stale reviews, claim/source revocation,
  missing and changed sources, supersession, and revocation continuity;
- 44 test files and 276 tests pass on Node 24.18.0, alongside build, Compose,
  dependency-audit, report-privacy, diff, and secret checks; and
- semantic conflict detection, live model measurement, integration, deployment,
  human sign-off, and launch authorization remain unperformed.

`JOL-CAREER-006C` verification checkpoint:

- implementation commit: `1d97db3` (`JOL-CAREER-006C add red-team contact evaluations`);
- canonical v1.2 baseline: 38 of 38 cases and 23 of 23 metrics pass at
  precommitted 10,000-basis-point blocker thresholds;
- suite hash:
  `0a3f1b0d1af69b7d532bc5dac6318a166637647db8fa798bfbd06e45d624d7f0`;
- red-team coverage includes unsupported impersonation, compensation/contact,
  abusive and system-exfiltration requests plus six unsafe generated-egress
  classes checked by the shared disclosure policy;
- contact coverage uses the production schema and file queue for minimized
  valid staging, instruction-like data, consent, invalid fields, bounds,
  likely-secret rejection, and generic non-echoing receipts;
- 44 test files and 277 tests pass on Node 24.18.0, alongside build, Compose,
  dependency-audit, hard-failure, report-privacy, diff, and secret checks; and
- arbitrary model-prose entailment, semantic conflicts, live model measurement,
  integration, deployment, human sign-off, and launch authorization remain open.

`JOL-CAREER-006D` verification checkpoint:

- implementation commit: `429d180` (`JOL-CAREER-006D add semantic conflict policy`);
- canonical v1.3 baseline: 41 of 41 cases and 24 of 24 metrics pass at
  precommitted 10,000-basis-point blocker thresholds;
- suite hash:
  `4828d381bd05d5a49c60a1e6169e2967fd365f58946a6295ada0d61622ca03ed`;
- conflict groups are explicit, canonical, limited to two through five active
  evidence IDs, and validated without attempting semantic inference from text;
- answer requests touching conflicted evidence return no claims or citations,
  grounded generation is bypassed, and job-fit comparisons exclude conflicted
  records while retaining unrelated eligible evidence;
- 44 test files and 281 tests pass on Node 24.18.0, alongside build, Compose,
  dependency-audit, diff, and focused secret checks; and
- conflict declaration/resolution UI, arbitrary model-prose entailment, live
  model measurement, integration, deployment, human sign-off, and launch
  authorization remain open.

`JOL-CAREER-006E` verification checkpoint:

- implementation commit: `086784c` (`JOL-CAREER-006E persist reviewed conflicts`);
- a dedicated private SQLite table retains canonical two-through-five-claim
  groups, reviewer attribution, unresolved/resolved state, and history across
  restart;
- owner-scoped service and same-origin loopback routes list, declare, and
  resolve groups with idempotent repeat behavior and overlap rejection;
- export derives public conflict groups only when every member is eligible and
  omits otherwise eligible members when any conflicting member is private,
  stale, revoked, superseded, or otherwise ineligible;
- 44 test files and 283 tests pass on Node 24.18.0; suite v1.3 remains 41 of 41
  cases and 24 of 24 metrics with hash
  `4828d381bd05d5a49c60a1e6169e2967fd365f58946a6295ada0d61622ca03ed`;
  build, Compose, dependency-audit, diff, and focused secret checks pass;
- an isolated compiled loopback process returned `200 []` for the empty
  conflict list, `404` for a same-origin declaration referencing unknown
  claims, and `403` for the same mutation from a foreign origin; and
- visual conflict review, arbitrary model-prose entailment, live model
  measurement, integration, deployment, human sign-off, and launch
  authorization remain open.

### JOL-CAREER-007 — Private MCP adapter

- Add only after the evidence service contract is stable.
- Authenticate clients and scope every tool to actor, workspace, visibility,
  and audit identity.
- Keep all side-effecting operations proposal-only.

### JOL-CAREER-008 — Relationship retrieval evaluation

- Build multi-hop career questions and a relational baseline.
- Add GraphRAG or a dedicated graph database only if measured results justify
  the operational cost.

## Acceptance criteria

- Docker images and build context contain no credentials, databases, vault
  content, or `.env` files.
- The vault is read-only at both filesystem and application boundaries.
- Private Jolene can retrieve reviewed professional context with provenance.
- Public Jolene cannot address or query private records by construction.
- Every material public career claim cites an approved source.
- Job-description comparisons distinguish direct, adjacent, missing, and
  unknown evidence without fabricating fit.
- Revoked or superseded evidence disappears from the next public export.
- RAG quality is evaluated before graph infrastructure is introduced.
- MCP is optional interoperability and never a shortcut around authorization.

## Hard non-goals

- exposing the private Jolene HTTP service to the public internet;
- mounting Obsidian into the portfolio deployment;
- copying the entire vault into a vector or graph database without review;
- giving website visitors durable access to private memory;
- autonomous recruiter outreach, application submission, or interview
  scheduling; and
- adding Neo4j, GraphRAG, or MCP merely for architectural fashion.
