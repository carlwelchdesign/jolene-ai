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
- A **relationship review** is an append-only owner decision over a
  deterministic candidate that binds one active claim to one exact active
  source-level relationship snapshot.
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
- shows source-derived claim-relationship suggestions with exact typed
  endpoints and fingerprints, and requires confirmation before either approval
  or rejection;
- creates a claim-level relationship only after exact owner approval, records
  rejection without creating a link, and marks previous decisions stale when
  the source content or source relationship changes;
- supports rejection and confirmation-gated source or claim revocation; and
- keeps the current 38-source, 143-active-claim queue navigable through
  registry-wide search, filters, summaries, ten-source pages, synchronized
  header/footer navigation, and collapsed source-linked claim groups;
- shows bounded source capture, update, review, and shortened fingerprint
  context without exposing absolute vault paths.

The supporting `/v1/career-evidence/*` routes are local administration routes,
not the future recruiter-facing API. Every read and mutation is checked against
the configured owner/workspace, and reviewer attribution must match the owner.
Browser mutations must also originate from the same loopback control origin.
The screen changes retrieval eligibility only. It cannot publish portfolio
content, send a message, apply for a role, or expose raw Obsidian documents.

This is a loopback pilot, not an authenticated remote administration surface.
Do not bind it to a public interface without adding authentication, production
CSRF controls, and an explicit deployment threat review.

The 2026-08-26 recovered-career refresh imported 12 allowlisted synthesized
career notes into the private registry, leaving every imported claim in
`needs_review`, with private visibility and no public citation URI. Raw mailbox
source-note folders remain outside the configured allowlist. The refresh made
no embedding/model request and left the public-approved count at zero.

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

The relationship enrichment workflow uses two additional read boundaries and
one same-origin mutation:

- `GET /v1/career-evidence/relationship-candidates` lists deterministic
  candidates in the configured owner scope;
- `GET /v1/career-evidence/relationship-reviews` lists append-only decision
  history; and
- `POST /v1/career-evidence/relationship-candidates/:id/decision` accepts the
  exact candidate fingerprint, `approved` or `rejected`, and owner reviewer ID.

Candidates are produced only when an active claim and an active source-level
relationship share the same active source. A claim with any active claim-level
relationship receives no additional pending coverage suggestion. Each unlinked
claim receives at most one pending option at a time. Options are ordered by the
explicit relationship-type priority `employed_by`, `held_role`,
`contributed_to`, `demonstrates`, `uses_skill`, `supports`, `in_domain`, then
`related_to`, with source relationship ID and candidate ID as stable
tie-breakers. No text, embedding, similarity score, or model chooses the order.

Rejection creates no link, retains append-only history, and advances that claim
to its next exact option. Approval copies only the reviewed typed endpoints,
keeps the approved candidate visible, and suppresses every other pending option
for that claim. A source content change, source disappearance or revocation,
relationship mutation or revocation, or inactive claim removes the candidate
from current eligibility and revokes any review-created link. The decision
history remains. The local UI counts and paginates claims, not the underlying
source-relationship cross product. This is deterministic enrichment, not
semantic inference, GraphRAG, or a graph-database activation.

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
npm run career:import-portfolio:audit
npm run career:import-portfolio:review-packet
npm run career:import-portfolio
```

Run the audit before every canonical import. It creates a SQLite-native temporary
backup, imports into that disposable clone, reports only aggregate approval and
validation counts, and deletes the clone. It never mutates the configured source
database or emits claim, source, or portfolio prose. A later capture timestamp by
itself does not invalidate an unchanged approved source, and an unchanged reviewed
claim retains its explicit `public_approved` or `internal_approved` decision.
Actual source, proposition, contribution, maturity, citation, or metadata changes
still fail closed into review-required state.

The separate review-packet command writes the exact changed public projection to
the ignored owner-only path configured by
`JOLENE_PUBLIC_CORPUS_REVIEW_PACKET_PATH`. The mode-0600, schema-validated packet
contains only stable source IDs, public citation destinations, source hashes, and
before/after public claim text, contribution, maturity, and visibility. It omits
database and checkout paths, private provenance references, Obsidian material,
credentials, and private source bodies. Its SHA-256 excludes the generation time
and clone-local candidate UUIDs, so identical inputs produce the same review
binding. Generating the packet does not record an approval or authorize import.

Run this development migration from the source checkout, not from the pruned
runtime container.

The importer reads the portfolio's typed project, experience, capability, and
recommendation data, validates the runtime shape, and writes idempotent
review-required records. Changed claims create a replacement and retain the
prior claim as `superseded`; unchanged reruns do not duplicate records.

The existing recommendation collection remains candidate evidence. Import does
not resolve its official-source reconciliation, publication rights, or Carl's
record-level approval.

The 2026-08-27 `JOL-PUBLIC-010` dry run used the current portfolio `origin/main`
snapshot and the latest external canonical backup. The source database remained
byte-for-byte unchanged. Of 41 previously eligible public claims, 14 would remain
immediately eligible; 12 changed sources and 6 changed claims require fresh human
review. The report exposed only those counts and fixed validation codes. No
canonical import, approval decision, artifact replacement, endpoint change, or
deployment occurred.

The corresponding owner-only packet is schema `1.0.0`, contains 12 changed
source entries and 27 affected public claim entries (6 materially changed), and
is bound by packet hash
`sha256:eb385ddf47365e4cc423591143997cc44c7a46a07589cf6f285150ca4c23aedb`.
It passed mode, schema, forbidden-marker, deterministic-hash, and source-database
immutability checks. It is a review input, not a completed review decision.

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

Run deterministic local indexing after approving sources and claims for
internal use:

```bash
npm run career:index:lexical
```

The compiled runtime image exposes the same bounded operation as
`npm run start:career-index:lexical`. It refuses to run if
`JOLENE_CAREER_EMBEDDINGS_ENABLED=true`, uses the network-free provider, removes
any formerly stored vectors for the synchronized scope, and fails unless every
retained chunk is lexical-only. Its report contains counts and mode only, not
claim content or search text.

`npm run career:index` remains the general development command. It follows the
explicit embedding configuration described below and may contact the configured
provider when that separate opt-in is enabled.

One reviewed claim becomes one or more stable semantic chunks. The local index
stores only eligible chunk content and optional embeddings in the same private
SQLite database. Before every search, synchronization removes stale, revoked,
superseded, missing-source, rejected, unreviewed, and private draft records.

Retrieval always supports deterministic lexical rank. Embeddings are disabled
by default, including in Docker Compose, so indexing and search make no
embedding-provider request even when the private runtime has an OpenAI API key.
To opt in deliberately, configure:

```dotenv
JOLENE_PRIVATE_RETRIEVAL_PROVIDER_EGRESS=approved_openai
JOLENE_CAREER_EMBEDDINGS_ENABLED=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Enabling this sends eligible reviewed chunk content during synchronization and
private career-search query text during search to the configured OpenAI
embedding provider. Vector rank is then fused with lexical rank using
reciprocal-rank fusion. If embedding creation or query embedding is unavailable,
retrieval continues with the deterministic lexical ranker without widening its
authorization scope.

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

The canonical private registry currently has 143 retrieval-eligible approved
claims: 41 are also approved for the public artifact and 102 are private-Jolene
only. Human approval does not itself synchronize the private retrieval index.
The local pilot has separately synchronized those claims into 152 lexical-only
chunks with zero stored vectors. Embedding-provider opt-in, public export,
portfolio production integration, deployment, and launch remain separate gates.

## Offline public evidence artifact

Generate the private handoff artifact locally:

```bash
npm run career:export-public
```

The canonical command builds a one-shot `jolene-career-export` container and
reads the same named data volume used by the private review UI. The job has no
network, ports, dependencies, `.env.local`, OpenAI or Slack credentials,
Obsidian mount, portfolio mount, or private-review packet mount. Its SQLite
connection is query-only and refuses a missing database. This prevents a stale
host development database from silently replacing the reviewed runtime state.

`npm run career:export-public:host` remains available for explicit development
fixtures and migrations. It reads the configured host database and must not be
used as evidence of the canonical review state.

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

The current canonical August 27, 2026 owner-reviewed registry exports 41 public
claims and one revoked ID for the superseded David Allen relationship claim under
schema `1.0.0`. Its content-derived corpus is
`career:fd223e58149ded86f5d3083678b496239b66cdf3b458b740dd637ddb8a27549e`;
the artifact generated at `2026-08-27T20:17:09.125Z` records evidence reviewed
through `2026-08-27T20:16:33.853Z`. The deterministic empty-corpus fixture and
hash remain under `contracts/` for regression coverage, not as current runtime
state. Publication, file transfer to a public runtime, public API activation,
portfolio integration, deployment, and launch remain separate approval gates.
