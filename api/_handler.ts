import { createVercelPublicDelegateHandler } from "../src/public/vercel-public-delegate.js";
import { publicJoleneProjectDossierSchema } from
  "../src/domain/public-jolene-project-dossier.js";
import dossierInput from "../publications/jolene-project-dossier-v1.json" with { type: "json" };

export const publicDelegateHandler = createVercelPublicDelegateHandler(
  process.env,
  undefined,
  { dossier: publicJoleneProjectDossierSchema.parse(dossierInput) },
);
