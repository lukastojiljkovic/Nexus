/**
 * A `CryptoPort` for tests. **NOT CRYPTOGRAPHY. Never ship this.**
 *
 * Exported from `@nexus/sync-crypto/testing` — a separate subpath from the
 * package barrel, so nothing can reach it by importing `@nexus/sync-crypto`
 * and no production bundle pulls it in by accident.
 *
 * What is real and what is not, stated plainly, because a test that passes
 * against a fake primitive proves only what the fake models:
 *
 *  - **Real** (WebCrypto): SHA-256, HMAC-SHA256, HKDF-SHA256 and X25519 — the
 *    same primitives the shipped adapter uses, byte-for-byte.
 *  - **Real, but a DIFFERENT AEAD than production**: AES-256-GCM, with the
 *    24-byte nonce this package specifies (NIST SP 800-38D allows any IV length;
 *    GCM derives J0 through GHASH when it is not 12 bytes). The shipped adapter
 *    uses XChaCha20-Poly1305, which WebCrypto does not have — and reaching it
 *    here would mean taking the runtime dependency this package's whole shape
 *    exists to avoid. The substitution is invisible to everything the protocol
 *    code can observe: same key size, same nonce size, same
 *    `plaintext.length + 16` output, same tamper-detection semantics. So the
 *    tamper, wrong-key, wrong-AAD and reflection tests here exercise a genuine
 *    AEAD, not a toy — they simply do not prove that the sealed bytes are the
 *    ones a real device produces. THAT is proved where the real primitive lives:
 *    `@nexus/sync-port` checks the shipped adapter against
 *    `draft-irtf-cfrg-xchacha-03` §A.3.1 and round-trips `sealRow`/`openRow`
 *    through it.
 *  - **Fake**: Argon2id. It is HKDF-SHA256 with the cost parameters folded into
 *    the `info` string. That is deterministic, instant, and structurally
 *    faithful in the only way the protocol code can observe — different
 *    parameters and different salts give different bytes — but it has NO
 *    memory hardness and NO work factor, so it proves nothing about resistance
 *    to guessing. That property belongs to the real adapter and to the
 *    parameters in `WEB_KDF_PARAMS` / `PAIRING_KDF_PARAMS`, and is verified by
 *    reading them, not by running this.
 *  - **Deterministic**: `randomBytes`, from a seeded PRNG, so every nonce, key
 *    and pairing code a test sees is reproducible and assertable. Seed it with
 *    `createFakeCryptoPort({ seed })`, or force exact bytes with
 *    `enqueueRandom` when a test needs a specific nonce.
 *  - **Not deterministic**: `x25519GenerateKeyPair`, which uses the platform's
 *    real generator because WebCrypto offers no way to build an X25519 pair
 *    from supplied bytes and still export the public key. No test asserts on
 *    those bytes; the handshake tests assert on behaviour.
 *
 * This file is the one place in the package that touches a platform global
 * (`globalThis.crypto`). That is exactly the point of the port: the rest of the
 * package cannot.
 */

import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  X25519_PUBLIC_KEY_BYTES,
  type AeadOpenRequest,
  type AeadSealRequest,
  type Argon2idRequest,
  type CryptoPort,
  type HkdfRequest,
  type X25519KeyPair,
  type X25519SecretKey,
} from "../port.js";

/** Options for {@link createFakeCryptoPort}. */
export interface FakeCryptoPortOptions {
  /** PRNG seed. The same seed always yields the same byte stream. */
  readonly seed?: number;
}

/** The fake, plus the test-only levers the port interface has no business carrying. */
export interface FakeCryptoPort extends CryptoPort {
  /**
   * Forces the next `randomBytes(n)` call to return exactly these bytes.
   * Queued in order; once the queue drains, the PRNG takes over again. Used to
   * pin a nonce so a test can demonstrate what nonce reuse would do.
   */
  enqueueRandom(bytes: Uint8Array): void;
  /** How many bytes the PRNG has produced — a cheap way to assert "this drew a nonce". */
  readonly drawnBytes: number;
}

const subtle = globalThis.crypto.subtle;

/**
 * The runtime's own key handle, captured structurally instead of by naming a
 * platform type. `CryptoKey` is a global interface in a browser and a
 * namespaced one under `@types/node`, and this file has no business knowing
 * which of the two it is compiling against.
 */
type PlatformKey = Awaited<ReturnType<typeof subtle.importKey>>;

/** `generateKey` is typed as "a key OR a pair"; only a pair is usable here. */
function isKeyPair(
  value: unknown,
): value is { readonly privateKey: PlatformKey; readonly publicKey: PlatformKey } {
  return (
    typeof value === "object" && value !== null && "privateKey" in value && "publicKey" in value
  );
}

const encoder = new TextEncoder();

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** xoshiro128** — small, fast, and good enough that fake nonces do not collide in a suite. */
function makeStream(seed: number): () => number {
  let s0 = (seed ^ 0x9e3779b9) >>> 0;
  let s1 = 0x243f6a88;
  let s2 = 0xb7e15162;
  let s3 = 0x8aed2a6b;
  return () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
}

async function importAesKey(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<PlatformKey> {
  if (key.length !== AEAD_KEY_BYTES) {
    throw new TypeError(`AEAD key must be ${AEAD_KEY_BYTES} bytes, got ${key.length}`);
  }
  return subtle.importKey("raw", key, "AES-GCM", false, [usage]);
}

/** Creates a fresh fake. Each call gets its own PRNG state; tests never share one. */
export function createFakeCryptoPort(options: FakeCryptoPortOptions = {}): FakeCryptoPort {
  const next = makeStream(options.seed ?? 1);
  const queued: Uint8Array[] = [];
  let drawn = 0;

  const port: FakeCryptoPort = {
    get drawnBytes() {
      return drawn;
    },

    enqueueRandom(bytes: Uint8Array): void {
      queued.push(Uint8Array.from(bytes));
    },

    randomBytes(length: number): Uint8Array {
      const forced = queued.shift();
      if (forced !== undefined) {
        if (forced.length !== length) {
          throw new TypeError(
            `enqueueRandom supplied ${forced.length} bytes but ${length} were requested`,
          );
        }
        return Uint8Array.from(forced);
      }
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 4) {
        const word = next();
        out[i] = word & 0xff;
        if (i + 1 < length) out[i + 1] = (word >>> 8) & 0xff;
        if (i + 2 < length) out[i + 2] = (word >>> 16) & 0xff;
        if (i + 3 < length) out[i + 3] = (word >>> 24) & 0xff;
      }
      drawn += length;
      return out;
    },

    async sha256(data: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array(await subtle.digest("SHA-256", data));
    },

    async hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
      const imported = await subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return new Uint8Array(await subtle.sign("HMAC", imported, data));
    },

    async hkdfSha256(request: HkdfRequest): Promise<Uint8Array> {
      const ikm = await subtle.importKey("raw", request.ikm, "HKDF", false, ["deriveBits"]);
      const bits = await subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: request.salt, info: request.info },
        ikm,
        request.outputBytes * 8,
      );
      return new Uint8Array(bits);
    },

    async argon2id(request: Argon2idRequest): Promise<Uint8Array> {
      // The stand-in. Folding the parameters into `info` is what makes a test
      // that changes the cost parameters observe a different key, which is the
      // only behaviour of Argon2id the protocol code can see.
      const info = encoder.encode(
        `nexus/testing/fake-argon2id/m=${request.params.memoryKiB}` +
          `,t=${request.params.iterations},p=${request.params.parallelism}`,
      );
      // HKDF rejects an empty IKM in some implementations; a password of zero
      // bytes is a caller bug everywhere in this package, so let it throw.
      const ikm = await subtle.importKey("raw", request.password, "HKDF", false, ["deriveBits"]);
      const bits = await subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: request.salt, info },
        ikm,
        request.outputBytes * 8,
      );
      return new Uint8Array(bits);
    },

    async aeadSeal(request: AeadSealRequest): Promise<Uint8Array> {
      if (request.nonce.length !== AEAD_NONCE_BYTES) {
        throw new TypeError(`AEAD nonce must be ${AEAD_NONCE_BYTES} bytes`);
      }
      const key = await importAesKey(request.key, "encrypt");
      const sealed = await subtle.encrypt(
        { name: "AES-GCM", iv: request.nonce, additionalData: request.aad },
        key,
        request.plaintext,
      );
      return new Uint8Array(sealed);
    },

    async aeadOpen(request: AeadOpenRequest): Promise<Uint8Array | null> {
      if (request.nonce.length !== AEAD_NONCE_BYTES) {
        throw new TypeError(`AEAD nonce must be ${AEAD_NONCE_BYTES} bytes`);
      }
      const key = await importAesKey(request.key, "decrypt");
      try {
        const opened = await subtle.decrypt(
          { name: "AES-GCM", iv: request.nonce, additionalData: request.aad },
          key,
          request.ciphertext,
        );
        return new Uint8Array(opened);
      } catch {
        // The port contract: authentication failure is `null`, never an
        // exception, and never a distinguishable reason.
        return null;
      }
    },

    async x25519GenerateKeyPair(): Promise<X25519KeyPair> {
      const generated = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
      if (!isKeyPair(generated)) {
        throw new TypeError("X25519 generateKey did not return a key pair");
      }
      const publicKey = new Uint8Array(await subtle.exportKey("raw", generated.publicKey));
      return { publicKey, secretKey: generated.privateKey };
    },

    async x25519SharedSecret(
      secretKey: X25519SecretKey,
      peerPublicKey: Uint8Array,
    ): Promise<Uint8Array | null> {
      if (peerPublicKey.length !== X25519_PUBLIC_KEY_BYTES) return null;
      try {
        const peer = await subtle.importKey("raw", peerPublicKey, { name: "X25519" }, false, []);
        const bits = await subtle.deriveBits(
          { name: "X25519", public: peer },
          secretKey as PlatformKey,
          256,
        );
        const shared = new Uint8Array(bits);
        // Belt and braces: Node rejects a low-order point itself, but the port
        // contract says "never an all-zero secret" and this is the only place
        // that can honour it if a future runtime is more permissive.
        return shared.every((byte) => byte === 0) ? null : shared;
      } catch {
        return null;
      }
    },
  };

  return port;
}
