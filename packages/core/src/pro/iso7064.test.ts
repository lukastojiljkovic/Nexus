import { describe, expect, it } from "vitest";

import { checkDigitsFrom, groupsOfFour, mod97, stripSeparators } from "./iso7064.js";

describe("stripSeparators", () => {
  it("removes spaces and hyphens, and dots only when asked", () => {
    expect(stripSeparators(" 12-3.4 ", false)).toBe("123.4");
    expect(stripSeparators(" 12-3.4 ", true)).toBe("1234");
  });
});

describe("mod97", () => {
  it("is the remainder of the digits, one at a time", () => {
    expect(mod97("1234567")).toBe(1234567 % 97);
  });

  it("counts a letter as its two-digit value, A = 10 … Z = 35", () => {
    expect(mod97("A")).toBe(10);
    expect(mod97("Z0")).toBe(59);
  });

  it("gives 1 for the ISO 13616 worked example rearranged, GB82 WEST 1234 5698 7654 32", () => {
    expect(mod97("WEST12345698765432GB82")).toBe(1);
  });
});

describe("checkDigitsFrom", () => {
  it("is 98 minus the remainder, with a leading zero", () => {
    expect(checkDigitsFrom(1)).toBe("97");
    expect(checkDigitsFrom(0)).toBe("98");
    expect(checkDigitsFrom(mod97("WEST12345698765432GB00"))).toBe("82");
  });
});

describe("groupsOfFour", () => {
  it("writes an IBAN in groups of four", () => {
    expect(groupsOfFour("GB82WEST12345698765432")).toBe("GB82 WEST 1234 5698 7654 32");
  });
});
