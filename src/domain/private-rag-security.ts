import type {
  PrivateRagDerivation,
  PrivateRagRiskSignal,
} from "./private-rag-policy.js";

export interface PrivateRagSecurityScope {
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface PrivateRagQuarantineRecord extends PrivateRagSecurityScope {
  readonly id: string;
  readonly eventId: string;
  readonly parentFingerprint: string;
  readonly taintIds: readonly string[];
  readonly riskSignals: readonly PrivateRagRiskSignal[];
  readonly status: "quarantined" | "released";
  readonly quarantinedAt: string;
  readonly releasedAt: string | null;
}

export interface RecordPrivateRagQuarantineInput extends PrivateRagSecurityScope {
  readonly eventId: string;
  readonly parentFingerprint: string;
  readonly taintIds: readonly string[];
  readonly riskSignals: readonly PrivateRagRiskSignal[];
  readonly quarantinedAt: string;
}

export interface InvalidatePrivateRagInput extends PrivateRagSecurityScope {
  readonly parentFingerprints: readonly string[];
  readonly reason:
    | "parent_revoked"
    | "parent_quarantined"
    | "turn_reset"
    | "policy_changed";
  readonly invalidatedAt: string;
}

export interface PrivateRagInvalidationReport {
  readonly invalidatedIds: readonly string[];
  readonly invalidatedOutputFingerprints: readonly string[];
}

export interface PrivateRagSecurityStore {
  recordQuarantine(
    input: RecordPrivateRagQuarantineInput,
  ): PrivateRagQuarantineRecord;
  listActiveQuarantineTaintIds(scope: PrivateRagSecurityScope): readonly string[];
  listQuarantines(
    scope: PrivateRagSecurityScope,
    limit: number,
  ): readonly PrivateRagQuarantineRecord[];
  releaseQuarantineByTaint(
    scope: PrivateRagSecurityScope,
    taintId: string,
    releasedAt: string,
  ): number;
  recordDerivation(record: PrivateRagDerivation): PrivateRagDerivation;
  listDerivations(
    scope: PrivateRagSecurityScope,
    limit: number,
  ): readonly PrivateRagDerivation[];
  invalidateDerivations(
    input: InvalidatePrivateRagInput,
  ): PrivateRagInvalidationReport;
  resetTurn(
    scope: PrivateRagSecurityScope,
    eventId: string,
    invalidatedAt: string,
  ): PrivateRagInvalidationReport;
  close(): void;
}
