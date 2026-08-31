import { z } from "zod";

import { careerMaturitySchema } from "./career-evidence.js";
import {
  evidenceStrengthSchema,
  publicSourceTypeSchema,
  siteRelativePublicHrefSchema,
} from "./public-career-evidence.js";
import { containsForbiddenPublicDisclosure } from "./public-disclosure-policy.js";

export const PUBLIC_CAREER_PROFILE_DOSSIER_SCHEMA_VERSION =
  "jolene.public-career-profile.v1" as const;

export const PUBLIC_CAREER_CHAPTER_LIMITATION =
  "Career scope: This is a representative public summary of documented delivery across one career era." as const;

export const PUBLIC_CAREER_ROLE_LIMITATION =
  "Role scope: This summarizes Carl's documented contribution and does not imply sole authorship of team delivery." as const;

const citationSchema = z.object({
  title: z.string().trim().min(1).max(240),
  href: siteRelativePublicHrefSchema,
  sourceType: publicSourceTypeSchema.refine(
    (value) => value === "resume" || value === "portfolio_page",
    { message: "Career profile citations must use a public resume or portfolio page." },
  ),
}).strict();

const entrySchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/),
  period: z.string().trim().min(1).max(80),
  claim: z.string().trim().min(1).max(1_500),
  maturity: careerMaturitySchema,
  evidenceStrength: evidenceStrengthSchema,
  citation: citationSchema,
}).strict();

export const publicCareerProfileDossierSchema = z.object({
  schemaVersion: z.literal(PUBLIC_CAREER_PROFILE_DOSSIER_SCHEMA_VERSION),
  reviewedAt: z.string().datetime({ offset: true }),
  chapters: z.array(entrySchema).min(4).max(8),
  roles: z.array(entrySchema).min(8).max(30),
}).strict().superRefine((dossier, context) => {
  const entries = [...dossier.chapters, ...dossier.roles];
  const slugs = entries.map((entry) => entry.slug);
  if (new Set(slugs).size !== slugs.length) {
    context.addIssue({
      code: "custom",
      path: ["chapters"],
      message: "Career profile slugs must be unique across chapters and roles.",
    });
  }
  if (containsForbiddenPublicDisclosure(dossier)) {
    context.addIssue({
      code: "custom",
      message: "The public career profile contains forbidden private disclosure.",
    });
  }
});

export type PublicCareerProfileDossier = z.infer<
  typeof publicCareerProfileDossierSchema
>;
