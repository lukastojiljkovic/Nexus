import { describe, expect, it } from "vitest";

import { ByteLruCache } from "./lru.js";

/**
 * The cluster cache's two promises: the byte cap holds, and the entry that was
 * used most recently is the one that survives.
 *
 * The values below are `Uint8Array`s of known lengths, so "how much is held"
 * is arithmetic a reader can check by hand rather than a number the cache
 * reports about itself.
 */
describe("ByteLruCache", () => {
  const sized = (bytes: number): Uint8Array => new Uint8Array(bytes);

  it("evicts the least recently used entry when the cap is reached", () => {
    const cache = new ByteLruCache<string, Uint8Array>(30, (value) => value.byteLength);
    cache.set("a", sized(10));
    cache.set("b", sized(10));
    cache.set("c", sized(10));
    expect(cache.bytes).toBe(30);
    cache.set("d", sized(10));
    // 40 bytes of values in a 30-byte cap: exactly one goes, and it is the
    // oldest.
    expect(cache.count).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.bytes).toBe(30);
  });

  it("counts a read as use", () => {
    const cache = new ByteLruCache<string, Uint8Array>(30, (value) => value.byteLength);
    cache.set("a", sized(10));
    cache.set("b", sized(10));
    cache.set("c", sized(10));
    cache.get("a");
    cache.set("d", sized(10));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
  });

  it("refuses to store an entry larger than the whole cache", () => {
    const cache = new ByteLruCache<string, Uint8Array>(30, (value) => value.byteLength);
    cache.set("a", sized(10));
    cache.set("huge", sized(31));
    // Storing it would evict everything and then be evicted itself; the cache
    // keeps what it had instead.
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.bytes).toBe(10);
  });

  it("replaces a value under the same key instead of counting it twice", () => {
    const cache = new ByteLruCache<string, Uint8Array>(100, (value) => value.byteLength);
    cache.set("a", sized(10));
    cache.set("a", sized(40));
    expect(cache.count).toBe(1);
    expect(cache.bytes).toBe(40);
  });

  it("empties on clear", () => {
    const cache = new ByteLruCache<string, Uint8Array>(100, (value) => value.byteLength);
    cache.set("a", sized(10));
    cache.clear();
    expect(cache.count).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it("refuses a cap that is not a positive whole number of bytes", () => {
    expect(() => new ByteLruCache<string, Uint8Array>(0, (value) => value.byteLength)).toThrow();
    expect(() => new ByteLruCache<string, Uint8Array>(-1, (value) => value.byteLength)).toThrow();
  });
});
