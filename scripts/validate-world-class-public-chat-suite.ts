import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  summarizeWorldClassPublicChatSuite,
  worldClassPublicChatSuiteSchema,
} from "../src/evaluation/world-class-public-chat-suite.js";

const suite = worldClassPublicChatSuiteSchema.parse(JSON.parse(await readFile(
  path.resolve("evaluations/world-class-public-chat-v1.json"),
  "utf8",
)));

console.log(JSON.stringify(summarizeWorldClassPublicChatSuite(suite), null, 2));
