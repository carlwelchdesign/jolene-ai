import { z } from "zod";

export const personalityModeSchema = z.enum(["neutral", "jolene"]);

export type PersonalityMode = z.infer<typeof personalityModeSchema>;
