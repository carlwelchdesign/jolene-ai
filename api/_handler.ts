import { createVercelPublicDelegateHandler } from "../src/public/vercel-public-delegate.js";
import { publicJoleneProjectDossierSchema } from
  "../src/domain/public-jolene-project-dossier.js";
import dossierInput from "../publications/jolene-project-dossier-v1.json" with { type: "json" };
import { publicResumeProjectDossierSchema } from
  "../src/domain/public-resume-project-dossier.js";
import resumeProjectsInput from "../publications/resume-projects-v1.json" with { type: "json" };
import { publicCareerProfileDossierSchema } from
  "../src/domain/public-career-profile-dossier.js";
import careerProfileInput from "../publications/career-profile-v1.json" with { type: "json" };

export const publicDelegateHandler = createVercelPublicDelegateHandler(
  process.env,
  undefined,
  {
    dossier: publicJoleneProjectDossierSchema.parse(dossierInput),
    careerProfile: publicCareerProfileDossierSchema.parse(careerProfileInput),
    resumeProjects: publicResumeProjectDossierSchema.parse(resumeProjectsInput),
  },
);
