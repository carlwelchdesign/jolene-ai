export type PersonalWorkflowKind =
  | "research"
  | "project_planning"
  | "drafting"
  | "repository_work"
  | "briefing"
  | "follow_up_preparation";

export type PersonalWorkflowStatus =
  | "active"
  | "awaiting_review"
  | "completed"
  | "cancelled";

export interface PersonalWorkflowTemplate {
  readonly kind: PersonalWorkflowKind;
  readonly label: string;
  readonly description: string;
  readonly steps: readonly PersonalWorkflowStep[];
}

export interface PersonalWorkflowStep {
  readonly id: string;
  readonly label: string;
  readonly completionEvidence: string;
}

export interface PersonalWorkflow {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly kind: PersonalWorkflowKind;
  readonly status: PersonalWorkflowStatus;
  readonly currentStepId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type PersonalWorkflowEventType =
  | "started"
  | "step_completed"
  | "submitted_for_review"
  | "approved"
  | "changes_requested"
  | "cancelled";

export interface PersonalWorkflowEvent {
  readonly id: string;
  readonly workflowId: string;
  readonly type: PersonalWorkflowEventType;
  readonly stepId: string | null;
  readonly summary: string;
  readonly createdAt: string;
}

export interface PersonalWorkflowDetail {
  readonly workflow: PersonalWorkflow;
  readonly template: PersonalWorkflowTemplate;
  readonly events: readonly PersonalWorkflowEvent[];
}

export interface StartPersonalWorkflowInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly kind: PersonalWorkflowKind;
}

export interface CompletePersonalWorkflowStepInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly stepId: string;
  readonly summary: string;
}

export interface ReviewPersonalWorkflowInput {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly decision: "approved" | "changes_requested" | "cancelled";
  readonly feedback: string;
  readonly returnToStepId: string | null;
}

export interface ListPersonalWorkflowsInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly taskId?: string;
  readonly status?: PersonalWorkflowStatus;
}

export interface PersonalWorkflowStore {
  start(input: StartPersonalWorkflowInput): PersonalWorkflowDetail;
  get(id: string, actorId: string, workspaceId: string): PersonalWorkflowDetail;
  list(input: ListPersonalWorkflowsInput): readonly PersonalWorkflow[];
  completeStep(input: CompletePersonalWorkflowStepInput): PersonalWorkflowDetail;
  review(input: ReviewPersonalWorkflowInput): PersonalWorkflowDetail;
  close(): void;
}

const TEMPLATES: readonly PersonalWorkflowTemplate[] = [
  template("research", "Research", "Produce a source-grounded answer or research packet.", [
    ["scope", "Confirm scope", "The question, boundaries, and success criteria are explicit."],
    ["source_plan", "Plan sources", "The required source types and evidence gaps are identified."],
    ["gather_evidence", "Gather evidence", "Claims are backed by captured sources and provenance."],
    ["synthesize", "Synthesize", "Findings, uncertainty, and conflicts are separated clearly."],
    ["review_packet", "Prepare review", "A reviewable answer or research packet is ready."],
  ]),
  template("project_planning", "Project planning", "Turn an objective into a reviewable delivery plan.", [
    ["outcome", "Define outcome", "The desired outcome and acceptance criteria are explicit."],
    ["constraints", "Map constraints", "Dependencies, boundaries, and non-goals are recorded."],
    ["milestones", "Sequence milestones", "Milestones have coherent order and verification gates."],
    ["risks", "Review risks", "Material risks have owners and mitigations."],
    ["review_packet", "Prepare review", "The plan is ready for human review."],
  ]),
  template("drafting", "Drafting", "Create and refine a reviewable written artifact.", [
    ["audience", "Confirm audience", "Audience, purpose, tone, and factual boundaries are explicit."],
    ["outline", "Build outline", "The structure covers the required content without unsupported claims."],
    ["draft", "Create draft", "A complete first draft exists."],
    ["revise", "Revise", "The draft has been checked for clarity, accuracy, and voice."],
    ["review_packet", "Prepare review", "The finished draft is ready for human review."],
  ]),
  template("repository_work", "Repository work", "Deliver a bounded, verified code change.", [
    ["inspect", "Inspect", "Repository instructions, status, boundaries, and extension points are known."],
    ["change_plan", "Plan change", "Acceptance criteria, design, tests, and non-goals are explicit."],
    ["implement", "Implement", "The bounded code and test changes are complete."],
    ["verify", "Verify", "Focused checks, broader checks, and diff hygiene have passed."],
    ["review_packet", "Prepare review", "Evidence, risks, and handoff state are ready for review."],
  ]),
  template("briefing", "Briefing", "Prepare a concise, prioritized situational briefing.", [
    ["scope", "Confirm scope", "Audience, time window, and decision needs are explicit."],
    ["gather_updates", "Gather updates", "Relevant updates are captured with source and freshness."],
    ["prioritize", "Prioritize", "Urgency, impact, and required decisions are separated."],
    ["draft", "Draft briefing", "The briefing is concise, grounded, and actionable."],
    ["review_packet", "Prepare review", "The briefing is ready for human review."],
  ]),
  template("follow_up_preparation", "Follow-up preparation", "Prepare a bounded follow-up without sending it.", [
    ["commitments", "Identify commitments", "Decisions, owners, deadlines, and open questions are explicit."],
    ["recipients", "Confirm recipients", "Intended recipients and disclosure boundaries are explicit."],
    ["draft", "Draft follow-up", "A complete proposed follow-up exists."],
    ["fact_check", "Check facts", "Names, dates, commitments, and claims are verified."],
    ["review_packet", "Prepare review", "The follow-up is ready for human review and remains unsent."],
  ]),
];

export function listPersonalWorkflowTemplates(): readonly PersonalWorkflowTemplate[] {
  return TEMPLATES;
}

export function requirePersonalWorkflowTemplate(
  kind: PersonalWorkflowKind,
): PersonalWorkflowTemplate {
  const found = TEMPLATES.find((candidate) => candidate.kind === kind);
  if (!found) throw new PersonalWorkflowConflictError("Unknown workflow kind.");
  return found;
}

function template(
  kind: PersonalWorkflowKind,
  label: string,
  description: string,
  steps: ReadonlyArray<readonly [string, string, string]>,
): PersonalWorkflowTemplate {
  return {
    kind,
    label,
    description,
    steps: steps.map(([id, stepLabel, completionEvidence]) => ({
      id,
      label: stepLabel,
      completionEvidence,
    })),
  };
}

export class PersonalWorkflowNotFoundError extends Error {
  constructor() {
    super("The workflow does not exist in this actor and workspace scope.");
    this.name = "PersonalWorkflowNotFoundError";
  }
}

export class PersonalWorkflowConflictError extends Error {
  constructor(message = "The workflow cannot accept that transition.") {
    super(message);
    this.name = "PersonalWorkflowConflictError";
  }
}
