import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPersonalityResearch } from
  "../src/personality/personality-research.js";
import type { PersonalityResearchSummary } from
  "../src/personality/personality-research.js";

export type { PersonalityResearchSummary } from
  "../src/personality/personality-research.js";

export async function validatePersonalityResearch(
  projectRoot = process.cwd(),
): Promise<PersonalityResearchSummary> {
  const snapshot = await loadPersonalityResearch(projectRoot);
  return {
    registeredSources: snapshot.registeredSources,
    observations: snapshot.observations,
    codedSources: snapshot.codedSources,
    codedContexts: snapshot.codedContexts,
    evidenceClasses: snapshot.evidenceClasses,
    independentlyReviewed: snapshot.independentlyReviewed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePersonalityResearch();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
