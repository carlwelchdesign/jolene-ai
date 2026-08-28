import { loadPersonalityPdfCapacityLedgersV1 } from
  "../src/personality/personality-pdf-capacity-ledgers.js";

loadPersonalityPdfCapacityLedgersV1()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Validation failed"}\n`);
    process.exitCode = 1;
  });
