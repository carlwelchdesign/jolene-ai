import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { PersonalityCorpusV2 } from
  "../src/personality/personality-corpus-contract.js";
import {
  fingerprint,
  personalityAdmissionAuditV1Schema,
} from "../src/personality/personality-admission-audit-v1.js";
import {
  buildPersonalityCharacterGraphV1,
  validatePersonalityCharacterGraphV1,
} from "../src/personality/personality-character-graph-v1.js";

const graphPath = new URL("../research/personality-character-graph-v1.json", import.meta.url);
const corpusPath = new URL("../research/personality-corpus-v2-reviewed.json", import.meta.url);
const auditPath = new URL("../research/personality-admission-audit-v1.json", import.meta.url);

async function loadInputs() {
  const [graphText, corpusText, auditText] = await Promise.all([
    readFile(graphPath, "utf8"),
    readFile(corpusPath, "utf8"),
    readFile(auditPath, "utf8"),
  ]);
  return {
    graph: JSON.parse(graphText),
    corpus: JSON.parse(corpusText) as PersonalityCorpusV2,
    audit: personalityAdmissionAuditV1Schema.parse(JSON.parse(auditText)),
    auditFingerprint: fingerprint(auditText),
  };
}

describe("personality character graph v1", () => {
  it("validates the committed reviewed graph and preserves decision boundaries", async () => {
    const input = await loadInputs();
    const graph = validatePersonalityCharacterGraphV1(
      input.graph, input.corpus, input.audit, input.auditFingerprint,
    );

    expect(graph.decisionSummary).toMatchObject({
      admittedTraits: 1,
      deferredTraits: 7,
      referencedObservations: 111,
      antiCaricatureConstraints: 7,
      runtimeActivation: "prohibited",
    });
    expect(graph.traitNodes.filter((node) => node.decision === "admitted"))
      .toMatchObject([{ traitFamilyId: "uncertainty-humility" }]);
    expect(graph.evidenceEdges).toHaveLength(111);
    expect(graph.constraintEdges).toHaveLength(56);
  });

  it("rebuilds byte-equivalent graph data with the same fingerprint", async () => {
    const input = await loadInputs();
    const rebuilt = buildPersonalityCharacterGraphV1(
      input.corpus, input.audit, input.auditFingerprint,
    );
    expect(rebuilt).toEqual(input.graph);
  });

  it("rejects a dangling or altered evidence relationship", async () => {
    const input = await loadInputs();
    const changed = structuredClone(input.graph);
    changed.evidenceEdges[0].fromObservationId = "T999";
    expect(() => validatePersonalityCharacterGraphV1(
      changed, input.corpus, input.audit, input.auditFingerprint,
    )).toThrow("does not match its reviewed source artifacts");
  });

  it("rejects source-expression fields even when nested", async () => {
    const input = await loadInputs();
    const changed = structuredClone(input.graph);
    changed.observationNodes[0].paraphrase = "This must never enter the graph artifact.";
    expect(() => validatePersonalityCharacterGraphV1(
      changed, input.corpus, input.audit, input.auditFingerprint,
    )).toThrow("prohibited source-content field");
  });
});
