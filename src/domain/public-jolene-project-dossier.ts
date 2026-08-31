import { z } from "zod";

import { siteRelativePublicHrefSchema } from "./public-career-evidence.js";
import { containsForbiddenPublicDisclosure } from "./public-disclosure-policy.js";

export const PUBLIC_JOLENE_DOSSIER_SCHEMA_VERSION =
  "jolene.public-project-dossier.v1" as const;

export const publicJoleneDossierTopicSchema = z.enum([
  "architecture",
  "model",
  "rag",
  "corpus",
  "security",
  "personality",
  "docker",
  "slack",
  "portfolio_bff",
  "deployment",
  "carl_role",
  "limitations",
]);

const sourceEvidenceSchema = z.string().trim().min(1).max(240)
  .refine((value) => !value.startsWith("/") && !value.includes(".."), {
    message: "Dossier source evidence must be a repository-relative path.",
  });

export const publicJoleneProjectDossierSchema = z.object({
  schemaVersion: z.literal(PUBLIC_JOLENE_DOSSIER_SCHEMA_VERSION),
  project: z.object({
    slug: z.literal("jolene-ai"),
    name: z.literal("Jolene AI"),
    status: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(800),
    publicCitationBase: siteRelativePublicHrefSchema,
  }).strict(),
  claims: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
    topic: publicJoleneDossierTopicSchema,
    text: z.string().trim().min(1).max(1_200),
    citation: z.object({
      title: z.string().trim().min(1).max(240),
      href: siteRelativePublicHrefSchema,
    }).strict(),
    sourceEvidence: z.array(sourceEvidenceSchema).min(1).max(8),
  }).strict()).length(publicJoleneDossierTopicSchema.options.length),
}).strict().superRefine((dossier, context) => {
  const ids = dossier.claims.map((claim) => claim.id);
  const topics = dossier.claims.map((claim) => claim.topic);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["claims"], message: "Claim IDs must be unique." });
  }
  if (new Set(topics).size !== topics.length) {
    context.addIssue({ code: "custom", path: ["claims"], message: "Claim topics must be unique." });
  }
  for (const topic of publicJoleneDossierTopicSchema.options) {
    if (!topics.includes(topic)) {
      context.addIssue({ code: "custom", path: ["claims"], message: `Missing topic: ${topic}.` });
    }
  }
  for (const [index, claim] of dossier.claims.entries()) {
    if (!claim.citation.href.startsWith(`${dossier.project.publicCitationBase}#`)) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "citation", "href"],
        message: "Claim citations must resolve to the public Jolene case study.",
      });
    }
  }
  if (containsForbiddenPublicDisclosure(dossier)) {
    context.addIssue({
      code: "custom",
      message: "The public Jolene dossier contains forbidden private disclosure.",
    });
  }
});

export type PublicJoleneProjectDossier = z.infer<
  typeof publicJoleneProjectDossierSchema
>;
