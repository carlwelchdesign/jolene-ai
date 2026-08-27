# Jolene Professional Context Architecture

**Date:** 2026-08-25

**Status:** Docker API and career evidence foundation implemented; professional RAG and public portfolio delegate pending

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
| Retrieval | Deterministic lexical search over Markdown |
| Embedding RAG | Not implemented |
| MCP | Not implemented |
| Graph database / GraphRAG | Not implemented |
| Durable private memory | Implemented through explicit proposals and approval |
| Public portfolio evidence boundary | Modeled in the portfolio; public Jolene remains deferred from its first release |
| Docker | Image and API container verified; Slack operational cutover and production deployment remain pending |
| Career evidence registry | Implemented with sources, claims, relationships, review freshness, visibility, revocation, and supersession |
| Portfolio candidate migration | Implemented; 26 sources, 41 active claims, and 57 relationships imported with zero public-approved claims |

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

When the retrieval index moves to PostgreSQL and pgvector, it should run as a
separate private service with health checks, migrations, backups, and explicit
retention. SQLite remains appropriate for the present local control-plane
records.

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
4. Store embeddings in PostgreSQL with pgvector.
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
`used_skill`, `supports_claim`, and `supersedes`. Store those relationships in
PostgreSQL alongside pgvector first.

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

- Add an explicit professional-folder allowlist.
- Parse frontmatter, headings, tags, links, and dates.
- Create draft records only; never auto-promote private notes to public.
- Record import hashes and deletions without copying raw vault history.

### JOL-CAREER-003 — Hybrid RAG

- Add PostgreSQL and pgvector behind a knowledge-source adapter.
- Implement chunking, embeddings, lexical/vector fusion, metadata filters, and
  exact citations.
- Keep deterministic fallback and access logging.

### JOL-CAREER-004 — Public evidence export

- Export only active `public_approved` records.
- Produce a versioned manifest, content hash, schema version, and revocation
  list.
- Validate that no private path, note, memory, or contact record is present.

### JOL-CAREER-005 — Portfolio delegate

- Implement recruiter questions and job-description comparison in the
  portfolio project.
- Use only the public evidence export.
- Add rate limits, cost ceilings, input limits, redaction, and a kill switch.

### JOL-CAREER-006 — Evaluation and launch gates

- Build fixtures for supported, adjacent, missing, stale, confidential, and
  adversarial questions.
- Require citation correctness, maturity preservation, privacy refusal, and
  factual invariance across personality modes.
- Manually review representative answers before public launch.

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
