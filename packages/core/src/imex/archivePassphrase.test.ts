import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_PASSPHRASE_LENGTH,
  MIN_ARCHIVE_PASSPHRASE_LENGTH,
  normalizeArchivePassphrase,
  validateArchivePassphrase,
} from "./archivePassphrase.js";

describe("normalizeArchivePassphrase", () => {
  it("NFKC-normalizes so a fullwidth-encoded passphrase matches its ASCII equivalent", () => {
    // Fullwidth "Ａ1" (U+FF21, U+FF11) — plausible IME/keyboard output —
    // normalizes to ASCII "A1" under NFKC.
    expect(normalizeArchivePassphrase("Ａ１bcdefghijk")).toBe(
      normalizeArchivePassphrase("A1bcdefghijk"),
    );
  });

  it("does not trim leading or trailing whitespace — spaces are part of the passphrase", () => {
    expect(normalizeArchivePassphrase("  abc123456789  ")).toBe("  abc123456789  ");
  });
});

describe("validateArchivePassphrase", () => {
  it("accepts a 12-character passphrase", () => {
    expect(validateArchivePassphrase("correcthorse")).toBeNull();
  });

  it("rejects fewer than MIN_ARCHIVE_PASSPHRASE_LENGTH characters", () => {
    expect(MIN_ARCHIVE_PASSPHRASE_LENGTH).toBe(12);
    expect(validateArchivePassphrase("short1")).toBe("tooShort"); // 6 chars
  });

  it("rejects more than MAX_ARCHIVE_PASSPHRASE_LENGTH characters", () => {
    expect(MAX_ARCHIVE_PASSPHRASE_LENGTH).toBe(256);
    expect(validateArchivePassphrase("a".repeat(257))).toBe("tooLong");
  });

  it("accepts exactly the minimum and maximum lengths", () => {
    expect(validateArchivePassphrase("a".repeat(12))).toBeNull();
    expect(validateArchivePassphrase("a".repeat(256))).toBeNull();
  });

  it("has no letter/digit requirement, unlike the passcode — 12+ characters of anything is enough", () => {
    expect(validateArchivePassphrase(" ".repeat(12))).toBeNull();
  });

  it("counts Unicode characters, not just ASCII — a Serbian passphrase is not second-class", () => {
    expect(validateArchivePassphrase("лозинкалозинка")).toBeNull();
  });

  it("validates the normalized form — a fullwidth-encoded passphrase is judged after NFKC folding", () => {
    expect(validateArchivePassphrase("Ａ１bcdefghijk")).toBeNull();
  });

  it("treats padding spaces as significant length, never trimmed away", () => {
    expect(validateArchivePassphrase("  abcdefgh  ")).toBeNull(); // 12 chars incl. spaces
  });
});
