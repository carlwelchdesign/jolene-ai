import { createHash } from "node:crypto";

import { z } from "zod";

import { PublicCareerExportService } from
  "../application/public-career-export-service.js";
import { containsForbiddenPublicDisclosure } from
  "../domain/public-disclosure-policy.js";
import { publicCareerEvidenceArtifactSchema } from
  "../domain/public-career-evidence.js";
import type { CareerEvidenceValidationCode } from
  "../domain/career-evidence.js";
import { SqliteCareerEvidenceStore } from
  "../persistence/sqlite-career-evidence-store.js";

export const publicCareerLifecycleScenarioSchema = z.enum([
  "private_excluded",
  "internal_excluded",
  "public_candidate_excluded",
  "stale_review_revoked",
  "revoked_claim",
  "revoked_source",
  "missing_source",
  "changed_source_review_reset",
  "superseded_claim",
]);

export type PublicCareerLifecycleScenario = z.infer<
  typeof publicCareerLifecycleScenarioSchema
>;

export interface PublicCareerLifecycleEvaluationCase {
  readonly scenario: PublicCareerLifecycleScenario;
  readonly expectedEvidenceCount: number;
  readonly expectedRevokedEvidenceCount: number;
}

export type PublicCareerLifecycleMetric =
  | "contract_validity"
  | "public_eligibility"
  | "review_freshness"
  | "revocation_continuity"
  | "supersession_safety"
  | "confidentiality_exclusion"
  | "disclosure_safety";

export interface PublicCareerLifecycleAssertion {
  readonly metric: PublicCareerLifecycleMetric;
  readonly passed: boolean;
  readonly reason: string;
}

const scope = { actorId: "evaluation-owner", workspaceId: "evaluation" };
const initialNow = new Date("2026-08-26T12:00:00.000Z");

export function evaluatePublicCareerLifecycleCase(
  item: PublicCareerLifecycleEvaluationCase,
): readonly PublicCareerLifecycleAssertion[] {
  let now = initialNow;
  const store = new SqliteCareerEvidenceStore(":memory:", () => now);
  try {
    const sourceInput = {
      id: "evaluation:source",
      ...scope,
      sourceType: "project" as const,
      title: "Reviewed evaluation project",
      provenanceRef: "portfolio/evaluation-project",
      provenanceUri: "/work/evaluation-project#evidence",
      sourceHash: digest("evaluation-source-v1"),
      capturedAt: initialNow.toISOString(),
    };
    const source = store.upsertSource(sourceInput);
    const claim = store.upsertDraftClaim({
      ...scope,
      sourceId: source.id,
      logicalKey: "summary",
      title: "Evaluation claim",
      proposition: propositionFor(item.scenario),
      contribution: "Synthetic evaluation contribution boundary.",
      maturity: "production",
      visibility: item.scenario === "private_excluded"
        ? "private"
        : "public_candidate",
    });
    const service = new PublicCareerExportService(store, () => now);
    let previous = null;
    let replacement = null;

    if (item.scenario === "private_excluded") {
      approveSource(store, source.id);
    } else if (item.scenario === "internal_excluded") {
      approveSource(store, source.id);
      store.decideClaim({
        ...scope,
        id: claim.id,
        decision: "approve_internal",
        reviewerId: "evaluation-owner",
      });
    } else if (item.scenario === "public_candidate_excluded") {
      approveSource(store, source.id);
    } else {
      approvePublic(store, source.id, claim.id);
      previous = service.generate(scope);
      if (item.scenario === "stale_review_revoked") {
        now = new Date("2027-02-23T12:00:00.000Z");
      } else if (item.scenario === "revoked_claim") {
        store.revokeClaim(claim.id, scope);
      } else if (item.scenario === "revoked_source") {
        store.revokeSource(source.id, scope);
      } else if (item.scenario === "missing_source") {
        store.markSourceMissing(source.id, scope);
      } else if (item.scenario === "changed_source_review_reset") {
        store.upsertSource({
          ...sourceInput,
          sourceHash: digest("evaluation-source-v2"),
        });
      } else if (item.scenario === "superseded_claim") {
        replacement = store.upsertDraftClaim({
          ...scope,
          sourceId: source.id,
          logicalKey: "summary",
          title: "Corrected evaluation claim",
          proposition: "Corrected public candidate remains unreviewed.",
          contribution: "Synthetic corrected contribution boundary.",
          maturity: "production",
          visibility: "public_candidate",
        });
      }
    }

    const current = service.generate(scope, previous);
    const originalEvidenceId = `career:${claim.id}`;
    const validationCodes = new Set(
      store.validate(scope).map((issue) => issue.code),
    );
    const assertions: PublicCareerLifecycleAssertion[] = [
      assertion(
        "contract_validity",
        publicCareerEvidenceArtifactSchema.safeParse(current).success,
        "lifecycle_artifact_invalid",
      ),
      assertion(
        "public_eligibility",
        current.evidence.length === item.expectedEvidenceCount &&
          current.manifest.evidenceCount === item.expectedEvidenceCount &&
          current.manifest.revokedEvidenceIds.length ===
            item.expectedRevokedEvidenceCount,
        "lifecycle_counts_unexpected",
      ),
      assertion(
        "disclosure_safety",
        !containsForbiddenPublicDisclosure(current),
        "lifecycle_artifact_disclosure_unsafe",
      ),
    ];

    if (isConfidentialityScenario(item.scenario)) {
      assertions.push(assertion(
        "confidentiality_exclusion",
        current.evidence.length === 0 &&
          !JSON.stringify(current).includes(claim.proposition),
        "nonpublic_claim_exported",
      ));
    }
    if (previous) {
      assertions.push(assertion(
        "revocation_continuity",
        previous.evidence.some((record) =>
          record.evidenceId === originalEvidenceId
        ) &&
          current.evidence.every((record) =>
            record.evidenceId !== originalEvidenceId
          ) &&
          current.manifest.revokedEvidenceIds.includes(originalEvidenceId),
        "former_public_id_not_revoked",
      ));
    }
    if (item.scenario === "stale_review_revoked") {
      assertions.push(assertion(
        "review_freshness",
        hasCodes(validationCodes, ["source_review_stale", "claim_review_stale"]),
        "stale_review_not_detected",
      ));
    }
    if (item.scenario === "changed_source_review_reset") {
      assertions.push(assertion(
        "review_freshness",
        store.listSources(scope)[0]?.reviewState === "needs_review" &&
          validationCodes.has("source_review_required"),
        "changed_source_review_not_reset",
      ));
    }
    if (item.scenario === "superseded_claim") {
      const original = store.listClaims(scope).find((entry) => entry.id === claim.id);
      assertions.push(assertion(
        "supersession_safety",
        original?.state === "superseded" &&
          replacement?.state === "active" &&
          replacement.visibility === "public_candidate" &&
          replacement.reviewState === "needs_review" &&
          current.evidence.length === 0,
        "superseded_or_replacement_claim_exported",
      ));
    }
    return assertions;
  } finally {
    store.close();
  }
}

function approveSource(store: SqliteCareerEvidenceStore, sourceId: string): void {
  store.decideSource({
    ...scope,
    id: sourceId,
    decision: "approved",
    reviewerId: "evaluation-owner",
  });
}

function approvePublic(
  store: SqliteCareerEvidenceStore,
  sourceId: string,
  claimId: string,
): void {
  approveSource(store, sourceId);
  store.decideClaim({
    ...scope,
    id: claimId,
    decision: "approve_public",
    reviewerId: "evaluation-owner",
  });
}

function propositionFor(scenario: PublicCareerLifecycleScenario): string {
  return isConfidentialityScenario(scenario)
    ? `Synthetic ${scenario} proposition must not export.`
    : "Synthetic reviewed public lifecycle proposition.";
}

function isConfidentialityScenario(
  scenario: PublicCareerLifecycleScenario,
): boolean {
  return [
    "private_excluded",
    "internal_excluded",
    "public_candidate_excluded",
  ].includes(scenario);
}

function hasCodes(
  actual: ReadonlySet<CareerEvidenceValidationCode>,
  expected: readonly CareerEvidenceValidationCode[],
): boolean {
  return expected.every((code) => actual.has(code));
}

function assertion(
  metric: PublicCareerLifecycleMetric,
  passed: boolean,
  reason: string,
): PublicCareerLifecycleAssertion {
  return { metric, passed, reason };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
