import { argon2id as wasmArgon2id } from "hash-wasm";
import type {
  AeadOpenRequest,
  AeadSealRequest,
  Argon2idRequest,
  CryptoPort,
  HkdfRequest,
  X25519KeyPair,
  X25519SecretKey,
} from "@nexus/sync-crypto";
import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  SHA256_BYTES,
  X25519_PUBLIC_KEY_BYTES,
} from "@nexus/sync-crypto";

/**
 * ONE ADAPTER, NOT TWO, and that is the whole security argument of this file.
 *
 * `port.ts` describes „the Electron main process over `node:crypto` plus a WASM
 * Argon2, a browser over WebCrypto plus the same WASM" — two implementations,
 * with the standing requirement that they „MUST agree byte-for-byte: this
 * derives the key that wraps the master key on the server, so a browser and a
 * desktop that disagree about Argon2id produce an account nobody can open".
 *
 * Two implementations that must agree byte-for-byte is a test obligation that
 * never ends: every parameter, every encoding, every edge case has to be
 * checked in both, forever, and the failure is not a red test — it is a user
 * whose data is cryptographically unreachable from one of their own devices.
 * The way to discharge an obligation like that is to remove it. Everything this
 * port needs exists in WebCrypto, `globalThis.crypto` is a standard global in
 * both Node 24 and every browser this product targets, and Argon2id arrives as
 * WASM which is byte-identical by construction. So there is one implementation,
 * it runs unmodified in the Electron main process, the renderer, the browser
 * and Vitest, and „the two adapters agree" is true because there is one.
 *
 * `@nexus/core` already made this call for the LOCAL key chain — `keyChain.ts`
 * says it derives „using only WebCrypto (`globalThis.crypto`) and `hash-wasm`'s
 * WASM Argon2id". This is the same decision applied to sync, and the same
 * `hash-wasm` version, which is what makes the two subsystems' Argon2 outputs
 * comparable at all.
 *
 * WHY X25519 IS WEBCRYPTO AND NOT A LIBRARY. `crypto.subtle` implements X25519
 * in Node 20+, Chrome 133+, Firefox 132+ and Safari 18.4+. That buys three
 * things a pure-JS curve cannot: the private scalar never enters the JS heap
 * (`generateKey` with `extractable: false` returns a `CryptoKey` handle, which
 * is exactly the shape `X25519SecretKey` was defined as an opaque `object` to
 * allow), the implementation is the platform's constant-time one, and low-order
 * points are rejected by the platform before this file sees them. All three
 * were verified against Node 24 rather than assumed: a zero public key answers
 * `OperationError`, and the code below turns that into the `null` the port
 * requires.
 */

const HKDF_MAX_OUTPUT_BYTES = 255 * SHA256_BYTES;

/**
 * HMAC's block size, and the reason it is named here.
 *
 * The port requires `hmacSha256` to „accept a key of any length (the RFC 2104
 * key schedule)". WebCrypto refuses to import a zero-length HMAC key at all —
 * `importKey` throws before any HMAC is computed. RFC 2104's schedule zero-PADS
 * a short key to the block size, so an empty key and a block of zero bytes are
 * the SAME key, and substituting one for the other changes no output. That is
 * the substitution below: it satisfies the contract without inventing a
 * different HMAC.
 */
const HMAC_BLOCK_BYTES = 64;

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (c?.subtle === undefined) {
    // Not a runtime condition to recover from: every environment this package
    // is built for has WebCrypto, so its absence means the module was loaded
    // somewhere it was never meant to run — an insecure (non-HTTPS, non-
    // localhost) origin being the realistic case, where `crypto.subtle` is
    // undefined by design. Failing here names that, rather than producing
    // `undefined is not a function` five frames away.
    throw new Error(
      "WebCrypto is unavailable. @nexus/sync-port requires globalThis.crypto.subtle, " +
        "which browsers expose only in a secure context (HTTPS or localhost).",
    );
  }
  return c.subtle;
};

/**
 * `Uint8Array` → the `BufferSource` WebCrypto wants, with no copy where none is
 * needed.
 *
 * A `Uint8Array` may be a VIEW onto a larger buffer — which is what
 * `subarray()` returns, and what `encodeStruct` in `@nexus/sync-crypto`
 * produces all over. Handing `.buffer` to WebCrypto would pass the WHOLE
 * backing buffer and silently authenticate or encrypt bytes the caller never
 * offered. Passing the view itself is correct and is what this does; the
 * function exists to hold this comment, because the „optimisation" of reaching
 * for `.buffer` is the kind a future reader makes in good faith.
 */
const view = (bytes: Uint8Array): BufferSource =>
  // The cast is TypeScript 5.7's `Uint8Array<ArrayBufferLike>` meeting
  // WebCrypto's `BufferSource`, which is `ArrayBufferView<ArrayBuffer>`. The
  // gap is `SharedArrayBuffer`: a `Uint8Array` COULD be backed by one, and
  // WebCrypto rejects those at runtime. Nothing in this product ever allocates
  // shared memory — there is no `SharedArrayBuffer` anywhere in the repository,
  // and the web app deliberately does not set the COOP/COEP headers that would
  // make one available — so the type the compiler cannot rule out is one the
  // runtime cannot produce.
  bytes as Uint8Array<ArrayBuffer>;

const bytesOf = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

/** Constant-time-ish all-zero test. Not secret-dependent branching: the answer is public. */
const isAllZero = (bytes: Uint8Array): boolean => {
  let acc = 0;
  for (const byte of bytes) acc |= byte;
  return acc === 0;
};

/**
 * The real port.
 *
 * Stateless and cheap to construct — it holds no key, opens no handle and
 * caches nothing, so a caller may make one per process or one per call. It is a
 * factory rather than a frozen singleton object so that a test can wrap it, and
 * so nothing is executed at module load: `subtle()` is called inside each
 * method, which keeps importing this module safe in an environment that has no
 * WebCrypto until the moment something actually needs crypto.
 */
export function createWebCryptoPort(): CryptoPort {
  return {
    randomBytes(length: number): Uint8Array {
      if (!Number.isInteger(length) || length < 0) {
        throw new Error(`randomBytes: length must be a non-negative integer, got ${length}`);
      }
      // 65 536 is the per-call ceiling `getRandomValues` is specified to
      // enforce (Web Crypto API §10.1, QuotaExceededError). Nothing in
      // `@nexus/sync-crypto` asks for more than 32, so this is a guard against
      // a future caller rather than a loop nobody needs.
      if (length > 65536) {
        throw new Error(`randomBytes: ${length} exceeds the 65536-byte per-call limit`);
      }
      const out = new Uint8Array(length);
      globalThis.crypto.getRandomValues(out);
      return out;
    },

    async sha256(data: Uint8Array): Promise<Uint8Array> {
      return bytesOf(await subtle().digest("SHA-256", view(data)));
    },

    async hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
      const material = key.length === 0 ? new Uint8Array(HMAC_BLOCK_BYTES) : key;
      const cryptoKey = await subtle().importKey(
        "raw",
        view(material),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return bytesOf(await subtle().sign("HMAC", cryptoKey, view(data)));
    },

    async hkdfSha256(request: HkdfRequest): Promise<Uint8Array> {
      const { ikm, salt, info, outputBytes } = request;
      if (!Number.isInteger(outputBytes) || outputBytes <= 0) {
        throw new Error(`hkdfSha256: outputBytes must be a positive integer, got ${outputBytes}`);
      }
      // RFC 5869 §2.3 caps expansion at 255 hash lengths. WebCrypto enforces
      // this too, but with an `OperationError` that says nothing; the port's
      // contract names the rule, so the rule is stated here.
      if (outputBytes > HKDF_MAX_OUTPUT_BYTES) {
        throw new Error(
          `hkdfSha256: outputBytes ${outputBytes} exceeds RFC 5869's ${HKDF_MAX_OUTPUT_BYTES}-byte maximum`,
        );
      }
      // `deriveBits` on an HKDF key is extract-then-expand, which is what the
      // port requires — WebCrypto has no expand-only mode, so the shape that
      // would silently disagree with a hand-rolled adapter is not reachable
      // from here.
      const base = await subtle().importKey("raw", view(ikm), "HKDF", false, ["deriveBits"]);
      const derived = await subtle().deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: view(salt), info: view(info) },
        base,
        outputBytes * 8,
      );
      return bytesOf(derived);
    },

    async argon2id(request: Argon2idRequest): Promise<Uint8Array> {
      const { password, salt, params, outputBytes } = request;
      // hash-wasm accepts these as numbers and validates them itself, but its
      // errors name its own parameter spellings (`memorySize`) rather than the
      // port's (`memoryKiB`), which sends a reader to the wrong file.
      if (params.memoryKiB <= 0 || params.iterations <= 0 || params.parallelism <= 0) {
        throw new Error(
          `argon2id: params must all be positive, got memoryKiB=${params.memoryKiB} ` +
            `iterations=${params.iterations} parallelism=${params.parallelism}`,
        );
      }
      if (!Number.isInteger(outputBytes) || outputBytes < 4) {
        throw new Error(`argon2id: outputBytes must be an integer >= 4, got ${outputBytes}`);
      }
      return wasmArgon2id({
        // BYTES, NOT A STRING. `port.ts` says „`password` is bytes, not a
        // string: the caller owns normalization", and that is load-bearing:
        // hash-wasm would UTF-8 encode a string, so a caller that had already
        // normalised and encoded would get a different key on a platform whose
        // idea of the string differed. `@nexus/core`'s local chain passes a
        // string because it owns both ends; this port does not.
        password,
        salt,
        parallelism: params.parallelism,
        memorySize: params.memoryKiB,
        iterations: params.iterations,
        hashLength: outputBytes,
        outputType: "binary",
      });
    },

    async aeadSeal(request: AeadSealRequest): Promise<Uint8Array> {
      const { key, nonce, plaintext, aad } = request;
      assertKeyAndNonce("aeadSeal", key, nonce);
      const cryptoKey = await importAesKey(key, "encrypt");
      const sealed = await subtle().encrypt(
        // WebCrypto appends the 128-bit tag to the ciphertext, which is exactly
        // the layout the port specifies („the 16-byte tag APPENDED … never
        // returned as a separate field"). No slicing here, deliberately.
        { name: "AES-GCM", iv: view(nonce), additionalData: view(aad), tagLength: 128 },
        cryptoKey,
        view(plaintext),
      );
      return bytesOf(sealed);
    },

    async aeadOpen(request: AeadOpenRequest): Promise<Uint8Array | null> {
      const { key, nonce, ciphertext, aad } = request;
      // Thrown, not `null`: a malformed key or nonce LENGTH is a bug in the
      // caller, and the port draws that line explicitly. Only authentication
      // failure is an expected outcome.
      assertKeyAndNonce("aeadOpen", key, nonce);
      const cryptoKey = await importAesKey(key, "decrypt");
      try {
        const opened = await subtle().decrypt(
          { name: "AES-GCM", iv: view(nonce), additionalData: view(aad), tagLength: 128 },
          cryptoKey,
          view(ciphertext),
        );
        return bytesOf(opened);
      } catch {
        // EVERY failure collapses to `null`, and the bare `catch` is the point
        // rather than laziness. A ciphertext shorter than the tag throws
        // `OperationError` just as a forged tag does; distinguishing them here
        // and reporting the difference upward would hand an attacker the oracle
        // the port's comment on this method exists to deny.
        return null;
      }
    },

    async x25519GenerateKeyPair(): Promise<X25519KeyPair> {
      const pair = (await subtle().generateKey({ name: "X25519" }, false, [
        "deriveBits",
      ])) as CryptoKeyPair;
      // The private key is `extractable: false`, so the scalar never exists as
      // JS-visible bytes and the „you cannot erase a Uint8Array" problem
      // `port.ts` describes does not arise. The PUBLIC key is exported raw
      // because it is meant to be sent.
      const publicKey = bytesOf(await subtle().exportKey("raw", pair.publicKey));
      return { publicKey, secretKey: pair.privateKey };
    },

    async x25519SharedSecret(
      secretKey: X25519SecretKey,
      peerPublicKey: Uint8Array,
    ): Promise<Uint8Array | null> {
      if (peerPublicKey.length !== X25519_PUBLIC_KEY_BYTES) return null;
      if (!isCryptoKey(secretKey)) {
        // A bug, not an attack: `secretKey` comes from this port's own
        // `x25519GenerateKeyPair` and nowhere else.
        throw new Error("x25519SharedSecret: secretKey is not a CryptoKey from this port");
      }
      let peer: CryptoKey;
      try {
        peer = await subtle().importKey("raw", view(peerPublicKey), { name: "X25519" }, false, []);
      } catch {
        // A 32-byte string that is not a valid u-coordinate encoding. `null`,
        // for the same reason a low-order point is `null`: the caller's next
        // move is identical either way.
        return null;
      }
      let shared: Uint8Array;
      try {
        shared = bytesOf(await subtle().deriveBits({ name: "X25519", public: peer }, secretKey, 256));
      } catch {
        // WHERE THE LOW-ORDER CHECK ACTUALLY HAPPENS on this platform. Node 24
        // and the browsers answer `OperationError` for the twelve inputs whose
        // shared secret is all-zero, rather than returning the zeros —
        // verified, not assumed.
        return null;
      }
      // AND THE SAME CHECK AGAIN, because the one above depends on a platform
      // behaviour that RFC 7748 §6.1 makes optional for implementations
      // („may"). A platform that returned the zeros instead of throwing would
      // otherwise hand a man in the middle a shared secret it chose, and every
      // downstream confirmation would then rest on the pairing code alone.
      // `pairing.ts` checks a third time; three layers, because the cost is a
      // loop over 32 bytes.
      return isAllZero(shared) ? null : shared;
    },
  };
}

function assertKeyAndNonce(where: string, key: Uint8Array, nonce: Uint8Array): void {
  if (key.length !== AEAD_KEY_BYTES) {
    throw new Error(`${where}: key must be ${AEAD_KEY_BYTES} bytes, got ${key.length}`);
  }
  if (nonce.length !== AEAD_NONCE_BYTES) {
    throw new Error(`${where}: nonce must be ${AEAD_NONCE_BYTES} bytes, got ${nonce.length}`);
  }
}

async function importAesKey(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return subtle().importKey("raw", view(key), { name: "AES-GCM" }, false, [usage]);
}

/**
 * `instanceof CryptoKey` is not usable here.
 *
 * `CryptoKey` is a global in browsers and in Node 24, but the two are different
 * constructors, and a `CryptoKey` produced in an Electron renderer and passed
 * through structured clone to main would fail an `instanceof` against main's
 * global. A structural check answers the only question this code has — „did
 * this come from `generateKey`" — without depending on which realm it came
 * from.
 */
function isCryptoKey(value: unknown): value is CryptoKey {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; algorithm?: unknown; usages?: unknown };
  return (
    typeof candidate.type === "string" &&
    typeof candidate.algorithm === "object" &&
    Array.isArray(candidate.usages)
  );
}
