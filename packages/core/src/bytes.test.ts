import { describe, expect, it } from "vitest";

import { base64ToBytes, base64ToBytesOrNull, bytesToBase64, bytesToHex, hexToBytes } from "./bytes.js";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("base64 against RFC 4648 §10", () => {
  // The published test vectors, verbatim. An EXTERNAL authority rather than a
  // round trip: a codec that is wrong in both directions round-trips perfectly.
  const vectors: readonly (readonly [string, string])[] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  it.each(vectors)("encodes %o as %o", (text, encoded) => {
    expect(bytesToBase64(ascii(text))).toBe(encoded);
  });

  it.each(vectors)("decodes %o back from %o", (text, encoded) => {
    expect(base64ToBytes(encoded)).toEqual(ascii(text));
  });
});

describe("base64 edges", () => {
  it("covers the whole byte range, which is what catches a sign error", () => {
    // Bytes 0x80–0xff are where a `charCodeAt` that forgets to mask, or a
    // `String.fromCharCode` fed a signed value, goes wrong — and only there.
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });

  it("survives an input far past the argument-count limit", () => {
    // `String.fromCharCode(...bytes)` — the spread form this module refuses to
    // use — throws `RangeError: Maximum call stack size exceeded` around here.
    // An attachment is exactly this size, so the loop is not a style choice.
    const large = new Uint8Array(300_000);
    for (let i = 0; i < large.length; i += 1) large[i] = (i * 31) & 0xff;
    expect(base64ToBytes(bytesToBase64(large))).toEqual(large);
  });

  it("throws rather than returning something plausible for input that is not base64", () => {
    expect(() => base64ToBytes("not base64!")).toThrow();
    expect(base64ToBytesOrNull("not base64!")).toBeNull();
  });

  it("hands back an ArrayBuffer-backed view, which is what WebCrypto requires", () => {
    // The bare name `Uint8Array` means `Uint8Array<ArrayBufferLike>`, which
    // `BufferSource` rejects. This asserts the runtime half of the same claim
    // the return type makes at compile time.
    expect(base64ToBytes("Zm9v").buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe("hex", () => {
  it("writes lower case, two characters per byte, including the leading zero", () => {
    expect(bytesToHex(Uint8Array.of(0x00, 0x0f, 0xff, 0xa5))).toBe("000fffa5");
  });

  it("reads back what it wrote, over the whole byte range", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) all[i] = i;
    expect(hexToBytes(bytesToHex(all))).toEqual(all);
  });

  it("accepts upper case and whitespace, because hex has no case and a dump has line breaks", () => {
    expect(hexToBytes("DE AD\nBE\tEF")).toEqual(Uint8Array.of(0xde, 0xad, 0xbe, 0xef));
  });

  it("refuses an odd digit count instead of guessing which end lost a nibble", () => {
    expect(hexToBytes("abc")).toBeNull();
  });

  it("refuses a non-hex character instead of skipping it", () => {
    // „deadbeeg" differs from a valid key in one character. Skipping the „g"
    // would produce a SHORTER key that decodes without complaint.
    expect(hexToBytes("deadbeeg")).toBeNull();
  });

  it("reads the empty string as no bytes, which is not the same as a refusal", () => {
    expect(hexToBytes("")).toEqual(new Uint8Array(0));
  });
});
