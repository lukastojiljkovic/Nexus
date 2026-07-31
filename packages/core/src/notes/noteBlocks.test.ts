import { describe, expect, it } from "vitest";
import {
  CALLOUT_VARIANTS,
  DEFAULT_CALLOUT_VARIANT,
  isCalloutVariant,
  normalizeCalloutVariant,
} from "./noteBlocks.js";

describe("callout variants", () => {
  it("accepts every declared variant unchanged", () => {
    for (const variant of CALLOUT_VARIANTS) {
      expect(isCalloutVariant(variant)).toBe(true);
      expect(normalizeCalloutVariant(variant)).toBe(variant);
    }
  });

  it("keeps the neutral variant as the declared default", () => {
    expect(CALLOUT_VARIANTS).toContain(DEFAULT_CALLOUT_VARIANT);
    expect(DEFAULT_CALLOUT_VARIANT).toBe("info");
  });

  it("normalises anything else — including a non-string attribute — to the default", () => {
    // A Yjs attribute is `unknown` at runtime whatever its TS type claims, so
    // the normaliser has to survive values a document should never hold.
    for (const value of ["", "INFO", "success", null, undefined, 3, true, {}]) {
      expect(isCalloutVariant(value)).toBe(false);
      expect(normalizeCalloutVariant(value)).toBe(DEFAULT_CALLOUT_VARIANT);
    }
  });
});
