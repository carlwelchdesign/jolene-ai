# Security operations runbook

This runbook is the local operating contract for a suspected prompt injection,
unauthorized disclosure, poisoned source, provider-boundary violation, or
credential exposure. It does not authorize deployment or automatic re-enable.

## Ownership and severity

Carl is accountable for incident severity, external notification, restoration,
and re-enable approval. The active Jolene engineering agent is responsible for
containment, evidence preservation, bounded remediation, tests, and a reviewable
incident summary. Provider, Slack, hosting, or client owners are consulted only
when their system is in scope. Never put secrets or private content in Asana,
Slack, commit messages, telemetry, or the incident summary.

- `SEV-1`: confirmed credential exposure, unauthorized external write, or
  sensitive disclosure. Disable every affected capability immediately.
- `SEV-2`: credible injection, poisoned retrieval, or grounding bypass with no
  confirmed disclosure. Disable the affected ingestion, retrieval, generation,
  and egress capabilities.
- `SEV-3`: blocked attempt or suspicious telemetry with controls working. Keep
  the relevant surface disabled until triage establishes the boundary.

## Contain and investigate

1. Open one incident ticket with timestamps, opaque correlation/taint IDs,
   affected capability names, reason codes, version hashes, counts, and outcome.
2. Set every affected `JOLENE_ENABLE_*` switch to `disabled`; missing values are
   already disabled. Do not weaken unrelated controls to make diagnosis easier.
3. Revoke exposed provider, Slack, ingress, and shared-bearer credentials at the
   issuing system. Never paste old or replacement values into logs or tickets.
4. Quarantine suspect sources. Revoke affected public exports and invalidate
   derived indexes/caches so quarantined or revoked content cannot be retrieved.
5. Preserve only content-minimizing telemetry under a security hold. Store any
   necessary sensitive evidence locally with mode `0600`, outside Git, and name
   it in tickets only by an opaque evidence ID and hash.
6. Reproduce offline with deterministic fixtures. Convert the attack into a
   sanitized regression fixture that contains no private content or credentials.

Run the tabletop and relevant security gates:

```bash
npm run security:operations:tabletop
npm run security:release:check
npm run security:prompt-injection:red-team:validate
npm run test:security:red-team
npm run check
npm run build
```

## Credential rotation

Rotate in this order: disable capability, revoke old credential, create the
least-privileged replacement, store it only in the approved mode-0600 secret
boundary, run a non-mutating authentication check, then record issuer, scope,
rotation timestamp, expiry, and opaque fingerprint. Do not record the value.
If any verification fails, revoke the replacement and keep the capability off.

## Rebuild and restore

Rebuild indexes and caches only from active, reviewed, unrevoked sources. Restore
backups into an offline local validation target first; restored content does not
inherit current approval merely because it existed in a backup. Re-run lifecycle,
taint, revocation, retrieval, grounding, and red-team gates against the restored
state. Production and deployment verification remain separate release work.

## Re-enable checklist

Re-enable one capability at a time only after all of the following are true:

- root cause and affected scope are documented without sensitive content;
- exposed credentials are revoked and replacements independently verified;
- poisoned sources are quarantined or deleted and exports are revoked;
- derived indexes/caches are rebuilt from active reviewed sources;
- a sanitized regression exists and all focused plus repository gates pass;
- restored data has been validated offline;
- telemetry is functioning and contains no prompt, response, path, contact, or
  provider-error content;
- Carl gives explicit approval for the named capability and environment.

Approval for one capability does not enable another. Approval for local restore
does not authorize preview or production deployment.

## Tabletop contract

`npm run security:operations:tabletop` deterministically proves that the default
incident posture disables all eight independent capabilities, isolates a suspect
source, excludes and deletes a revoked export and derived index, limits restore
to offline validation, requires regression capture, escalates to Carl, and
reenables nothing without explicit approval. Its passing result is development
evidence only.

`npm run security:release:check` is stricter: it exits nonzero unless the exact
release packet contains current, passing, hash-matched deterministic, live-model,
privacy, owner-approval, and deployment evidence. Missing deployment evidence is
expected to block local development work; it must never be relabeled as skipped
or inferred from a local build.
