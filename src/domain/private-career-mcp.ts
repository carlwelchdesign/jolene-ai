import type { CareerEvidenceScope } from "./career-evidence.js";

export const PRIVATE_CAREER_MCP_TOOLS = [
  "career_search",
  "career_inspect",
  "career_compare_job",
] as const;

export type PrivateCareerMcpTool = typeof PRIVATE_CAREER_MCP_TOOLS[number];
export type PrivateCareerMcpOutcome = "completed" | "refused" | "failed";

export interface PrivateCareerMcpAccessRecord {
  readonly id: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly tool: PrivateCareerMcpTool;
  readonly requestFingerprint: string;
  readonly outcome: PrivateCareerMcpOutcome;
  readonly resultCount: number;
  readonly evidenceIds: readonly string[];
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface RecordPrivateCareerMcpAccessInput {
  readonly eventId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly tool: PrivateCareerMcpTool;
  readonly requestFingerprint: string;
  readonly outcome: PrivateCareerMcpOutcome;
  readonly resultCount: number;
  readonly evidenceIds: readonly string[];
  readonly errorCode: string | null;
}

export interface PrivateCareerMcpAuditStore {
  recordAccess(
    input: RecordPrivateCareerMcpAccessInput,
  ): PrivateCareerMcpAccessRecord;
  listAccesses(
    scope: CareerEvidenceScope,
    clientId: string,
    limit: number,
  ): readonly PrivateCareerMcpAccessRecord[];
  close(): void;
}

export class PrivateCareerMcpToolError extends Error {
  constructor(readonly code: "invalid_request" | "unavailable") {
    super(code === "invalid_request"
      ? "The private career tool request is invalid."
      : "The private career tool is unavailable.");
    this.name = "PrivateCareerMcpToolError";
  }
}
