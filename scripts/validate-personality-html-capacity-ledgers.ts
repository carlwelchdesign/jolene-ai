import { loadPersonalityHtmlCapacityLedgersV1 } from
  "../src/personality/personality-html-capacity-ledgers.js";

process.stdout.write(`${JSON.stringify(
  await loadPersonalityHtmlCapacityLedgersV1(), null, 2,
)}\n`);
