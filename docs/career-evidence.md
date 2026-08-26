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
- A **claim conflict** is an owner-reviewed group of two through five active
  claim UUIDs whose propositions must not be collapsed into one assertion. Its
  stable ID is derived from scope and canonical membership; no text similarity
  or model decides conflict membership.

Imports create `public_candidate` claims in `needs_review`. Import cannot create
`public_approved` data. Public approval requires:

1. an active, approved source;
2. a current source review, no more than 180 days old;
3. a public HTTP(S) or portfolio-relative citation URI; and
4. an explicit claim-level public approval.

Only active, approved, fresh `public_approved` claims whose sources pass the
same gates appear in the internal public-claim query. Revoked or superseded
records disappear immediately. That bounded query feeds the implemented
versioned, content-minimized export artifact.

## Human review control

Run the loopback control server and open
[http://127.0.0.1:8421/career-evidence](http://127.0.0.1:8421/career-evidence).
The review screen:

- discovers the configured owner/workspace scope from the local server and
  cannot switch to another registry scope;
- presents source provenance, policy findings, record state, review state,
  visibility, and project maturity before each decision;
- requires source approval before internal or public claim approval;
- disables public review when no public HTTP(S) or portfolio-relative citation
  exists;
- requires a second exact-claim confirmation for public eligibility;
- lets the owner select two through five active claims, review their exact
  propositions, explicitly declare a conflict, inspect unresolved and resolved
  history, and resolve a group without choosing a winning claim;
- excludes claims already held by an unresolved group from new selections and
  labels their withheld state in the evidence queue;
- supports rejection and confirmation-gated source or claim revocation; and
- keeps the 122-claim queue navigable through search, filters, summaries, and
  collapsed source-linked claim groups.

The supporting `/v1/career-evidence/*` routes are local administration routes,
not the future recruiter-facing API. Every read and mutation is checked against
the configured owner/workspace, and reviewer attribution must match the owner.
Browser mutations must also originate from the same loopback control origin.
The screen changes retrieval eligibility only. It cannot publish portfolio
content, send a message, apply for a role, or expose raw Obsidian documents.

This is a loopback pilot, not an authenticated remote administration surface.
Do not bind it to a public interface without adding authentication, production
CSRF controls, and an explicit deployment threat review.

The visual conflict workflow uses the private persistence API:

- `GET /v1/career-evidence/conflicts?actorId=carl&workspaceId=professional`
  lists the configured owner's unresolved and resolved groups;
- `POST /v1/career-evidence/conflicts` declares a group from `actorId`,
  `workspaceId`, two through five `claimIds`, and the owner `reviewerId`; and
- `POST /v1/career-evidence/conflicts/:id/resolve` resolves a group using the
  same scope and reviewer attribution.

Declarations are idempotent, survive restart, reject inactive or unknown
claims, and prevent one claim from entering multiple unresolved groups.
Resolution does not delete history. These routes do not infer conflicts,
publish an artifact, or expose a recruiter-facing control.

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

## Offline public evidence artifact

Generate the private handoff artifact locally:

```bash
npm run career:export-public
```

The default output is
`.jolene/exports/public-career-evidence.json`, which is ignored by Git and
written through an owner-only temporary file plus atomic rename. The command
does not require an OpenAI key, start a public endpoint, copy the artifact into
the portfolio, or deploy anything.

The artifact contains:

- an embedded portfolio-compatible v1 manifest with a reproducible SHA-256
  corpus hash and content-derived corpus version;
- fresh, active `public_approved` claim/citation records only;
- stable `career:<claim UUID>` evidence IDs;
- reviewed maturity and contribution-boundary limitations;
- canonical unresolved-conflict groups when every member is public-eligible;
  and
- stable revoked IDs for formerly public evidence that is now stale,
  superseded, revoked, missing, or otherwise ineligible.

Before replacement, the command validates the previous artifact and carries
forward every previously exported ID that is no longer eligible. This catches
withdrawals that change current visibility as well as explicit revocation and
supersession. If the prior artifact is malformed or version-incompatible, the
export fails without overwriting it.

The exporter reads unresolved groups from the private SQLite registry. When
every member is public-eligible, it emits a content-minimized group of public
evidence IDs and the delegate refuses to assert those claims. When only some
members are public-eligible, it omits the otherwise eligible members and emits
no private conflict membership. Resolving the private group removes that block
on the next export; it never publishes by itself.

It excludes actor/workspace IDs, private provenance references, source hashes,
Obsidian metadata, relationships, internal/private claims, contact details, and
private memory. Export fails closed on filesystem paths, Obsidian links, common
secret formats, email addresses, phone numbers, localhost/private-network
citations, unsupported `career_note` sources, and schema violations.

Evidence strength is conservatively `limited` until the private registry gains
an explicit human-reviewed strength field. The exporter does not infer strength
from source type, wording, or maturity.

The canonical August 26, 2026 run produced a valid empty artifact with zero
evidence and zero revoked IDs because Carl has not publicly approved any claim.
Its deterministic empty-corpus hash is
`sha256:f218a8e06d12d725399b23539c03a8cd0ca4803e98f85e62421b65bf3ff87c7b`.
The schema and empty fixture live under `contracts/`. Publication, file transfer
to a public runtime, public API activation, and deployment remain separate
approval gates.
