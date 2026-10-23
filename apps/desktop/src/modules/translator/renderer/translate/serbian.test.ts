import { describe, expect, it } from "vitest";

import { serbianToCyrillic, serbianToLatin } from "./serbian.js";

/**
 * NLLB reads Serbian only in Cyrillic, so the page writes the Latin the user
 * types in Cyrillic and shows the Cyrillic output in Latin when asked.
 */
describe("the Serbian script conversions", () => {
  it("writes Latin Serbian in Cyrillic, for the model to read", () => {
    expect(serbianToCyrillic("Dobar dan")).toBe("Добар дан");
  });

  it("leaves Cyrillic input as it is", () => {
    expect(serbianToCyrillic("Добар дан")).toBe("Добар дан");
  });

  it("writes the model's Cyrillic output in Latin, for display", () => {
    expect(serbianToLatin("Добар дан")).toBe("Dobar dan");
  });
});
