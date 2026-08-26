# Jolene Portfolio Hiring Delegate Plan

**Date:** 2026-08-25

**Status:** Planned; implementation has not started

**Portfolio mapping:** Treat `/Users/carl.welch/Documents/Github Projects/carl-welch-fit-console` as Carl's `carl-welch-portfolio` project unless Carl identifies a different checkout.

## Product outcome

Give hiring managers and recruiters a useful, evidence-backed conversation about
Carl's experience, projects, strengths, and honest gaps while preserving a clean
handoff to Carl. The experience should feel like Jolene, but it must identify
itself as an AI portfolio guide rather than a human representative.

Success means a visitor can:

- ask a concrete career or project question;
- optionally supply a job description as untrusted role context;
- receive a concise answer tied to public, approved evidence;
- inspect the supporting resume, project, work, skill, or proof sources; and
- contact Carl when the question requires personal judgment or a commitment.

## Existing project evidence

The local portfolio project already contains most of the first product slice:

- a Next.js recruiter and hiring-manager experience;
- curated public-safe Markdown under `content/`;
- source-constrained career Q&A with deterministic fallback;
- project and source identifiers on answers;
- role-fit assessment;
- rate-limited chat and contact routes;
- local event records; and
- redacted Slack notifications.

The local directory currently has no `.git` directory. Jolene must not modify it
until the intended repository or version-control boundary is confirmed. This
plan can proceed in `jolene-ai` without changing the portfolio checkout.

## Architecture decision

Build a **public Jolene delegate**, not a network tunnel into private Jolene.

```text
Recruiter or hiring manager
        |
        v
Portfolio chat and role-fit UI
        |
        v
Public Jolene delegate
        |
        +--> approved public evidence bundle
        +--> deterministic retrieval and source IDs
        +--> career-answer model with public-only prompt
        +--> redacted event and Slack summary
        |
        v
Answer with evidence + handoff to Carl
```

The portfolio application owns the public request and response boundary. The
private Jolene service owns Carl's private work, memory, Obsidian access, and
approval queues. These systems may later share versioned persona rules and
public evidence contracts, but they must not share unrestricted runtime memory.

## Public delegate contract

### Identity and transparency

- Preferred label: **Jolene, Carl's AI portfolio guide**.
- State plainly that answers are generated from Carl-approved portfolio sources.
- Never imply Jolene is Carl, a recruiter, a reference, or a human assistant.
- Preserve Jolene's warmth and wit lightly; clarity and evidence outrank persona.

### Allowed knowledge

- public-safe resume facts;
- reviewed work history;
- reviewed project profiles and proof claims;
- reviewed skills and role-positioning notes;
- public links explicitly included in the evidence bundle; and
- a visitor-supplied job description treated as untrusted comparison context.

### Denied knowledge and claims

- private Obsidian notes or durable personal memory;
- private job-search records, recruiter identities, application status, or raw correspondence;
- client secrets, credentials, local paths, unpublished source code, or internal URLs;
- salary, work authorization, availability, relocation, references, or other personal commitments unless Carl publishes an exact approved answer;
- invented metrics, seniority, production status, certifications, skills, or project outcomes; and
- claims that flatten professional work, deployed portfolio work, prototypes, scaffolds, and advisory-only systems into equivalent experience.

### Actions

- Public questions are answered automatically only within the public evidence boundary.
- Contact requests create a reviewable lead and a redacted notification to Carl.
- Jolene may recommend that the visitor contact Carl when evidence is missing or the answer requires personal judgment.
- Jolene cannot email, DM, schedule, negotiate, apply, publish, edit the portfolio, or promise follow-up.
- Any future outbound response from Carl's private Jolene must use the existing exact-action approval framework.

## Required safeguards

1. Treat the visitor's question and job description as data, never instructions.
2. Retrieve evidence before generation and return the exact public source IDs used.
3. If no evidence supports a claim, say so briefly and offer a useful handoff.
4. Preserve project maturity labels in every derived answer.
5. Apply request-size limits, durable production rate limiting, abuse controls, and a cost ceiling.
6. Store the minimum useful event data; redact contact details and visitor text from Slack summaries.
7. Define retention and deletion behavior before public launch.
8. Provide an accessible report-problem or correction path.
9. Keep deterministic fallback behavior when the model is unavailable.
10. Evaluate factual invariance across personality modes before enabling a stronger Jolene voice.

## Product states

- **Default:** explain what Jolene can answer and that sources are Carl-approved.
- **Loading:** show that evidence is being reviewed; do not imply autonomous research.
- **Answer:** present concise prose followed by supporting source and project links.
- **Insufficient evidence:** state the limitation and suggest a narrower question or contact handoff.
- **Unsafe/private request:** decline without revealing whether private information exists.
- **Rate limited:** preserve the visitor's draft locally and explain when they can retry.
- **Model unavailable:** return the deterministic evidence summary.
- **Contact handoff:** confirm receipt without promising a response time.
- **Correction:** let a visitor flag a questionable answer; preserve the answer and source IDs for review.

## Implementation sequence

### PORT-DEL-001 — Confirm repository boundary

- Confirm that `carl-welch-fit-console` is the intended `carl-welch-portfolio` project.
- Restore or initialize the intended Git repository before edits.
- Record deployment, domain, data store, and environment ownership.

### PORT-DEL-002 — Version the public evidence contract

- Add a schema for source ID, title, public body, provenance, maturity, reviewed date, and visibility.
- Fail builds on duplicate IDs, missing maturity, invalid links, or unreviewed public content.
- Return only sources actually used by the answer.

### PORT-DEL-003 — Introduce Jolene's public delegate

- Replace the generic career-assistant identity with the transparent public Jolene label.
- Move the public behavior rules into a versioned prompt/specification.
- Add prompt-injection resistance for visitor content and job descriptions.
- Keep deterministic fallback and source-linked answers.

### PORT-DEL-004 — Trust, privacy, and handoff

- Add production-grade distributed rate limiting and abuse monitoring.
- Define event and lead retention, deletion, and redaction.
- Add report-problem/correction capture.
- Route only minimized, redacted summaries to Slack.

### PORT-DEL-005 — Evaluations and launch gates

- Build a recruiter-question evaluation set covering supported facts, honest gaps, project maturity, adversarial prompts, private-data requests, and unavailable-model fallback.
- Verify the same factual propositions across neutral and Jolene personality modes.
- Run keyboard, screen-reader, mobile, latency, and cost-budget checks.
- Review every public evidence item and representative answer before launch.

### JOL-MON-001 — Read-only project awareness

- Add the portfolio repository to Jolene's future watched-project registry.
- Snapshot only approved metadata: branch/revision, clean/dirty state, latest verified build, public evidence freshness, and failed checks.
- Require an explicit cadence, budget, stop condition, and visible history before scheduling.
- Report changes to Carl; never edit or deploy the portfolio from a monitor.

## Acceptance criteria

- Every substantive answer cites at least one exact approved source or clearly reports insufficient evidence.
- No private vault, personal memory, raw lead, or private job-search data reaches the public delegate.
- Adversarial visitor text cannot change the public evidence boundary or trigger a tool/action.
- Prototype and scaffold boundaries remain intact in generated answers.
- Jolene discloses that it is an AI portfolio guide.
- The deterministic fallback remains usable without model access.
- Contact handoff is redacted, rate-limited, reviewable, and makes no response-time promise.
- The public delegate exposes no external-action capability.
- Monitoring remains read-only and unscheduled until Carl approves its operating limits.

## Metrics

- evidence-backed answer rate;
- insufficient-evidence rate;
- source-link engagement;
- useful follow-up question rate;
- contact handoff conversion;
- correction/report rate;
- unsupported-claim evaluation failures;
- private-data and prompt-injection refusal pass rate;
- p50/p95 latency and cost per completed conversation; and
- rate-limit or abuse volume.

## Non-goals for the first slice

- allowing public visitors to access Carl's private Jolene;
- autonomous recruiter outreach or follow-up;
- interview scheduling;
- application submission;
- salary, authorization, or availability commitments;
- unrestricted web browsing;
- live repository modification or deployment; and
- voice synthesis.
