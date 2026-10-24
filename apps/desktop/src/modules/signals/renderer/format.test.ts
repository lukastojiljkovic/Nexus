import { describe, expect, it } from "vitest";

import { formatHertz } from "./format.js";

describe("formatHertz", () => {
  it("prints a string's frequency to one decimal, in each locale's digits", () => {
    expect(formatHertz(82.407, "en")).toBe("82.4 Hz");
    expect(formatHertz(82.407, "sr")).toBe("82,4 Hz");
  });

  it("prints a whole frequency with no decimals", () => {
    expect(formatHertz(440, "en")).toBe("440 Hz");
  });
});
