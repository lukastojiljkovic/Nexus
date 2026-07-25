import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "./recoveryCode.js";

/** Stubs `crypto.getRandomValues` to fill the buffer with a fixed byte pattern. */
function stubRandomBytes(fill: (bytes: Uint8Array) => void): void {
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((array: ArrayBufferView) => {
    fill(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    return array;
  }) as typeof crypto.getRandomValues);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateRecoveryCode", () => {
  it("produces 8 groups of 4 Crockford base32 characters (39 chars with dashes)", () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(39);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  });

  it("draws from crypto.getRandomValues, never Math.random", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    generateRecoveryCode();
    expect(spy).toHaveBeenCalledTimes(1);
    // 160 bits of randomness, one call for the whole buffer.
    const arg = spy.mock.calls[0]?.[0] as Uint8Array;
    expect(arg.byteLength).toBe(20);
  });

  it("differs across calls (extremely unlikely to collide over 160 random bits)", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
  });

  it("encodes all-zero bytes as all-zero digits — a known-answer bit-packing check", () => {
    stubRandomBytes((bytes) => bytes.fill(0x00));
    expect(generateRecoveryCode()).toBe("0000-0000-0000-0000-0000-0000-0000-0000");
  });

  it("encodes all-one bytes as all-'Z' digits — the top of the Crockford alphabet", () => {
    stubRandomBytes((bytes) => bytes.fill(0xff));
    expect(generateRecoveryCode()).toBe("ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
  });

  it("packs bits correctly across a byte boundary (not just uniform bytes)", () => {
    // byte[0] = 0x01 = 00000001, all other 19 bytes zero.
    // First 5 bits (00000) -> '0'; next 5 bits (001 + top-2-of-next-byte's 00) -> '4';
    // every remaining 5-bit group is zero -> '0'.
    stubRandomBytes((bytes) => {
      bytes.fill(0x00);
      bytes[0] = 0x01;
    });
    const canonical = normalizeRecoveryCode(generateRecoveryCode());
    expect(canonical).toBe("04" + "0".repeat(30));
  });
});

describe("normalizeRecoveryCode", () => {
  it("round-trips through formatRecoveryCode back to the same canonical form", () => {
    const canonical = normalizeRecoveryCode(generateRecoveryCode());
    expect(canonical).not.toBeNull();
    expect(normalizeRecoveryCode(formatRecoveryCode(canonical as string))).toBe(canonical);
  });

  it("accepts lower-case input and dashes/whitespace in any arrangement", () => {
    const canonical = normalizeRecoveryCode(generateRecoveryCode()) as string;
    const formatted = formatRecoveryCode(canonical);
    expect(normalizeRecoveryCode(formatted.toLowerCase())).toBe(canonical);
    expect(normalizeRecoveryCode(`  ${formatted}  `)).toBe(canonical);
    expect(normalizeRecoveryCode(formatted.replace(/-/g, " "))).toBe(canonical);
  });

  it("maps Crockford's confusable characters — O to 0, I and L to 1", () => {
    expect(normalizeRecoveryCode("O".repeat(32))).toBe("0".repeat(32));
    expect(normalizeRecoveryCode("I".repeat(32))).toBe("1".repeat(32));
    expect(normalizeRecoveryCode("L".repeat(32))).toBe("1".repeat(32));
    expect(normalizeRecoveryCode("oil0".repeat(8))).toBe("0110".repeat(8));
  });

  it("rejects a code with the wrong length", () => {
    expect(normalizeRecoveryCode("0".repeat(31))).toBeNull();
    expect(normalizeRecoveryCode("0".repeat(33))).toBeNull();
    expect(normalizeRecoveryCode("")).toBeNull();
  });

  it("rejects a character outside the Crockford alphabet, including the deliberately-excluded U", () => {
    expect(normalizeRecoveryCode("U".repeat(32))).toBeNull();
    expect(normalizeRecoveryCode("!".repeat(32))).toBeNull();
  });
});

describe("formatRecoveryCode", () => {
  it("re-groups a canonical 32-character code into 8 dash-separated groups of 4", () => {
    expect(formatRecoveryCode("0".repeat(32))).toBe(
      "0000-0000-0000-0000-0000-0000-0000-0000",
    );
  });
});
