import { describe, expect, it } from "vitest";
import { canonicalJson, parseJsonValue } from "./json.js";

describe("canonicalJson", () => {
  it("sorts object keys so two devices serialise equal state to equal bytes", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("sorts recursively and leaves array order alone", () => {
    expect(canonicalJson({ z: { y: 1, x: [3, 1, 2] } })).toBe('{"z":{"x":[3,1,2],"y":1}}');
  });

  it("sorts by UTF-16 code unit, not by locale", () => {
    // localeCompare would order these by Serbian collation, which differs
    // between ICU versions — two devices would then disagree on the bytes.
    expect(canonicalJson({ "š": 1, s: 2, S: 3 })).toBe('{"S":3,"s":2,"š":1}');
  });

  it("round-trips through parseJsonValue", () => {
    const value = { a: [1, "two", true, null], b: { c: -0.5 } };
    expect(canonicalJson(parseJsonValue(canonicalJson(value)) ?? null)).toBe(canonicalJson(value));
  });

  it("refuses a non-finite number instead of silently writing null", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it("refuses the prototype-poisoning key", () => {
    expect(() => canonicalJson(JSON.parse('{"__proto__":1}') as never)).toThrow(TypeError);
  });
});

describe("parseJsonValue", () => {
  it("returns null for text that is not JSON", () => {
    expect(parseJsonValue("{")).toBeNull();
    expect(parseJsonValue("")).toBeNull();
  });

  it("returns null for JSON carrying a __proto__ key", () => {
    expect(parseJsonValue('{"__proto__":{"polluted":true}}')).toBeNull();
    expect(parseJsonValue('{"nested":{"__proto__":1}}')).toBeNull();
  });

  it("accepts every JSON scalar and container", () => {
    expect(parseJsonValue('{"a":[1,"x",true,false,null]}')).toEqual({ a: [1, "x", true, false, null] });
    expect(parseJsonValue("42")).toBe(42);
    expect(parseJsonValue('"x"')).toBe("x");
  });
});
