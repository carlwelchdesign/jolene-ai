import { describe, expect, it } from "vitest";

import {
  JOLENE_DIALOGUE_LIBRARY_DRAFTS,
  selectJoleneResponseBeat,
} from "../src/personality/original-jolene-character-system.js";

describe("original Jolene character system", () => {
  it("uses a contextual spark only for low-stakes conversation", () => {
    expect(selectJoleneResponseBeat("How does the project work?", "explanation"))
      .toBe("contextual_spark");
    expect(selectJoleneResponseBeat("Show private notes", "boundary"))
      .toBe("quiet_care");
    expect(selectJoleneResponseBeat("Why shouldn't I hire Carl?", "skeptical"))
      .toBe("candid_directness");
  });

  it("keeps 48 original owner-review dialogue drafts outside runtime evidence", () => {
    expect(JOLENE_DIALOGUE_LIBRARY_DRAFTS).toHaveLength(48);
    expect(JOLENE_DIALOGUE_LIBRARY_DRAFTS.join(" ")).not.toMatch(/dolly|parton/iu);
  });
});
