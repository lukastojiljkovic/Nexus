import { describe, expect, it } from "vitest";
import {
  base64urlToBytes,
  bytesToBase64url,
  concatBytes,
  constantTimeEqual,
  encodeStruct,
  isSafeFieldName,
  uint64BE,
  utf8,
} from "./bytes.js";

describe("bytesToBase64url / base64urlToBytes", () => {
  it("round-trips every input length modulo 3 (the three padding cases)", () => {
    for (let length = 0; length <= 9; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const encoded = bytesToBase64url(bytes);
      expect(base64urlToBytes(encoded)).toEqual(bytes);
    }
  });

  it("uses the URL-safe alphabet and no padding", () => {
    // 0xfb 0xff encodes to "+/8" in standard base64; base64url must say "-_8".
    expect(bytesToBase64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(bytesToBase64url(new Uint8Array([0x00]))).toBe("AA");
  });

  it("matches known answers for the RFC 4648 test vectors", () => {
    expect(bytesToBase64url(utf8("f"))).toBe("Zg");
    expect(bytesToBase64url(utf8("fo"))).toBe("Zm8");
    expect(bytesToBase64url(utf8("foo"))).toBe("Zm9v");
    expect(bytesToBase64url(utf8("foobar"))).toBe("Zm9vYmFy");
  });

  it("rejects anything that is not canonical base64url rather than guessing", () => {
    expect(base64urlToBytes("Zm9v=")).toBeNull(); // padding
    expect(base64urlToBytes("Zm+v")).toBeNull(); // standard-alphabet character
    expect(base64urlToBytes("Zm9 v")).toBeNull(); // whitespace
    expect(base64urlToBytes("Z")).toBeNull(); // impossible length
  });
});

describe("constantTimeEqual", () => {
  it("is true only for identical byte strings", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });

  it("is false for different lengths without reading past either end", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe("encodeStruct", () => {
  it("is injective across a field-boundary shift — the canonicalization defect", () => {
    // Plain concatenation would make these two identical. Length prefixes are
    // what stop a server splicing "a" + "b/c" into "a/b" + "c".
    const left = encodeStruct([utf8("a"), utf8("b/c")]);
    const right = encodeStruct([utf8("a/b"), utf8("c")]);
    expect(bytesToBase64url(left)).not.toBe(bytesToBase64url(right));
  });

  it("writes a 4-byte big-endian length before each field", () => {
    expect(Array.from(encodeStruct([new Uint8Array([0xaa])]))).toEqual([0, 0, 0, 1, 0xaa]);
    expect(Array.from(encodeStruct([]))).toEqual([]);
    expect(Array.from(encodeStruct([new Uint8Array([])]))).toEqual([0, 0, 0, 0]);
  });
});

describe("uint64BE", () => {
  it("encodes eight big-endian bytes", () => {
    expect(Array.from(uint64BE(0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(uint64BE(1))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(uint64BE(0x0102030405))).toEqual([0, 0, 0, 1, 2, 3, 4, 5]);
  });

  it("rejects a value that is not a non-negative safe integer", () => {
    expect(() => uint64BE(-1)).toThrow(TypeError);
    expect(() => uint64BE(1.5)).toThrow(TypeError);
    expect(() => uint64BE(Number.NaN)).toThrow(TypeError);
    expect(() => uint64BE(Number.MAX_SAFE_INTEGER + 2)).toThrow(TypeError);
  });
});

describe("concatBytes", () => {
  it("joins in order and copies rather than aliasing", () => {
    const a = new Uint8Array([1, 2]);
    const joined = concatBytes(a, new Uint8Array([3]));
    a[0] = 9;
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });
});

describe("isSafeFieldName", () => {
  it("rejects the prototype-poisoning keys and accepts ordinary ones", () => {
    expect(isSafeFieldName("title")).toBe(true);
    expect(isSafeFieldName("due_date")).toBe(true);
    expect(isSafeFieldName("__proto__")).toBe(false);
    expect(isSafeFieldName("constructor")).toBe(false);
    expect(isSafeFieldName("prototype")).toBe(false);
    expect(isSafeFieldName("")).toBe(false);
  });
});
