import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { validatePersonalitySamplingBoundaryProtocol } from
  "../scripts/validate-personality-sampling-boundary-protocol.js";

describe("personality sampling boundary protocol", () => {
  it("freezes capacity-first PDF, audiovisual, and high-risk rules without activation", async () => {
    await expect(validatePersonalitySamplingBoundaryProtocol()).resolves.toMatchObject({
      schemaVersion: "jolene.personality-sampling-boundary-protocol.v1",
      protocolFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      status: "precommitted-non-activating",
      pdfProtocolId: "pdf-boundary-protocol-v2",
      reproducedPdfCapacity: {
        S04: { boundary_units: 101, eligible_units: 48 },
        S08: { boundary_units: 199, eligible_units: 88 },
        S09: { boundary_units: 11, eligible_units: 5 },
        S18: { boundary_units: 19, eligible_units: 2 },
      },
      audiovisualMapSources: ["S16", "S17"],
      downgradedSources: ["S07"],
      highRiskProtocolId: "two-independent-reviewer-consensus-v1",
      highRiskTaxonomyFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      selectionPerformed: false,
      sourceContentStored: false,
      runtimeActivation: "prohibited",
    });
  });

  it("rejects a protocol detached from its capacity-audit fingerprint", async () => {
    const root = await fixtureRoot((protocol) => {
      protocol.capacity_audit_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(validatePersonalitySamplingBoundaryProtocol(root))
      .rejects.toThrow("Sampling boundary protocol prerequisites are stale");
  });

  it("rejects protocol timestamps that predate the source register", async () => {
    const root = await fixtureRoot((protocol) => {
      protocol.created_at = "2026-08-27T09:23:59Z";
    });
    await expect(validatePersonalitySamplingBoundaryProtocol(root))
      .rejects.toThrow("Sampling boundary protocol predates its prerequisites");
  });

  it("rejects a changed high-risk taxonomy without a new bound fingerprint", async () => {
    const root = await fixtureRoot((protocol) => {
      protocol.high_risk_adjudication.taxonomy_fingerprint = `sha256:${"0".repeat(64)}`;
    });
    await expect(validatePersonalitySamplingBoundaryProtocol(root))
      .rejects.toThrow("High-risk taxonomy fingerprint is invalid");
  });
});

interface ProtocolFixture {
  capacity_audit_fingerprint: string;
  created_at: string;
  high_risk_adjudication: { taxonomy_fingerprint: string };
}

async function fixtureRoot(change: (protocol: ProtocolFixture) => void): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jolene-boundary-protocol-"));
  const research = path.join(root, "research");
  await mkdir(research);
  const sourceRoot = path.join(process.cwd(), "research");
  const files = [
    "sampling-boundary-protocol-v1.yaml", "allocation-capacity-audit-v1.yaml",
    "sampling-plan-v3.yaml", "sampling-plan-v3-outcome.yaml",
    "source-events-v2.yaml", "sources.yaml",
  ];
  const texts = await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")));
  const protocol = parse(texts[0]!) as ProtocolFixture;
  change(protocol);
  texts[0] = stringify(protocol);
  await Promise.all(files.map((file, index) =>
    writeFile(path.join(research, file), texts[index]!, "utf8")));
  return root;
}
