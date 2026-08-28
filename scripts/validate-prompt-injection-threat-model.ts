import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const stringList = z.array(nonEmpty).min(1);
const workItemId = z.string().regex(/^(?:JOL|PORT)-[A-Z]+-\d{3}[A-Z]?$/);
const ticketId = z.string().regex(/^JOL-SEC-\d{3}[A-Z]?$/);

const controlSchema = z.object({
  id: z.string().regex(/^C\d{2}$/),
  name: nonEmpty,
  phase: z.enum(["current", "planned"]),
  kind: z.enum([
    "deterministic",
    "isolation",
    "process",
    "prompt",
    "detection",
    "model_evaluation",
  ]),
  ownerTicket: workItemId,
  implementationRefs: stringList,
  evidenceRefs: stringList,
  limitations: stringList,
}).strict();

const threatSchema = z.object({
  id: z.string().regex(/^T\d{2}$/),
  title: nonEmpty,
  families: stringList,
  surfaces: stringList,
  assets: stringList,
  impact: z.number().int().min(1).max(5),
  likelihood: z.number().int().min(1).max(5),
  currentControlIds: z.array(nonEmpty),
  residualRisk: z.enum(["low", "medium", "high", "critical"]),
  residualReason: nonEmpty,
  preventionControlIds: stringList,
  detectionControlIds: stringList,
  containmentControlIds: stringList,
  recoveryControlIds: stringList,
  testOwnerTicket: ticketId,
}).strict();

const modelSchema = z.object({
  schemaVersion: z.literal("jolene.prompt-injection-threat-model.v1"),
  ticketId: z.literal("JOL-SEC-003"),
  reviewedAt: z.string().datetime(),
  status: z.literal("implementation_ready"),
  scope: z.object({
    surfaces: stringList,
    assets: stringList,
    nonGoals: stringList,
  }).strict(),
  assumptions: z.array(z.object({
    id: z.string().regex(/^A\d{2}$/),
    statement: nonEmpty,
    verification: nonEmpty,
  }).strict()).min(1),
  actors: z.array(z.object({
    id: z.string().regex(/^ACT\d{2}$/),
    name: nonEmpty,
    authority: nonEmpty,
    cannotAuthorize: nonEmpty,
  }).strict()).min(1),
  dataInventory: z.array(z.object({
    id: z.string().regex(/^DATA\d{2}$/),
    name: nonEmpty,
    classification: nonEmpty,
    purpose: nonEmpty,
    modelVisible: z.boolean(),
    providerEgress: nonEmpty,
    currentRetention: nonEmpty,
    currentDeletion: nonEmpty,
    ownerTicket: ticketId,
  }).strict()).min(1),
  boundaries: z.array(z.object({
    id: z.string().regex(/^B\d{2}$/),
    name: nonEmpty,
    source: nonEmpty,
    destination: nonEmpty,
    dataClasses: stringList,
    modelVisible: z.boolean(),
    currentControlIds: z.array(nonEmpty),
  }).strict()).min(1),
  controls: z.array(controlSchema).min(1),
  threats: z.array(threatSchema).min(1),
  risks: z.array(z.object({
    id: z.string().regex(/^R\d{2}$/),
    title: nonEmpty,
    threatIds: stringList,
    impact: z.number().int().min(1).max(5),
    likelihood: z.number().int().min(1).max(5),
    score: z.number().int().min(1).max(25),
    ownerTicket: ticketId,
    trigger: nonEmpty,
    mitigation: nonEmpty,
    fallback: nonEmpty,
    status: z.literal("open"),
  }).strict()).min(1),
  gates: z.array(z.object({
    id: z.string().regex(/^G\d{2}$/),
    ownerTicket: ticketId,
    requirement: nonEmpty,
    blocking: z.literal(true),
    verification: stringList,
    appliesTo: stringList,
  }).strict()).min(1),
  decisions: z.array(z.object({
    id: z.string().regex(/^D\d{2}$/),
    decision: nonEmpty,
    rationale: nonEmpty,
    status: z.literal("accepted"),
  }).strict()).min(1),
  raci: z.array(z.object({
    activity: nonEmpty,
    responsible: nonEmpty,
    accountable: nonEmpty,
    consulted: stringList,
    informed: stringList,
  }).strict()).min(1),
  deliverySequence: z.array(ticketId),
  tickets: z.array(z.object({
    id: ticketId,
    asanaGid: z.string().regex(/^\d+$/),
    purpose: nonEmpty,
    prerequisites: z.array(ticketId),
    completionBoundary: nonEmpty,
  }).strict()),
}).strict();

export type PromptInjectionThreatModel = z.infer<typeof modelSchema>;

export interface PromptInjectionThreatModelSummary {
  actors: number;
  dataInventory: number;
  boundaries: number;
  controls: number;
  threats: number;
  risks: number;
  gates: number;
  decisions: number;
  tickets: number;
  status: "implementation_ready";
}

const requiredFamilies = [
  "direct_injection",
  "indirect_injection",
  "cross_turn_persistence",
  "tool_manipulation",
  "tool_result_injection",
  "data_exfiltration",
  "identity_impersonation",
  "contact_manipulation",
  "output_integrity",
  "poisoned_corpus",
  "encoding_evasion",
  "resource_abuse",
  "audit_evasion",
  "cross_channel_confusion",
  "provider_boundary",
  "retention_abuse",
] as const;

const requiredSurfaces = [
  "private_cli",
  "private_http",
  "slack_owner_dm",
  "slack_shared",
  "public_portfolio_answer",
  "public_job_fit",
  "public_contact_intent",
  "private_career_mcp",
  "client_ai_packets",
  "future_mutating_tools",
] as const;

const expectedTicketOrder = [
  "JOL-SEC-003",
  "JOL-SEC-004A",
  "JOL-SEC-004",
  "JOL-SEC-005",
  "JOL-SEC-007",
  "JOL-SEC-006",
  "JOL-SEC-008",
  "JOL-SEC-009",
] as const;

const forbiddenContentPatterns: ReadonlyArray<[RegExp, string]> = [
  [/\/Users\//, "absolute user path"],
  [/OPENAI_API_KEY/i, "secret environment-variable name"],
  [/\bxox[abprs]-[A-Za-z0-9-]+\b/, "Slack credential"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/, "provider credential"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertUnique(values: string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  assert(duplicates.length === 0, `${label} must be unique; duplicates: ${[...new Set(duplicates)].join(", ")}`);
}

function assertReferences(
  refs: string[],
  allowed: Set<string>,
  label: string,
): void {
  const unknown = refs.filter((ref) => !allowed.has(ref));
  assert(unknown.length === 0, `${label} contains unknown references: ${unknown.join(", ")}`);
}

export function validatePromptInjectionThreatModelData(
  data: unknown,
  projectRoot = process.cwd(),
): PromptInjectionThreatModelSummary {
  const model = modelSchema.parse(data);
  const serialized = JSON.stringify(model);

  for (const [pattern, label] of forbiddenContentPatterns) {
    assert(!pattern.test(serialized), `Threat model contains forbidden ${label}`);
  }

  const idGroups: ReadonlyArray<[string, string[]]> = [
    ["actor IDs", model.actors.map((item) => item.id)],
    ["data IDs", model.dataInventory.map((item) => item.id)],
    ["boundary IDs", model.boundaries.map((item) => item.id)],
    ["control IDs", model.controls.map((item) => item.id)],
    ["threat IDs", model.threats.map((item) => item.id)],
    ["risk IDs", model.risks.map((item) => item.id)],
    ["gate IDs", model.gates.map((item) => item.id)],
    ["decision IDs", model.decisions.map((item) => item.id)],
    ["ticket IDs", model.tickets.map((item) => item.id)],
    ["Asana GIDs", model.tickets.map((item) => item.asanaGid)],
  ];
  for (const [label, ids] of idGroups) {
    assertUnique(ids, label);
  }

  assertUnique(model.scope.surfaces, "scope surfaces");
  assertUnique(model.scope.assets, "scope assets");
  for (const surface of requiredSurfaces) {
    assert(model.scope.surfaces.includes(surface), `Required surface is missing: ${surface}`);
  }

  const controlIds = new Set(model.controls.map((item) => item.id));
  const threatIds = new Set(model.threats.map((item) => item.id));
  const surfaces = new Set(model.scope.surfaces);
  const assets = new Set(model.scope.assets);
  const plannedTicketIds = new Set(expectedTicketOrder);

  for (const boundary of model.boundaries) {
    assertReferences(boundary.currentControlIds, controlIds, `${boundary.id}.currentControlIds`);
    for (const controlId of boundary.currentControlIds) {
      const control = model.controls.find((candidate) => candidate.id === controlId);
      assert(control?.phase === "current", `${boundary.id} labels planned control ${controlId} as current`);
    }
  }

  for (const control of model.controls) {
    if (control.phase === "current") {
      for (const ref of [...control.implementationRefs, ...control.evidenceRefs]) {
        assert(!ref.includes(" acceptance criteria"), `${control.id} current evidence cannot be ticket prose`);
        assert(existsSync(resolve(projectRoot, ref)), `${control.id} references missing current evidence: ${ref}`);
      }
    } else {
      assert(plannedTicketIds.has(control.ownerTicket as typeof expectedTicketOrder[number]), `${control.id} has an unknown planned owner`);
    }
  }

  const coveredFamilies = new Set(model.threats.flatMap((item) => item.families));
  for (const family of requiredFamilies) {
    assert(coveredFamilies.has(family), `Required threat family is missing: ${family}`);
  }

  for (const threat of model.threats) {
    assertReferences(threat.surfaces, surfaces, `${threat.id}.surfaces`);
    assertReferences(threat.assets, assets, `${threat.id}.assets`);
    for (const field of [
      "currentControlIds",
      "preventionControlIds",
      "detectionControlIds",
      "containmentControlIds",
      "recoveryControlIds",
    ] as const) {
      assertReferences(threat[field], controlIds, `${threat.id}.${field}`);
    }
    assert(plannedTicketIds.has(threat.testOwnerTicket as typeof expectedTicketOrder[number]), `${threat.id} has an unknown test owner`);
  }

  for (const risk of model.risks) {
    assertReferences(risk.threatIds, threatIds, `${risk.id}.threatIds`);
    assert(risk.score === risk.impact * risk.likelihood, `${risk.id} score must equal impact × likelihood`);
    assert(plannedTicketIds.has(risk.ownerTicket as typeof expectedTicketOrder[number]), `${risk.id} has an unknown owner`);
  }

  assert(
    JSON.stringify(model.deliverySequence) === JSON.stringify(expectedTicketOrder),
    `Delivery sequence must be ${expectedTicketOrder.join(" -> ")}`,
  );
  assert(
    new Set(model.tickets.map((item) => item.id)).size === expectedTicketOrder.length &&
      expectedTicketOrder.every((id) => model.tickets.some((ticket) => ticket.id === id)),
    "Ticket inventory must contain the complete JOL-SEC-003 through JOL-SEC-009 delivery set",
  );
  const ticketPositions = new Map(model.deliverySequence.map((id, index) => [id, index]));
  for (const ticket of model.tickets) {
    for (const prerequisite of ticket.prerequisites) {
      const prerequisitePosition = ticketPositions.get(prerequisite);
      const ticketPosition = ticketPositions.get(ticket.id);
      assert(prerequisitePosition !== undefined, `${ticket.id} has unknown prerequisite ${prerequisite}`);
      assert(ticketPosition !== undefined && prerequisitePosition < ticketPosition, `${ticket.id} prerequisite ${prerequisite} must appear earlier`);
    }
  }

  for (const gate of model.gates) {
    assert(plannedTicketIds.has(gate.ownerTicket as typeof expectedTicketOrder[number]), `${gate.id} has an unknown owner`);
  }
  const gateOwners = new Set(model.gates.map((item) => item.ownerTicket));
  for (const owner of expectedTicketOrder.slice(1)) {
    assert(gateOwners.has(owner), `Blocking gate is missing for ${owner}`);
  }

  for (const dataClass of model.dataInventory) {
    assert(plannedTicketIds.has(dataClass.ownerTicket as typeof expectedTicketOrder[number]), `${dataClass.id} has an unknown owner`);
  }

  const nonGoals = model.scope.nonGoals.join(" ").toLowerCase();
  assert(nonGoals.includes("deploy"), "Non-goals must explicitly exclude deployment");
  assert(nonGoals.includes("mutating"), "Non-goals must explicitly exclude mutating capabilities");

  return {
    actors: model.actors.length,
    dataInventory: model.dataInventory.length,
    boundaries: model.boundaries.length,
    controls: model.controls.length,
    threats: model.threats.length,
    risks: model.risks.length,
    gates: model.gates.length,
    decisions: model.decisions.length,
    tickets: model.tickets.length,
    status: model.status,
  };
}

export function validatePromptInjectionThreatModel(
  projectRoot = process.cwd(),
): PromptInjectionThreatModelSummary {
  const path = resolve(projectRoot, "plans/security/prompt-injection-threat-model.v1.json");
  return validatePromptInjectionThreatModelData(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
    projectRoot,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(validatePromptInjectionThreatModel(), null, 2)}\n`);
}
