import { loadS03UniqueCapacityView } from
  "../src/personality/personality-s03-unique-capacity-view.js";

process.stdout.write(`${JSON.stringify(await loadS03UniqueCapacityView(), null, 2)}\n`);
