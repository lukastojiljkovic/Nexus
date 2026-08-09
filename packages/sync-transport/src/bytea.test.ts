import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";

import { base64urlToBytea, byteaToBase64url } from "./bytea.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe("bytea ↔ base64url", () => {
  it("reads the hex form PostgREST actually emits", () => {
    // Taken from a live response: `nonce` of a row inserted with 24 bytes of
    // 0x0a. The doubled backslash is JSON's; the STRING is one backslash, `x`,
    // and the digits.
    expect(byteaToBase64url("\\x0a0a0a")).toBe(bytesToBase64url(bytes(10, 10, 10)));
  });

  it("round-trips every byte value", () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) all[index] = index;
    const base64url = bytesToBase64url(all);
    expect(byteaToBase64url(base64urlToBytea(base64url))).toBe(base64url);
  });

  it("emits lower-case hex, so a round trip is byte-stable", () => {
    expect(base64urlToBytea(bytesToBase64url(bytes(0xab, 0xcd, 0xef)))).toBe("\\xabcdef");
  });

  it("accepts upper-case hex on the way in, because the format permits it", () => {
    expect(byteaToBase64url("\\xABCDEF")).toBe(bytesToBase64url(bytes(0xab, 0xcd, 0xef)));
  });

  it("reads an empty bytea as an empty string rather than as a failure", () => {
    // No column here is ever empty — the CHECKs see to that — but `\x` is a
    // legal value and the difference between „empty" and „malformed" must not
    // be decided by accident.
    expect(byteaToBase64url("\\x")).toBe("");
  });

  it("refuses everything that is not the hex form", () => {
    for (const value of [
      // The legacy `escape` output, which means the database is not the one this
      // client was written against.
      "abc\\000def",
      // A lone `\x` prefix is required.
      "0a0b0c",
      // An odd number of digits cannot be bytes.
      "\\x0a0",
      // Not hex.
      "\\x0g",
      // Not a string at all.
      42,
      null,
      undefined,
      { nonce: "\\x0a" },
      ["\\x0a"],
    ]) {
      expect(byteaToBase64url(value)).toBeNull();
    }
  });

  it("throws rather than sending bytes it could not decode", () => {
    // The asymmetry is deliberate: what goes out was produced by `sealRow`, so a
    // bad value is this client's own bug and must not reach the server, where it
    // would occupy a version number nobody can re-use.
    expect(() => base64urlToBytea("not base64url!")).toThrow(TypeError);
    expect(() => base64urlToBytea("a")).toThrow(TypeError);
  });
});
