/**
 * The reader's cluster cache: a least-recently-used map with a BYTE cap.
 *
 * **Why bytes and not entries.** A cluster is one unit of decompression and its
 * size varies by two orders of magnitude between packs: a fixture cluster is
 * 16 KB, an article cluster is a megabyte or two, and the index cluster of the
 * English Wikipedia pack is gigabytes. A cap counted in entries would therefore
 * mean nothing — "keep 32 clusters" is 0.4 MB in one file and 30 GB in the next,
 * and the failure mode of the second is the machine swapping.
 *
 * **Why LRU and not FIFO.** A page's article is read repeatedly while the user
 * scrolls it (each resource in the HTML is a separate request, and they come
 * from the same cluster), so recency is exactly the signal that matters: the
 * cluster just used is the cluster about to be used again.
 *
 * The cache is deliberately NOT thread-aware and holds no locks: the reader is
 * synchronous (see `reader.ts`), so no two operations can interleave.
 */
export class ByteLruCache<K, V> {
  private readonly entries = new Map<K, V>();
  private used = 0;

  constructor(
    private readonly capBytes: number,
    private readonly sizeOf: (value: V) => number,
  ) {
    if (!Number.isSafeInteger(capBytes) || capBytes <= 0) {
      throw new Error("A cache cap must be a positive whole number of bytes.");
    }
  }

  /** The value for `key`, marked as most recently used, or `undefined`. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Re-inserted rather than left in place: a `Map` iterates in insertion
    // order, and that order IS the recency list this class evicts from.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /**
   * Stores `value` under `key`, evicting the least recently used entries until
   * the cap holds.
   *
   * A single value larger than the cap is NOT stored: caching it would evict
   * everything else and then be evicted itself on the next insert, which is the
   * most expensive possible way to remember nothing.
   */
  set(key: K, value: V): void {
    const size = this.sizeOf(value);
    if (size > this.capBytes) return;
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.used -= this.sizeOf(previous);
    }
    this.entries.set(key, value);
    this.used += size;
    while (this.used > this.capBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted !== undefined) this.used -= this.sizeOf(evicted);
    }
  }

  /** Bytes currently held. Never above the cap. */
  get bytes(): number {
    return this.used;
  }

  get count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.used = 0;
  }
}
