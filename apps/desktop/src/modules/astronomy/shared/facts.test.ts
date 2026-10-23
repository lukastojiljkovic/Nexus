import { describe, expect, it } from "vitest";

import { BODY_FACTS, BODY_FACTS_SOURCE } from "./facts.js";

/**
 * The generated facts module is checked for its shape, not its values: the values
 * are NASA's and are pinned by the script's own tests against the saved pages.
 * What this file guards is that a body the interface shows always has its card
 * (the `Record<BodyId, …>` type makes every body present; this checks none is
 * empty), that every number is one the parser could have produced, and that the
 * module says when it was fetched.
 */

const BODIES = Object.entries(BODY_FACTS);

describe("BODY_FACTS", () => {
  it("has a non-empty row set for every body", () => {
    expect(BODIES).toHaveLength(11);
    for (const [id, facts] of BODIES) {
      expect(Object.keys(facts).length, id).toBeGreaterThan(0);
    }
  });

  it("holds only finite numbers or null, and no non-finite ones", () => {
    for (const [id, facts] of BODIES) {
      for (const row of Object.values(facts)) {
        if ("number" in row.value) {
          expect(row.value.number === null || Number.isFinite(row.value.number), `${id}: ${row.label}`).toBe(true);
        }
      }
    }
  });
});

describe("BODY_FACTS_SOURCE", () => {
  it("names the two NASA pages and a retrieval date in ISO form", () => {
    expect(BODY_FACTS_SOURCE.urls).toHaveLength(2);
    expect(BODY_FACTS_SOURCE.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(BODY_FACTS_SOURCE.retrieved))).toBe(false);
  });
});
