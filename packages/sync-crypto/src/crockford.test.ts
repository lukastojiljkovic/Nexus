import { describe, expect, it } from "vitest";
import { encodeCrockford, groupCrockford, normalizeCrockford } from "./crockford.js";

describe("encodeCrockford", () => {
  it("encodes all-zero bytes as all-zero digits", () => {
    expect(encodeCrockford(new Uint8Array(9), 13)).toBe("0".repeat(13));
  });

  it("encodes all-one bytes as all-'Z' digits — the top of the alphabet", () => {
    expect(encodeCrockford(new Uint8Array(9).fill(0xff), 13)).toBe("Z".repeat(13));
  });

  it("packs bits across a byte boundary with a 5-bit sliding window", () => {
    // byte[0] = 0x01 = 00000001. First 5 bits (00000) -> '0'; next 5 bits
    // (001 + the next byte's top two 00) -> 0b00100 = 4 -> '4'; rest zero.
    const bytes = new Uint8Array(9);
    bytes[0] = 0x01;
    expect(encodeCrockford(bytes, 13)).toBe("04" + "0".repeat(11));
  });

  it("refuses to emit more digits than the supplied bytes can fill", () => {
    // 9 bytes = 72 bits = 14 whole 5-bit groups. A 15th would be invented.
    expect(() => encodeCrockford(new Uint8Array(9), 15)).toThrow(TypeError);
  });
});

describe("normalizeCrockford", () => {
  it("accepts lower case, dashes and whitespace in any arrangement", () => {
    expect(normalizeCrockford("abcd-efgh-jkmn-p", 13)).toBe("ABCDEFGHJKMNP");
    expect(normalizeCrockford("  ABCD EFGH JKMN P  ", 13)).toBe("ABCDEFGHJKMNP");
  });

  it("folds Crockford's confusable characters — O to 0, I and L to 1", () => {
    expect(normalizeCrockford("OIL0000000000", 13)).toBe("0110000000000");
  });

  it("rejects U outright rather than folding it", () => {
    expect(normalizeCrockford("U000000000000", 13)).toBeNull();
  });

  it("rejects a wrong length and a foreign character", () => {
    expect(normalizeCrockford("0".repeat(12), 13)).toBeNull();
    expect(normalizeCrockford("0".repeat(14), 13)).toBeNull();
    expect(normalizeCrockford("!" + "0".repeat(12), 13)).toBeNull();
    expect(normalizeCrockford("", 13)).toBeNull();
  });
});

describe("groupCrockford", () => {
  it("puts the remainder in the FIRST group so no group is a lone character", () => {
    // 13 = 5 + 4 + 4. Grouping from the left would end in a single trailing
    // character, which reads as a typo.
    expect(groupCrockford("ABCDEFGHJKMNP", 4)).toBe("ABCDE-FGHJ-KMNP");
  });

  it("leaves an exact multiple ungrouped at the front", () => {
    expect(groupCrockford("ABCDEFGH", 4)).toBe("ABCD-EFGH");
  });
});
