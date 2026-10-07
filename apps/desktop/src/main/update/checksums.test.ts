import { describe, expect, it } from "vitest";

import { checksumFor, parseSha256Sums } from "./checksums.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("reading SHA256SUMS.txt", () => {
  it("reads the text and binary forms `sha256sum` writes", () => {
    const sums = parseSha256Sums(
      [
        `${A}  Nexus-Setup-1.5.0.exe`,
        `${B} *nexus-1.5.0-linux-x64.tar.gz`,
        "",
        "not a checksum line",
        `${A.toUpperCase()}  upper.txt`,
      ].join("\n"),
    );
    expect(checksumFor(sums, "Nexus-Setup-1.5.0.exe")).toBe(A);
    expect(checksumFor(sums, "nexus-1.5.0-linux-x64.tar.gz")).toBe(B);
    // Upper-case hex is normalised so a comparison cannot fail on case alone.
    expect(checksumFor(sums, "upper.txt")).toBe(A);
    // The unreadable line was skipped rather than guessed at.
    expect(sums.size).toBe(3);
  });

  it("answers null for a file that does not list the asset", () => {
    const sums = parseSha256Sums(`${A}  Nexus-Setup-1.4.0.exe\n`);
    expect(checksumFor(sums, "Nexus-Setup-1.5.0.exe")).toBeNull();
  });

  it("reads a binary-mode line and CRLF line ends", () => {
    const sums = parseSha256Sums(`${A} *Nexus-Setup-1.5.0.exe\r\n${B}  other.exe\r\n`);
    expect(checksumFor(sums, "Nexus-Setup-1.5.0.exe")).toBe(A);
    expect(checksumFor(sums, "other.exe")).toBe(B);
  });

  it("skips a 63-character digest, a single-space separator and a tab separator", () => {
    // The format is positional: 64 hex, then two separator characters. A line
    // that is one hex short, one space short, or tab-separated is a different
    // shape, and guessing at it would be the one way a bad line could match.
    const sums = parseSha256Sums(
      [
        `${"a".repeat(63)}  short.exe`,
        `${A} single-space.exe`,
        `${A}\tNexus-Setup-1.5.0.exe`,
      ].join("\n"),
    );
    expect(sums.size).toBe(0);
  });

  it("drops a name that appears twice, because two hashes for it cannot both be trusted", () => {
    for (const second of [B, A]) {
      const sums = parseSha256Sums(
        [`${A}  Nexus-Setup-1.5.0.exe`, `${second}  Nexus-Setup-1.5.0.exe`].join("\n"),
      );
      // A duplicate is ambiguous whether the two hashes agree or not, and the
      // answer is „no checksum" so the installer is refused either way.
      expect(checksumFor(sums, "Nexus-Setup-1.5.0.exe"), second).toBeNull();
    }
  });

  it("reads nothing out of an empty or damaged file", () => {
    for (const text of ["", "\n\n", "garbage", `${"z".repeat(64)}  x.exe`]) {
      expect(parseSha256Sums(text).size, JSON.stringify(text)).toBe(0);
    }
  });
});
