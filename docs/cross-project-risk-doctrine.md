# Cross-project risk doctrine

Risk is product behavior and architecture. It is not a disclaimer added after
the product is built, and it is not satisfied by naming a limitation without
showing the control, owner, evidence, and residual exposure.

Apply this review proportionately to every project. A static portfolio page
does not need the same controls as an agent that can retrieve private data or
trigger an external action. A project must not claim a control that is only
planned, nor manufacture irrelevant AI risk work when AI is not in scope.

## Risk dimensions

For each material risk, record the consequence, control, owner, verification
evidence, residual risk, and rollback or recovery path.

| Dimension | Required question |
| --- | --- |
| Human or real-world harm | Who could be harmed by a wrong, stale, unavailable, or overconfident result? |
| Data exposure | What data may enter storage, retrieval, logs, models, providers, and public responses? |
| Model or automation authority | What may the model recommend, decide, invoke, or change, and what remains under explicit human approval? |
| Evidence and uncertainty | What supports the output, how is provenance retained, and how are weak or conflicting claims presented? |
| Untrusted input | How are prompts, retrieved documents, uploads, tool results, and indirect instructions contained? |
| Failure and degraded behavior | What happens when retrieval, providers, validation, dependencies, or budgets fail? |
| External side effects | Which messages, submissions, purchases, deployments, deletions, or other consequential actions require exact authorization? |
| Operations | What is monitored, what triggers an incident, and who owns recovery? |
| Release and rollback | Which build, evaluation, preview, production, migration, corpus, and rollback gates are separate? |
| Maturity and public claims | Is the work accurately labeled as planned, prototype, development, preview, deployed demo, or production? |

## Lifecycle gates

### Plan

- Identify material users, data, decisions, actions, dependencies, and failure consequences.
- Define explicit non-goals and prohibited behavior.
- Assign an owner and acceptance evidence for each material control.

### Build

- Keep policy decisions deterministic where practical and I/O at controlled edges.
- Minimize data and authority; fail closed at trust boundaries.
- Implement observable failure and degraded states without leaking sensitive content.
- Put consequential actions behind explicit, scope-bound human approval.

### Review

- Test expected behavior, misuse, stale or conflicting evidence, dependency failure, and attempted boundary bypass.
- Separate passing code checks from product, security, privacy, accessibility, legal, operational, and owner-approval gates.
- Verify the actual user path, not only an internal function or API.

### Release and operate

- Promote only the reviewed artifact and configuration.
- Verify production state, telemetry, alerts, and rollback evidence.
- Record incidents and convert newly exposed failure modes into regression tests and planning requirements.

## Public communication

When asked how Carl handles risk, explain the controls and their boundaries in
plain language. Cite the projects that demonstrate them. Do not turn a positive
risk-handling question into an empty limitation disclaimer, and do not imply a
planned safeguard is already operating.
