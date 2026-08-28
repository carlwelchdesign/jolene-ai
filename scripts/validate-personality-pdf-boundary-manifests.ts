import { loadPersonalityPdfBoundaryManifestsV1 } from
  "../src/personality/personality-pdf-boundary-manifests.js";

loadPersonalityPdfBoundaryManifestsV1()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Validation failed"}\n`);
    process.exitCode = 1;
  });
