import { describe, expect, it } from "vitest";
import {
  MAX_PASSCODE_LENGTH,
  MIN_PASSCODE_LENGTH,
  normalizePasscode,
  validatePasscode,
} from "./passcode.js";

describe("normalizePasscode", () => {
  it("NFKC-normalizes so a fullwidth-encoded passcode matches its ASCII equivalent", () => {
    // Fullwidth "Ａ1" (U+FF21, U+FF11) — plausible IME/keyboard output — normalizes
    // to ASCII "A1" under NFKC.
    expect(normalizePasscode("Ａ１bcdefgh")).toBe(normalizePasscode("A1bcdefgh"));
  });

  it("does not trim leading or trailing whitespace — spaces are part of the passcode", () => {
    expect(normalizePasscode("  abc123  ")).toBe("  abc123  ");
  });
});

describe("validatePasscode", () => {
  it("accepts an 8-character alphanumeric passcode", () => {
    expect(validatePasscode("abcd1234")).toBeNull();
  });

  it("rejects fewer than MIN_PASSCODE_LENGTH characters", () => {
    expect(MIN_PASSCODE_LENGTH).toBe(8);
    expect(validatePasscode("a1a1a1")).toBe("tooShort"); // 6 chars
  });

  it("rejects more than MAX_PASSCODE_LENGTH characters", () => {
    expect(MAX_PASSCODE_LENGTH).toBe(128);
    expect(validatePasscode("a1".repeat(65))).toBe("tooLong"); // 130 chars
  });

  it("accepts exactly the minimum and maximum lengths", () => {
    expect(validatePasscode("a1234567")).toBeNull(); // 8 chars
    expect(validatePasscode("a1".repeat(64))).toBeNull(); // 128 chars
  });

  it("rejects a passcode with only letters", () => {
    expect(validatePasscode("abcdefgh")).toBe("needsLetterAndDigit");
  });

  it("rejects a passcode with only digits", () => {
    expect(validatePasscode("12345678")).toBe("needsLetterAndDigit");
  });

  it("counts Unicode letters and digits, not just ASCII — a Serbian passcode is not second-class", () => {
    expect(validatePasscode("лозинка1")).toBeNull();
    expect(validatePasscode("шифра123")).toBeNull();
  });

  it("validates the normalized form — a fullwidth-encoded passcode is judged after NFKC folding", () => {
    expect(validatePasscode("Ａ１bcdefgh")).toBeNull();
  });

  it("treats padding spaces as significant length, never trimmed away", () => {
    expect(validatePasscode("  a1cd  ")).toBeNull(); // 8 chars incl. spaces, has letter+digit
  });
});
