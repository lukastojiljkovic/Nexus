/**
 * The one door random bytes come through, for every developer tool that needs
 * them — token and password generation, identifiers, the line shuffler.
 *
 * **Why it is a port and not a `crypto.getRandomValues` call at the point of
 * use.** A generator tested against a real CSPRNG can only be asserted on its
 * SHAPE — „sixteen characters, all from the alphabet" — which is exactly the
 * assertion that passes on a badly biased generator too. Handing the bytes in
 * turns „shuffles the lines" into „produces this order" and „samples uniformly"
 * into „rejects this byte and takes the next", and those are the properties
 * worth having a test for.
 *
 * **Why it is one file and not one per module.** It was three: `cryptoTools`,
 * `system` and `text` each declared the same one-method interface and its
 * chunked implementation, under two different names. Three copies of a
 * primitive is not three times the code, it is three chances to disagree — and
 * they already did, on the only question that matters here. Given a negative
 * count, one threw, one threw from the `Uint8Array` constructor, and one
 * clamped to zero and returned an EMPTY array: a caller that computed its
 * length wrongly got a silent zero-byte "secret" rather than a crash. The
 * strict spelling below is the one that survives, and now there is only one.
 */

/** Exactly `count` bytes. An implementation must never return fewer. */
export interface RandomPort {
  readonly bytes: (count: number) => Uint8Array;
}

/** `getRandomValues`' per-call ceiling (Web Crypto API §10.1, `QuotaExceededError`). */
const RANDOM_CHUNK_BYTES = 65_536;

/**
 * The real port: the platform CSPRNG, chunked because bulk generation asks for
 * more than one `getRandomValues` call is specified to serve, and the spec's
 * answer to too much is an exception rather than a short read.
 *
 * A non-integer or negative `count` throws rather than being repaired. This is
 * the one place in the drawer where a quiet repair would be dangerous: every
 * caller here is generating a secret, and a length computed wrongly must stop
 * the program, not hand back fewer bytes than the entropy figure printed beside
 * them claims.
 */
export const webCryptoRandom: RandomPort = {
  bytes(count: number): Uint8Array {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`webCryptoRandom.bytes: count must be a non-negative integer, got ${count}`);
    }
    const out = new Uint8Array(count);
    for (let offset = 0; offset < count; offset += RANDOM_CHUNK_BYTES) {
      globalThis.crypto.getRandomValues(
        out.subarray(offset, Math.min(offset + RANDOM_CHUNK_BYTES, count)),
      );
    }
    return out;
  },
};
