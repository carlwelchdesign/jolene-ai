import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type { CareerEvidenceService } from
  "../application/career-evidence-service.js";
import type { CareerRetrievalService } from
  "../application/career-retrieval-service.js";
import {
  isCareerEvidenceEligible,
  type CareerRetrievalResult,
} from "../domain/career-retrieval.js";
import type {
  CareerClaim,
  CareerClaimConflict,
  CareerEvidenceScope,
  CareerSource,
} from "../domain/career-evidence.js";
import { careerMaturitySchema, careerVisibilitySchema } from
  "../domain/career-evidence.js";
import { tokenizeLexicalTerms } from "../domain/lexical-terms.js";
import {
  PrivateCareerMcpToolError,
  type PrivateCareerMcpAuditStore,
  type PrivateCareerMcpOutcome,
  type PrivateCareerMcpTool,
} from "../domain/private-career-mcp.js";

const identitySchema = z.string().trim().min(2).max(120);
const claimIdSchema = z.string().uuid();
const strengthSchema = z.literal("limited");
const conflictStatusSchema = z.enum(["clear", "unresolved"]);
const approvedVisibilitySchema = careerVisibilitySchema.extract([
  "internal_approved",
  "public_approved",
]);

export const privateCareerSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(1_000),
  limit: z.number().int().min(1).max(8).default(5),
}).strict();

export const privateCareerInspectInputSchema = z.object({
  claimId: claimIdSchema,
}).strict();

export const privateCareerCompareJobInputSchema = z.object({
  jobDescription: z.string().trim().min(1).max(12_000)
    .refine((value) => /[\p{L}\p{N}]/u.test(value), {
      message: "Job description must contain a letter or number.",
    }),
  maxRequirements: z.number().int().min(1).max(12).default(8),
}).strict();

const citationSchema = z.object({
  sourceId: z.string().trim().min(1).max(240),
  sourceTitle: z.string().trim().min(1).max(240),
  provenanceRef: z.string().max(2_000).nullable(),
  provenanceUri: z.string().max(2_000).nullable(),
  sourceReviewedAt: z.string().datetime({ offset: true }),
  claimReviewedAt: z.string().datetime({ offset: true }),
}).strict();

const evidenceRecordSchema = z.object({
  claimId: claimIdSchema,
  title: z.string().trim().min(1).max(240),
  proposition: z.string().trim().min(1).max(4_000),
  contribution: z.string().max(4_000),
  maturity: careerMaturitySchema,
  visibility: approvedVisibilitySchema,
  evidenceStrength: strengthSchema,
  conflictStatus: conflictStatusSchema,
  citation: citationSchema,
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(4),
}).strict();

export const privateCareerSearchOutputSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  mode: z.enum(["hybrid", "lexical_fallback"]),
  results: z.array(evidenceRecordSchema).max(8),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(6),
}).strict();

export const privateCareerInspectOutputSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  found: z.boolean(),
  record: evidenceRecordSchema.nullable(),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(6),
}).strict().superRefine((output, context) => {
  if (output.found !== (output.record !== null)) {
    context.addIssue({
      code: "custom",
      message: "Found state must match record availability.",
    });
  }
});

const jobRequirementSchema = z.object({
  requirementId: z.string().regex(/^req:[a-f0-9]{16}$/),
  requirement: z.string().trim().min(1).max(600),
  assessment: z.enum(["direct", "adjacent", "unknown"]),
  explanation: z.string().trim().min(1).max(1_000),
  evidenceIds: z.array(claimIdSchema).max(3),
  limitations: z.array(z.string().trim().min(1).max(1_000)).max(4),
}).strict();

export const privateCareerCompareJobOutputSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  requirements: z.array(jobRequirementSchema).min(1).max(12),
  evidence: z.array(evidenceRecordSchema).max(36),
  caveats: z.array(z.string().trim().min(1).max(1_000)).min(1).max(8),
}).strict();

export type PrivateCareerSearchOutput = z.infer<
  typeof privateCareerSearchOutputSchema
>;
export type PrivateCareerInspectOutput = z.infer<
  typeof privateCareerInspectOutputSchema
>;
export type PrivateCareerCompareJobOutput = z.infer<
  typeof privateCareerCompareJobOutputSchema
>;

interface ServiceOptions {
  readonly retrieval: CareerRetrievalService;
  readonly evidence: CareerEvidenceService;
  readonly audit: PrivateCareerMcpAuditStore;
  readonly scope: CareerEvidenceScope;
  readonly clientId: string;
  readonly now?: () => Date;
  readonly fingerprintKey?: Buffer;
}

interface OperationResult<Output> {
  readonly output: Output;
  readonly evidenceIds: readonly string[];
  readonly outcome?: PrivateCareerMcpOutcome;
  readonly errorCode?: string | null;
}

interface EvidenceSnapshot {
  readonly claims: ReadonlyMap<string, CareerClaim>;
  readonly sources: ReadonlyMap<string, CareerSource>;
  readonly conflictedClaimIds: ReadonlySet<string>;
}

export class PrivateCareerMcpService {
  private readonly now: () => Date;
  private readonly fingerprintKey: Buffer;

  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.fingerprintKey = options.fingerprintKey ?? randomBytes(32);
  }

  search(input: unknown): Promise<PrivateCareerSearchOutput> {
    return this.execute(
      "career_search",
      input,
      privateCareerSearchInputSchema,
      async (request, eventId) => {
        const response = await this.options.retrieval.search({
          query: request.query,
          limit: request.limit,
          context: this.context("career_search", eventId),
        });
        const snapshot = this.snapshot();
        const results = response.results.flatMap((result) => {
          const record = this.mapResult(result, snapshot);
          return record ? [record] : [];
        });
        return {
          output: privateCareerSearchOutputSchema.parse({
            schemaVersion: "1.0.0",
            mode: response.mode,
            results,
            limitations: PRIVATE_LIMITATIONS,
          }),
          evidenceIds: results.map((result) => result.claimId),
        };
      },
    );
  }

  inspect(input: unknown): Promise<PrivateCareerInspectOutput> {
    return this.execute(
      "career_inspect",
      input,
      privateCareerInspectInputSchema,
      async (request) => {
        const snapshot = this.snapshot();
        const claim = snapshot.claims.get(request.claimId);
        const source = claim ? snapshot.sources.get(claim.sourceId) : undefined;
        const record = claim && source &&
            isCareerEvidenceEligible(source, claim, this.now())
          ? mapEvidenceRecord(
              claim,
              source,
              snapshot.conflictedClaimIds.has(claim.id),
            )
          : null;
        return {
          output: privateCareerInspectOutputSchema.parse({
            schemaVersion: "1.0.0",
            found: record !== null,
            record,
            limitations: record ? PRIVATE_LIMITATIONS : [
              "The requested evidence is unavailable in the approved current scope.",
            ],
          }),
          evidenceIds: record ? [record.claimId] : [],
          outcome: record ? "completed" : "refused",
          errorCode: record ? null : "evidence_unavailable",
        };
      },
    );
  }

  compareJob(input: unknown): Promise<PrivateCareerCompareJobOutput> {
    return this.execute(
      "career_compare_job",
      input,
      privateCareerCompareJobInputSchema,
      async (request, eventId) => {
        const requirements = segmentRequirements(
          request.jobDescription,
          request.maxRequirements,
        );
        if (looksLikeInstructionInjection(request.jobDescription)) {
          return {
            output: privateCareerCompareJobOutputSchema.parse({
              schemaVersion: "1.0.0",
              requirements: requirements.map(unknownRequirement),
              evidence: [],
              caveats: [...JOB_CAVEATS, INSTRUCTION_CAVEAT],
            }),
            evidenceIds: [],
            outcome: "refused",
            errorCode: "instruction_like_input",
          };
        }

        const snapshot = this.snapshot();
        const results = [] as Array<z.infer<typeof jobRequirementSchema>>;
        const usedEvidence = new Map<string, z.infer<typeof evidenceRecordSchema>>();
        for (const [index, requirement] of requirements.entries()) {
          const response = await this.options.retrieval.search({
            query: requirement,
            limit: 3,
            context: this.context(
              "career_compare_job",
              `${eventId}:${index}`,
            ),
          });
          const candidates = response.results.flatMap((result) => {
            const record = this.mapResult(result, snapshot);
            return record && record.conflictStatus === "clear"
              ? [record]
              : [];
          });
          const assessment = assessRequirement(requirement, candidates);
          results.push(assessment);
          candidates
            .filter((record) => assessment.evidenceIds.includes(record.claimId))
            .forEach((record) => usedEvidence.set(record.claimId, record));
        }
        const evidence = [...usedEvidence.values()].sort((left, right) =>
          left.claimId.localeCompare(right.claimId)
        );
        return {
          output: privateCareerCompareJobOutputSchema.parse({
            schemaVersion: "1.0.0",
            requirements: results,
            evidence,
            caveats: [
              ...JOB_CAVEATS,
              ...(snapshot.conflictedClaimIds.size > 0
                ? ["Evidence in unresolved conflict groups is excluded from assessments."]
                : []),
            ],
          }),
          evidenceIds: evidence.map((record) => record.claimId),
        };
      },
    );
  }

  private async execute<Input, Output>(
    tool: PrivateCareerMcpTool,
    input: unknown,
    schema: z.ZodType<Input>,
    operation: (
      parsed: Input,
      eventId: string,
    ) => Promise<OperationResult<Output>>,
  ): Promise<Output> {
    const eventId = `mcp:${randomUUID()}`;
    const requestFingerprint = createHmac("sha256", this.fingerprintKey)
      .update(canonicalJson(input))
      .digest("hex");
    let parsed: Input;
    try {
      parsed = schema.parse(input);
    } catch {
      this.recordOrThrow({
        eventId,
        tool,
        requestFingerprint,
        outcome: "refused",
        resultCount: 0,
        evidenceIds: [],
        errorCode: "invalid_request",
      });
      throw new PrivateCareerMcpToolError("invalid_request");
    }

    try {
      const result = await operation(parsed, eventId);
      this.recordOrThrow({
        eventId,
        tool,
        requestFingerprint,
        outcome: result.outcome ?? "completed",
        resultCount: result.evidenceIds.length,
        evidenceIds: result.evidenceIds,
        errorCode: result.errorCode ?? null,
      });
      return result.output;
    } catch (error) {
      if (error instanceof PrivateCareerMcpToolError) throw error;
      try {
        this.options.audit.recordAccess({
          eventId,
          ...this.options.scope,
          clientId: this.options.clientId,
          tool,
          requestFingerprint,
          outcome: "failed",
          resultCount: 0,
          evidenceIds: [],
          errorCode: "unavailable",
        });
      } catch {
        // No data is returned when either the operation or its audit fails.
      }
      throw new PrivateCareerMcpToolError("unavailable");
    }
  }

  private recordOrThrow(input: {
    readonly eventId: string;
    readonly tool: PrivateCareerMcpTool;
    readonly requestFingerprint: string;
    readonly outcome: PrivateCareerMcpOutcome;
    readonly resultCount: number;
    readonly evidenceIds: readonly string[];
    readonly errorCode: string | null;
  }): void {
    try {
      this.options.audit.recordAccess({
        ...input,
        ...this.options.scope,
        clientId: this.options.clientId,
      });
    } catch {
      throw new PrivateCareerMcpToolError("unavailable");
    }
  }

  private context(tool: PrivateCareerMcpTool, eventId: string) {
    return {
      eventId,
      ...this.options.scope,
      channelKind: "cli" as const,
      channelId: `mcp:${this.options.clientId}`,
      threadId: `mcp:${tool}`,
    };
  }

  private snapshot(): EvidenceSnapshot {
    const claims = this.options.evidence.listClaims(this.options.scope);
    const sources = this.options.evidence.listSources(this.options.scope);
    const conflicts = this.options.evidence.listClaimConflicts(this.options.scope);
    return {
      claims: new Map(claims.map((claim) => [claim.id, claim])),
      sources: new Map(sources.map((source) => [source.id, source])),
      conflictedClaimIds: unresolvedClaimIds(conflicts),
    };
  }

  private mapResult(
    result: CareerRetrievalResult,
    snapshot: EvidenceSnapshot,
  ): z.infer<typeof evidenceRecordSchema> | null {
    const claim = snapshot.claims.get(result.citation.claimId);
    const source = claim ? snapshot.sources.get(claim.sourceId) : undefined;
    if (!claim || !source || !isCareerEvidenceEligible(source, claim, this.now())) {
      return null;
    }
    return mapEvidenceRecord(
      claim,
      source,
      snapshot.conflictedClaimIds.has(claim.id),
    );
  }
}

function mapEvidenceRecord(
  claim: CareerClaim,
  source: CareerSource,
  conflicted: boolean,
): z.infer<typeof evidenceRecordSchema> {
  if (!source.lastReviewedAt || !claim.lastReviewedAt) {
    throw new Error("Approved career evidence is missing review timestamps.");
  }
  return evidenceRecordSchema.parse({
    claimId: claim.id,
    title: claim.title,
    proposition: claim.proposition,
    contribution: claim.contribution,
    maturity: claim.maturity,
    visibility: claim.visibility,
    evidenceStrength: "limited",
    conflictStatus: conflicted ? "unresolved" : "clear",
    citation: {
      sourceId: source.id,
      sourceTitle: source.title,
      provenanceRef: source.provenanceRef,
      provenanceUri: source.provenanceUri,
      sourceReviewedAt: source.lastReviewedAt,
      claimReviewedAt: claim.lastReviewedAt,
    },
    limitations: [
      "Evidence strength remains limited until an explicit owner-reviewed strength field exists.",
      ...(conflicted
        ? ["This claim belongs to an unresolved evidence conflict group."]
        : []),
    ],
  });
}

function unresolvedClaimIds(
  conflicts: readonly CareerClaimConflict[],
): ReadonlySet<string> {
  return new Set(conflicts
    .filter((conflict) => conflict.state === "unresolved")
    .flatMap((conflict) => conflict.claimIds));
}

function segmentRequirements(value: string, maximum: number): string[] {
  return [...new Set(value
    .split(/\r?\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/u))
    .map((segment) => segment.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, ""))
    .map((segment) => segment.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .map((segment) => segment.slice(0, 600)))]
    .slice(0, maximum);
}

function assessRequirement(
  requirement: string,
  candidates: readonly z.infer<typeof evidenceRecordSchema>[],
): z.infer<typeof jobRequirementSchema> {
  const terms = meaningfulTerms(requirement);
  const ranked = candidates.map((record) => ({
    record,
    overlap: overlapCount(record, terms),
  })).filter((item) => item.overlap > 0)
    .sort((left, right) =>
      right.overlap - left.overlap ||
      left.record.claimId.localeCompare(right.record.claimId)
    )
    .slice(0, 3);
  const best = ranked[0]?.overlap ?? 0;
  const coverage = terms.length === 0 ? 0 : best / terms.length;
  const assessment = best === 0
    ? "unknown" as const
    : best === terms.length || (best >= 2 && coverage >= 0.6)
      ? "direct" as const
      : "adjacent" as const;
  return jobRequirementSchema.parse({
    requirementId: requirementId(requirement),
    requirement,
    assessment,
    explanation: assessment === "unknown"
      ? "The reviewed private evidence does not establish this requirement."
      : assessment === "direct"
        ? "Reviewed private evidence directly overlaps the stated requirement."
        : "Reviewed private evidence is relevant but does not establish the full requirement.",
    evidenceIds: ranked.map((item) => item.record.claimId),
    limitations: assessment === "unknown"
      ? ["Unknown does not mean Carl lacks this experience."]
      : unique(ranked.flatMap((item) => item.record.limitations)).slice(0, 4),
  });
}

function unknownRequirement(requirement: string) {
  return jobRequirementSchema.parse({
    requirementId: requirementId(requirement),
    requirement,
    assessment: "unknown",
    explanation: "Instruction-like input was not used to retrieve private evidence.",
    evidenceIds: [],
    limitations: ["No conclusion about Carl's experience was drawn from this input."],
  });
}

function overlapCount(
  record: z.infer<typeof evidenceRecordSchema>,
  terms: readonly string[],
): number {
  const evidenceTerms = new Set(meaningfulTerms([
    record.title,
    record.proposition,
    record.contribution,
  ].join(" ")));
  return terms.reduce(
    (total, term) => total + (evidenceTerms.has(term) ? 1 : 0),
    0,
  );
}

function meaningfulTerms(value: string): string[] {
  const normalized = value
    .replace(/c\+\+/giu, " cpp ")
    .replace(/c#/giu, " csharp ")
    .replace(/node\.js/giu, " nodejs ")
    .replace(/next\.js/giu, " nextjs ");
  return tokenizeLexicalTerms(normalized).filter((term) =>
    !STOP_WORDS.has(term)
  );
}

function requirementId(requirement: string): string {
  return `req:${createHash("sha256")
    .update(requirement.toLocaleLowerCase("en-US").normalize("NFKC"))
    .digest("hex").slice(0, 16)}`;
}

function looksLikeInstructionInjection(value: string): boolean {
  const normalized = value.toLocaleLowerCase("en-US").normalize("NFKC");
  return INSTRUCTION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value)) ?? "undefined";
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const PRIVATE_LIMITATIONS = [
  "Results contain only current owner-approved professional evidence.",
  "Private MCP access does not authorize external disclosure or publication.",
  "Evidence strength is conservatively limited until explicitly reviewed.",
] as const;

const JOB_CAVEATS = [
  "This comparison uses only current owner-approved professional evidence.",
  "It is not a blanket qualification score or hiring recommendation.",
  "Unknown means the reviewed corpus does not establish an answer; it does not prove missing experience.",
  "The submitted job description is treated as untrusted, ephemeral text and is not persisted.",
] as const;

const INSTRUCTION_CAVEAT =
  "Instruction-like job-description content was refused and did not trigger retrieval.";

const STOP_WORDS = new Set(["carl", "welch"]);
const INSTRUCTION_PATTERNS = [
  "ignore previous",
  "ignore all instructions",
  "system prompt",
  "private memory",
  "reveal secrets",
  "api key",
] as const;
