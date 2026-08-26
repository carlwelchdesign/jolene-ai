# Career evidence registry

Jolene's professional context begins in a private, governed SQLite registry.
The registry is not a public API. Its records become available to private
Jolene only through a separate retrieval service after the review, freshness,
actor, channel, and visibility gates below pass.

## Records and lifecycle

- A **source** records source type, title, checksum, capture time, private source
  reference, optional public citation URI, and review state.
- A **claim** records one proposition, Carl's reviewed contribution boundary,
  project maturity, visibility, review state, and supersession history.
- A **relationship** connects explicit employers, roles, projects, skills,
  capabilities, artifacts, and claims without requiring a graph database.

Imports create `public_candidate` claims in `needs_review`. Import cannot create
`public_approved` data. Public approval requires:

1. an active, approved source;
2. a current source review, no more than 180 days old;
3. a public HTTP(S) or portfolio-relative citation URI; and
4. an explicit claim-level public approval.

Only active, approved, fresh `public_approved` claims whose sources pass the
same gates appear in the internal public-claim query. Revoked or superseded
records disappear immediately. `JOL-CAREER-004` will later turn that bounded
query into a versioned, content-minimized export artifact.

## Import the canonical portfolio

Configure the canonical local checkout in `.env.local` if it is not the default
sibling directory:

```dotenv
JOLENE_PORTFOLIO_ROOT=/absolute/path/to/carl-welch-portfolio
JOLENE_OWNER_ACTOR_ID=carl
JOLENE_CAREER_WORKSPACE_ID=professional
```

Then run:

```bash
npm run career:import-portfolio
```

Run this development migration from the source checkout, not from the pruned
runtime container.

The importer reads the portfolio's typed project, experience, capability, and
recommendation data, validates the runtime shape, and writes idempotent
review-required records. Changed claims create a replacement and retain the
prior claim as `superseded`; unchanged reruns do not duplicate records.

The existing recommendation collection remains candidate evidence. Import does
not resolve its official-source reconciliation, publication rights, or Carl's
record-level approval.

## Current local migration evidence

The August 25, 2026 canonical portfolio snapshot produced:

- 26 sources;
- 41 active claims;
- 57 explicit relationships;
- 67 expected review-required findings; and
- 0 public-approved claims.

The pre-migration SQLite backup is retained locally under the ignored
`.jolene/backups` directory.

## Import reviewed career-note candidates from Obsidian

Career ingestion uses a separate, explicit allowlist from conversational vault
search:

```dotenv
JOLENE_CAREER_OBSIDIAN_ALLOWLIST=01 Career & Job Search
```

Run the current-snapshot import from the source checkout:

```bash
npm run career:import-obsidian
```

The importer:

- refuses absolute or parent-traversing allowlist entries;
- skips dot-directories, non-Markdown files, symlinks, and files over 1 MB;
- parses bounded frontmatter, headings, tags, aliases, wiki links, Markdown
  links, and document dates;
- stores the current file hash and structured metadata, not Git or Obsidian
  history;
- creates section-level claims as `private` and `needs_review` only;
- treats `jolene_career_import: false` as an explicit opt-out;
- supersedes sections removed from the current note;
- records deleted or opted-out notes as `missing`; and
- restores a reappearing missing note to active `needs_review` without
  reactivating an explicitly revoked source.

The August 25, 2026 bounded import of `01 Career & Job Search` produced 11
sources, 81 active private claims, 106 tag/wiki-link relationships, and zero
public-approved claims. A pre-import backup is retained in the ignored local
backup directory.

## Private hybrid retrieval

Run the index after approving sources and claims for internal use:

```bash
npm run career:index
```

One reviewed claim becomes one or more stable semantic chunks. The local index
stores only eligible chunk content and optional embeddings in the same private
SQLite database. Before every search, synchronization removes stale, revoked,
superseded, missing-source, rejected, unreviewed, and private draft records.

Retrieval combines lexical rank with cosine vector rank using reciprocal-rank
fusion. OpenAI `text-embedding-3-small` is the default embedding provider. If
embedding creation or query embedding is unavailable, retrieval continues with
the deterministic lexical ranker without widening its authorization scope.

Private Jolene receives the `search_career_evidence` tool only for Carl in a
private channel. Each result contains the evidence excerpt, maturity,
visibility, score, stable chunk/source/claim IDs, logical key, provenance, and
review date. Material career answers must cite the returned source and claim
IDs and preserve limitations and project maturity.

The career retrieval ledger stores requester/corpus scope, channel, outcome,
retrieval mode, an HMAC query fingerprint, and returned citation IDs. It never
stores the raw query or retrieved evidence excerpt. Read the bounded ledger at
`GET /v1/career-retrieval-accesses?actorId=carl&workspaceId=professional` on
the loopback-only control API.

The current local corpus has zero retrieval-eligible claims because all
imported records still require Carl's review. The index therefore synchronizes
to zero chunks until that separate human gate is completed.
