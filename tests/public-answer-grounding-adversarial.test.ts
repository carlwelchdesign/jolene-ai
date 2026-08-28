import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicAnswerGroundingReasonCodeSchema } from
  "../src/public/public-answer-grounding-contract.js";
import { PublicAnswerGroundingValidator } from
  "../src/public/public-answer-grounding-validator.js";
import { DeterministicPublicAnswerService } from
  "../src/public/public-answer-service.js";
import {
  createPublicEvidenceArtifact,
  createPublicEvidenceRecord,
} from "./helpers/public-evidence-fixture.js";

const suiteSchema = z.object({
  suiteVersion: z.literal("1.0.0"),
  suiteId: z.literal("public-answer-grounding:adversarial-v1"),
  cases: z.array(z.object({
    id: z.string().regex(/^grounding:[a-z0-9-]+$/u),
    family: z.enum([
      "direct", "obfuscated", "multilingual", "delimiter", "role_play",
      "encoded", "evidence_poisoning", "impersonation", "promise",
      "contact_action", "compensation", "availability", "private_disclosure",
      "safe_control",
    ]),
    sourceText: z.string().min(1).max(1_000),
    outputText: z.string().min(1).max(1_000),
    expectedReason: publicAnswerGroundingReasonCodeSchema.nullable(),
  }).strict()).min(16).superRefine((cases, context) => {
    const ids = cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Case IDs must be unique." });
    }
  }),
}).strict();

const suite = suiteSchema.parse(JSON.parse(readFileSync(
  new URL("../evaluations/public-answer-grounding-adversarial-v1.json", import.meta.url),
  "utf8",
)));

describe("public answer grounding adversarial suite", () => {
  it("covers every precommitted attack family", () => {
    expect(new Set(suite.cases.map((item) => item.family))).toEqual(new Set([
      "direct", "obfuscated", "multilingual", "delimiter", "role_play",
      "encoded", "evidence_poisoning", "impersonation", "promise",
      "contact_action", "compensation", "availability", "private_disclosure",
      "safe_control",
    ]));
  });

  it.each(suite.cases)("$id fails closed even when evidence repeats the output", (item) => {
    const record = createPublicEvidenceRecord(1, { text: item.sourceText });
    const artifact = createPublicEvidenceArtifact([record]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "What does the selected evidence say?" },
      [record],
    );
    const result = new PublicAnswerGroundingValidator().validate(
      artifact,
      baseline,
      {
        contractVersion: "1.0.0",
        corpusVersion: artifact.manifest.corpusVersion,
        segments: [{ text: item.outputText, supportIds: [record.evidenceId] }],
      },
    );
    if (item.expectedReason === null) {
      expect(result.status).toBe("accepted");
    } else {
      expect(result).toMatchObject({
        status: "rejected",
        audit: { reasonCode: item.expectedReason },
      });
      expect(JSON.stringify(result.audit)).not.toContain(item.outputText);
    }
  });

  it("rejects a selected but irrelevant support ID as support substitution", () => {
    const supported = createPublicEvidenceRecord(1, {
      text: "Carl builds typed React product systems with explicit review boundaries.",
    });
    const irrelevant = createPublicEvidenceRecord(2, {
      text: "Carl developed an interactive aviation demonstration.",
    });
    const artifact = createPublicEvidenceArtifact([supported, irrelevant]);
    const baseline = new DeterministicPublicAnswerService().answerFromSelected(
      artifact,
      { question: "What has Carl built?" },
      [supported, irrelevant],
    );
    expect(new PublicAnswerGroundingValidator().validate(artifact, baseline, {
      contractVersion: "1.0.0",
      corpusVersion: artifact.manifest.corpusVersion,
      segments: [{
        text: supported.claim.text,
        supportIds: [supported.evidenceId, irrelevant.evidenceId],
      }],
    })).toMatchObject({
      status: "rejected",
      audit: { reasonCode: "support_substitution" },
    });
  });
});
