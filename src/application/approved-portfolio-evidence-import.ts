import {
  portfolioEvidenceImportReviewPacketSchema,
  type PortfolioEvidenceImportReviewPacket,
} from "../domain/portfolio-evidence-import-review.js";
import { SqliteCareerEvidenceStore } from "../persistence/sqlite-career-evidence-store.js";
import {
  createPortfolioEvidenceImportReviewPacket,
  portfolioEvidenceImportReviewPacketHash,
} from "./portfolio-evidence-import-audit.js";
import {
  PortfolioEvidenceImporter,
  type PortfolioEvidenceImportInput,
} from "./portfolio-evidence-importer.js";

export interface ApplyApprovedPortfolioEvidenceImportInput {
  readonly databasePath: string;
  readonly expectedPacketHash: string;
  readonly importInput: PortfolioEvidenceImportInput;
  readonly packet: PortfolioEvidenceImportReviewPacket;
  readonly reviewerId: string;
}

export interface ApplyApprovedPortfolioEvidenceImportResult {
  readonly packetHash: string;
  readonly approvedSources: number;
  readonly approvedClaims: number;
  readonly eligiblePublicClaims: number;
}

export class ApprovedPortfolioEvidenceImportConflictError extends Error {
  constructor(message = "The approved portfolio evidence packet no longer matches the current import.") {
    super(message);
    this.name = "ApprovedPortfolioEvidenceImportConflictError";
  }
}

export async function applyApprovedPortfolioEvidenceImport(
  input: ApplyApprovedPortfolioEvidenceImportInput,
): Promise<ApplyApprovedPortfolioEvidenceImportResult> {
  const packet = portfolioEvidenceImportReviewPacketSchema.parse(input.packet);
  const { packetHash: _packetHash, generatedAt: _generatedAt, ...payload } = packet;
  const computedHash = portfolioEvidenceImportReviewPacketHash(payload);
  if (computedHash !== packet.packetHash || input.expectedPacketHash !== packet.packetHash) {
    throw new ApprovedPortfolioEvidenceImportConflictError(
      "The approved packet hash is invalid or was not explicitly selected.",
    );
  }

  const current = await createPortfolioEvidenceImportReviewPacket({
    databasePath: input.databasePath,
    importInput: input.importInput,
  });
  if (current.packetHash !== packet.packetHash) {
    throw new ApprovedPortfolioEvidenceImportConflictError();
  }

  const scope = {
    actorId: input.importInput.actorId,
    workspaceId: input.importInput.workspaceId,
  };
  const store = new SqliteCareerEvidenceStore(input.databasePath);
  try {
    return store.runInTransaction(() => {
      new PortfolioEvidenceImporter(store).import(input.importInput);
      const sources = new Map(store.listSources(scope).map((source) => [source.id, source]));
      const claims = store.listClaims(scope).filter((claim) => claim.state === "active");
      const sourceIds: string[] = [];
      const claimIds: string[] = [];

      for (const reviewedSource of packet.sources) {
        const source = sources.get(reviewedSource.sourceId);
        if (!source || !source.provenanceUri ||
          source.title !== reviewedSource.after.title ||
          source.sourceType !== reviewedSource.after.sourceType ||
          source.provenanceUri !== reviewedSource.after.publicCitation ||
          source.sourceHash !== reviewedSource.after.contentHash) {
          throw new ApprovedPortfolioEvidenceImportConflictError();
        }
        sourceIds.push(source.id);

        for (const reviewedClaim of reviewedSource.claims) {
          if (!reviewedClaim.after) continue;
          const claim = claims.find((candidate) =>
            candidate.sourceId === source.id && candidate.logicalKey === reviewedClaim.logicalKey
          );
          if (!claim || claim.title !== reviewedClaim.after.title ||
            claim.proposition !== reviewedClaim.after.text ||
            claim.contribution !== reviewedClaim.after.contribution ||
            claim.maturity !== reviewedClaim.after.maturity) {
            throw new ApprovedPortfolioEvidenceImportConflictError();
          }
          claimIds.push(claim.id);
        }
      }

      store.approvePublicEvidenceBatch({
        ...scope,
        sourceIds,
        claimIds,
        reviewerId: input.reviewerId,
      });
      return {
        packetHash: packet.packetHash,
        approvedSources: sourceIds.length,
        approvedClaims: claimIds.length,
        eligiblePublicClaims: store.listPublicClaims(scope).length,
      };
    });
  } finally {
    store.close();
  }
}
