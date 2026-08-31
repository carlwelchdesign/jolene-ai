import { z } from "zod";

import { careerMaturitySchema } from "./career-evidence.js";
import {
  evidenceStrengthSchema,
  siteRelativePublicHrefSchema,
} from "./public-career-evidence.js";
import { containsForbiddenPublicDisclosure } from "./public-disclosure-policy.js";

export const PUBLIC_RESUME_PROJECT_DOSSIER_SCHEMA_VERSION =
  "jolene.public-resume-projects.v1" as const;

export const PUBLIC_RESUME_PROJECT_DELIVERY_LIMITATION =
  "Delivery status is bounded to the project scope stated on Carl's public resume." as const;

export const publicResumeProjectDossierSchema = z.object({
  schemaVersion: z.literal(PUBLIC_RESUME_PROJECT_DOSSIER_SCHEMA_VERSION),
  reviewedAt: z.string().datetime({ offset: true }),
  citationHref: siteRelativePublicHrefSchema,
  projects: z.array(z.object({
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/),
    name: z.string().trim().min(1).max(240),
    claim: z.string().trim().min(1).max(1_200),
    maturity: careerMaturitySchema,
    evidenceStrength: evidenceStrengthSchema,
  }).strict()).min(1).max(20),
}).strict().superRefine((dossier, context) => {
  const slugs = dossier.projects.map((project) => project.slug);
  const names = dossier.projects.map((project) => project.name);
  if (new Set(slugs).size !== slugs.length) {
    context.addIssue({
      code: "custom",
      path: ["projects"],
      message: "Resume project slugs must be unique.",
    });
  }
  if (new Set(names).size !== names.length) {
    context.addIssue({
      code: "custom",
      path: ["projects"],
      message: "Resume project names must be unique.",
    });
  }
  if (containsForbiddenPublicDisclosure(dossier)) {
    context.addIssue({
      code: "custom",
      message: "The public resume project dossier contains forbidden private disclosure.",
    });
  }
});

export type PublicResumeProjectDossier = z.infer<
  typeof publicResumeProjectDossierSchema
>;
