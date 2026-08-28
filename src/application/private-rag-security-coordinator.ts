import { createHash, randomUUID } from "node:crypto";

import {
  gatePrivateRagProviderPayload,
  type PrivateRagProviderEntry,
  type PrivateRagProviderGateResult,
} from "./private-rag-provider-gate.js";
import { privateRagDerivationSchema } from
  "../domain/private-rag-policy.js";
import type {
  PrivateRagInvalidationReport,
  PrivateRagSecurityScope,
  PrivateRagSecurityStore,
} from "../domain/private-rag-security.js";
import type { PrivateRagTurnPolicy } from "../domain/private-rag-policy.js";

export class PrivateRagSecurityCoordinator {
  constructor(
    private readonly store: PrivateRagSecurityStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  gateProviderPayload(input: {
    readonly policy: PrivateRagTurnPolicy;
    readonly entries: readonly PrivateRagProviderEntry[];
    readonly queryTermCount: number;
  }): PrivateRagProviderGateResult {
    const scope = scopeFromPolicy(input.policy);
    const result = gatePrivateRagProviderPayload({
      ...input,
      blockedTaintIds: new Set(
        this.store.listActiveQuarantineTaintIds(scope),
      ),
    });
    const timestamp = this.now().toISOString();
    for (const candidate of result.quarantineCandidates) {
      this.store.recordQuarantine({
        ...scope,
        eventId: input.policy.eventId,
        parentFingerprint: candidate.parentFingerprint,
        taintIds: candidate.taintIds,
        riskSignals: candidate.riskSignals,
        quarantinedAt: timestamp,
      });
      this.store.invalidateDerivations({
        ...scope,
        parentFingerprints: [candidate.parentFingerprint],
        reason: "parent_quarantined",
        invalidatedAt: timestamp,
      });
    }
    for (const envelope of result.providerEnvelopes) {
      this.store.recordDerivation(privateRagDerivationSchema.parse({
        id: randomUUID(),
        eventId: input.policy.eventId,
        ...scope,
        destination: "model_copy",
        outputFingerprint: fingerprint(
          `model_copy:${input.policy.eventId}:${envelope.provenanceFingerprint}`,
        ),
        parentFingerprints: [envelope.provenanceFingerprint],
        taintIds: envelope.lineage.taintIds,
        status: "active",
        invalidationReason: null,
        createdAt: timestamp,
        invalidatedAt: null,
      }));
    }
    return result;
  }

  releaseQuarantine(
    scope: PrivateRagSecurityScope,
    taintId: string,
  ): number {
    return this.store.releaseQuarantineByTaint(
      scope,
      taintId,
      this.now().toISOString(),
    );
  }

  revokeParent(
    scope: PrivateRagSecurityScope,
    parentFingerprint: string,
  ): PrivateRagInvalidationReport {
    return this.store.invalidateDerivations({
      ...scope,
      parentFingerprints: [parentFingerprint],
      reason: "parent_revoked",
      invalidatedAt: this.now().toISOString(),
    });
  }

  resetTurn(
    scope: PrivateRagSecurityScope,
    eventId: string,
  ): PrivateRagInvalidationReport {
    return this.store.resetTurn(scope, eventId, this.now().toISOString());
  }
}

function scopeFromPolicy(policy: PrivateRagTurnPolicy) {
  return {
    actorId: policy.principal.actorId,
    workspaceId: policy.principal.workspaceId,
  };
}

function fingerprint(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
