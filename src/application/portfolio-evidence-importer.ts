import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  CareerEvidenceStore,
  CareerMaturity,
  CareerRelationshipKind,
} from "../domain/career-evidence.js";

const architectureNodeSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  detail: z.string().trim().min(1),
});

const projectEvidenceSchema = z.union([
  z.string().trim().min(1),
  z.object({
    text: z.string().trim().min(1),
  }).passthrough(),
]);

const projectSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  status: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  stack: z.array(z.string().trim().min(1)),
  architecture: z.array(architectureNodeSchema),
  evidence: z.array(projectEvidenceSchema),
  boundaries: z.array(z.string().trim().min(1)),
  repositoryUrl: z.string().url(),
  liveUrl: z.string().url().optional(),
}).passthrough();

const experienceSchema = z.object({
  id: z.string().trim().min(1),
  company: z.string().trim().min(1),
  role: z.string().trim().min(1),
  dates: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  stack: z.array(z.string().trim().min(1)),
});

const recommendationSchema = z.object({
  name: z.string().trim().min(1),
  headline: z.string().trim().min(1).nullable(),
  date: z.string().trim().min(1),
  relationship: z.string().trim().min(1),
  quote: z.string().trim().min(1),
});

const capabilityReferenceSchema = z.object({
  kind: z.enum(["project", "repository", "company", "recommendations"]),
  id: z.string().trim().min(1),
});

const capabilitySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  practices: z.array(z.string().trim().min(1)),
  evidence: z.array(z.object({
    label: z.string().trim().min(1),
    detail: z.string().trim().min(1),
    href: z.string().trim().min(1),
    source: z.enum(["Case study", "Repository", "Experience", "Recommendation"]),
    reference: capabilityReferenceSchema,
  })),
}).passthrough();

const portfolioSnapshotSchema = z.object({
  projects: z.array(projectSchema),
  experience: z.array(experienceSchema),
  recommendations: z.array(recommendationSchema),
  capabilities: z.array(capabilitySchema),
});

export interface PortfolioEvidenceImportInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly capturedAt: string;
  readonly snapshot: unknown;
}

export interface PortfolioEvidenceImportReport {
  readonly sourceCount: number;
  readonly claimCount: number;
  readonly relationshipCount: number;
  readonly validationIssueCount: number;
  readonly publicClaimCount: number;
}

export class PortfolioEvidenceImporter {
  constructor(private readonly store: CareerEvidenceStore) {}

  import(input: PortfolioEvidenceImportInput): PortfolioEvidenceImportReport {
    const snapshot = portfolioSnapshotSchema.parse(input.snapshot);
    const scope = {
      actorId: requireText(input.actorId, "actorId"),
      workspaceId: requireText(input.workspaceId, "workspaceId"),
    };
    const capturedAt = new Date(input.capturedAt).toISOString();

    for (const project of snapshot.projects) {
      const sourceId = `portfolio:project:${project.slug}`;
      this.store.upsertSource({
        id: sourceId,
        ...scope,
        sourceType: "project",
        title: project.name,
        provenanceRef: `site/app/portfolio-data.ts#projects.${project.slug}`,
        provenanceUri: `/work/${encodeURIComponent(project.slug)}#evidence`,
        sourceHash: hashRecord(project),
        capturedAt,
      });
      const contribution = "Imported portfolio candidate; Carl's role and contribution require review.";
      this.store.upsertDraftClaim({
        ...scope,
        sourceId,
        logicalKey: "summary",
        title: `${project.name} summary`,
        proposition: project.summary,
        contribution,
        maturity: maturityFromStatus(project.status),
      });
      project.evidence.forEach((evidence, index) => {
        const proposition = typeof evidence === "string" ? evidence : evidence.text;
        this.store.upsertDraftClaim({
          ...scope,
          sourceId,
          logicalKey: `evidence:${index}`,
          title: `${project.name} evidence ${index + 1}`,
          proposition,
          contribution,
          maturity: maturityFromStatus(project.status),
        });
      });
      project.boundaries.forEach((proposition, index) => {
        this.store.upsertDraftClaim({
          ...scope,
          sourceId,
          logicalKey: `boundary:${index}`,
          title: `${project.name} boundary ${index + 1}`,
          proposition,
          contribution: "Status and use boundary imported from the portfolio; requires review.",
          maturity: maturityFromStatus(project.status),
        });
      });
      project.stack.forEach((skill) => {
        this.store.upsertRelationship({
          id: `portfolio:project:${project.slug}:skill:${slug(skill)}`,
          ...scope,
          sourceId,
          claimId: null,
          fromKind: "project",
          fromId: project.slug,
          relationship: "uses_skill",
          toKind: "skill",
          toId: skill,
        });
      });
    }

    for (const role of snapshot.experience) {
      const sourceId = `portfolio:experience:${role.id}`;
      this.store.upsertSource({
        id: sourceId,
        ...scope,
        sourceType: "employer_history",
        title: `${role.role} at ${role.company}`,
        provenanceRef: `site/app/portfolio-data.ts#experience.${role.id}`,
        provenanceUri: `/experience#${role.id}`,
        sourceHash: hashRecord(role),
        capturedAt,
      });
      const claim = this.store.upsertDraftClaim({
        ...scope,
        sourceId,
        logicalKey: "role-summary",
        title: `${role.role} at ${role.company}`,
        proposition: `${role.dates}: ${role.summary}`,
        contribution: "Professional role summary imported from the portfolio; employment and wording require review.",
        maturity: "not_applicable",
      });
      this.store.upsertRelationship({
        id: `portfolio:experience:${role.id}:employer`,
        ...scope,
        sourceId,
        claimId: claim.id,
        fromKind: "role",
        fromId: role.id,
        relationship: "employed_by",
        toKind: "employer",
        toId: role.company,
      });
      role.stack.forEach((skill) => {
        this.store.upsertRelationship({
          id: `portfolio:experience:${role.id}:skill:${slug(skill)}`,
          ...scope,
          sourceId,
          claimId: claim.id,
          fromKind: "role",
          fromId: role.id,
          relationship: "uses_skill",
          toKind: "skill",
          toId: skill,
        });
      });
    }

    snapshot.recommendations.forEach((recommendation, index) => {
      const stableKey = `${slug(recommendation.name)}:${slug(recommendation.date)}`;
      const sourceId = `portfolio:recommendation:${stableKey}`;
      this.store.upsertSource({
        id: sourceId,
        ...scope,
        sourceType: "recommendation",
        title: `Recommendation from ${recommendation.name}`,
        provenanceRef: `site/app/recommendations-data.ts#recommendations.${index}`,
        provenanceUri: "/recommendations",
        sourceHash: hashRecord(recommendation),
        capturedAt,
      });
      const claim = this.store.upsertDraftClaim({
        ...scope,
        sourceId,
        logicalKey: "quotation",
        title: `Recommendation from ${recommendation.name}`,
        proposition: recommendation.quote,
        contribution: `Third-party statement attributed to ${recommendation.name} (${recommendation.relationship}); exact wording and publication rights require reconciliation.`,
        maturity: "not_applicable",
      });
      this.store.upsertRelationship({
        id: `${sourceId}:recommender-support`,
        ...scope,
        sourceId,
        claimId: claim.id,
        fromKind: "person",
        fromId: slug(recommendation.name),
        relationship: "supports",
        toKind: "person",
        toId: scope.actorId,
      });
    });

    for (const capability of snapshot.capabilities) {
      const sourceId = `portfolio:capability:${capability.id}`;
      this.store.upsertSource({
        id: sourceId,
        ...scope,
        sourceType: "portfolio_page",
        title: capability.name,
        provenanceRef: `site/app/capabilities-data.ts#capabilities.${capability.id}`,
        provenanceUri: "/capabilities",
        sourceHash: hashRecord(capability),
        capturedAt,
      });
      const claim = this.store.upsertDraftClaim({
        ...scope,
        sourceId,
        logicalKey: "summary",
        title: capability.name,
        proposition: capability.summary,
        contribution: "Portfolio capability synthesis; every supporting reference requires review.",
        maturity: "not_applicable",
      });
      capability.evidence.forEach((evidence, index) => {
        const relation = relationshipForReference(evidence.reference.kind);
        const toKind = entityKindForReference(evidence.reference.kind);
        this.store.upsertRelationship({
          id: `portfolio:capability:${capability.id}:evidence:${index}`,
          ...scope,
          sourceId,
          claimId: claim.id,
          fromKind: "capability",
          fromId: capability.id,
          relationship: relation,
          toKind,
          toId: evidence.reference.id,
        });
      });
    }

    const sources = this.store.listSources(scope);
    const claims = this.store.listClaims(scope);
    const relationships = this.store.listRelationships(scope);
    return {
      sourceCount: sources.length,
      claimCount: claims.filter((claim) => claim.state === "active").length,
      relationshipCount: relationships.filter((relationship) => relationship.state === "active").length,
      validationIssueCount: this.store.validate(scope).length,
      publicClaimCount: this.store.listPublicClaims(scope).length,
    };
  }
}

function hashRecord(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function maturityFromStatus(status: string): CareerMaturity {
  const normalized = status.toLowerCase();
  if (normalized.includes("pre-release") || normalized.includes("tester")) return "pre_release";
  if (normalized.includes("deployed") && normalized.includes("demo")) return "deployed_demo";
  if (normalized.includes("production")) return "production";
  if (normalized.includes("prototype")) return "prototype";
  if (normalized.includes("plan")) return "planning";
  return "development";
}

function entityKindForReference(
  kind: "project" | "repository" | "company" | "recommendations",
): "project" | "artifact" | "employer" {
  if (kind === "project") return "project";
  if (kind === "company") return "employer";
  return "artifact";
}

function relationshipForReference(
  kind: "project" | "repository" | "company" | "recommendations",
): CareerRelationshipKind {
  return kind === "company" ? "demonstrates" : "supports";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError(`${field} cannot be empty.`);
  return trimmed;
}
