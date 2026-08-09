/**
 * `CryptoPort` — the one seam through which this package reaches a primitive.
 *
 * `@nexus/sync-crypto` has ZERO runtime dependencies and performs no I/O, reads
 * no clock and draws no randomness of its own. Argon2id, HKDF, HMAC, SHA-256,
 * AEAD and X25519 all arrive through this interface, implemented by whoever is
 * calling: the Electron main process over `node:crypto` plus a WASM Argon2, a
 * browser over WebCrypto plus the same WASM, a test over a deterministic fake.
 *
 * Three concrete reasons, none of them ceremony:
 *
 *  1. **The primitive choice stays a decision, not an accident.** Nothing in
 *     this package pins a library version, which is what let the AEAD move from
 *     AES-256-GCM to XChaCha20-Poly1305 (see {@link AEAD_NONCE_BYTES}) as a
 *     change in one adapter rather than one scattered through the protocol code.
 *  2. **A dependency audit has one place to look.** "What crypto does sync
 *     use?" is answered by reading this file and the two adapters, never by
 *     walking a lockfile.
 *  3. **Every rule here is testable with a deterministic fake.** Nonce reuse,
 *     a tampered transcript, an all-zero X25519 point — none of those are
 *     reachable in a test if the randomness and the primitives sit inside the
 *     module under test.
 *
 * Everything is `readonly` and byte-shaped: no strings cross this boundary
 * except where a string *is* the value (there is no such case here). Callers
 * pass `Uint8Array`, and an implementation MUST NOT retain or mutate any array
 * it is given.
 */

/** SHA-256 output size, and therefore the size of every key this package derives. */
export const SHA256_BYTES = 32;

/** AEAD key size. Everything in this package is a 256-bit symmetric key. */
export const AEAD_KEY_BYTES = 32;

/**
 * AEAD nonce size: 192 bits, XChaCha20-Poly1305's extended nonce.
 *
 * **Why not AES-256-GCM's 96 bits, which this was.** Not because the birthday
 * bound is close — it is not, and claiming so would be a rationalisation. NIST
 * SP 800-38D §8.3 draws the line at 2^32 seals per key with random IVs, and a
 * profile writing a hundred million row-versions a year would take about forty
 * years to reach it. The reasons are the other three:
 *
 *  1. **The budget is global and unobservable.** 2^32 is per KEY, and a content
 *     key is shared by every device the user owns. No device knows what the
 *     others have spent. There is nowhere to put the counter, so „we would
 *     notice on the way up" is not merely unimplemented — it is unavailable.
 *  2. **The only remedy is a full re-encrypt.** Approaching the bound means
 *     rotating the content key and rewriting every row of the profile. A limit
 *     you cannot measure whose remedy is rewriting the user's whole history is
 *     not worth carrying for twelve bytes a row.
 *  3. **It is the same answer already given about counters.** A deterministic
 *     nonce was rejected because an offline-first product cannot promise a
 *     counter never rewinds across a restore. A 96-bit RANDOM nonce has the
 *     same exposure to a rewound CSPRNG — a cloned VM, a restored disk image —
 *     and 192 bits is the width at which the question stops being askable.
 *
 * The server pins this length in three CHECK constraints, so the choice is
 * structural on both sides rather than a convention either could drop.
 */
export const AEAD_NONCE_BYTES = 24;

/** AEAD tag size, appended to the ciphertext (never returned separately). */
export const AEAD_TAG_BYTES = 16;

/** X25519 public keys and shared secrets are both 32 bytes (RFC 7748). */
export const X25519_PUBLIC_KEY_BYTES = 32;

/**
 * Argon2id cost parameters. Recorded alongside every derivation that uses them
 * so the costs can be RAISED later without locking anyone out of material
 * derived under the old ones — the same discipline `@nexus/core`'s local key
 * chain follows for `keychain.json`.
 */
export interface Argon2idParams {
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

/** One Argon2id derivation. `password` is bytes, not a string: the caller owns normalization. */
export interface Argon2idRequest {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly params: Argon2idParams;
  readonly outputBytes: number;
}

/** One HKDF-SHA256 extract-then-expand. An empty `salt` is legitimate — see `kdf.ts`. */
export interface HkdfRequest {
  readonly ikm: Uint8Array;
  readonly salt: Uint8Array;
  readonly info: Uint8Array;
  readonly outputBytes: number;
}

/** One AEAD sealing. `aad` is authenticated but not encrypted; it is never optional here. */
export interface AeadSealRequest {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly aad: Uint8Array;
}

/** One AEAD opening. `ciphertext` INCLUDES the trailing 16-byte tag. */
export interface AeadOpenRequest {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly aad: Uint8Array;
}

/**
 * An opaque handle to an X25519 private scalar. Deliberately NOT `Uint8Array`.
 *
 * A private scalar living in a JS `Uint8Array` cannot be erased: the garbage
 * collector copies during compaction, so `fill(0)` erases the copy you are
 * holding and not the ones it left behind. WebCrypto's non-extractable
 * `CryptoKey` and Node's `KeyObject` keep the scalar off the JS heap entirely,
 * and this type exists so an implementation is FREE to return one. This package
 * never inspects the value; it only hands it back to `x25519SharedSecret`.
 */
export type X25519SecretKey = object;

/** An ephemeral X25519 pair. `publicKey` is the 32-byte raw u-coordinate (RFC 7748 §6.1). */
export interface X25519KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: X25519SecretKey;
}

/**
 * The primitives this package needs, and nothing else.
 *
 * **What an implementation MUST guarantee**, method by method. These are not
 * suggestions: several rules in `wrap.ts`, `row.ts` and `pairing.ts` are only
 * true if the port holds up its end, and the fake in `./testing` is written to
 * the same contract so a test that passes there means something.
 */
export interface CryptoPort {
  /**
   * `length` cryptographically secure random bytes.
   *
   * MUST come from the platform CSPRNG (`crypto.getRandomValues`,
   * `node:crypto.randomBytes`) and NEVER from `Math.random`. MUST return a
   * fresh array each call; the caller may keep it.
   *
   * This is the ONLY source of randomness in the whole package. Every nonce,
   * every key, every pairing code and every ephemeral scalar traces back here,
   * which is what makes "no nonce is ever reused" a property one function can
   * be responsible for rather than a hope spread over a codebase.
   */
  randomBytes(length: number): Uint8Array;

  /** SHA-256. MUST return exactly {@link SHA256_BYTES} bytes. */
  sha256(data: Uint8Array): Promise<Uint8Array>;

  /**
   * HMAC-SHA256. MUST accept a key of any length (the RFC 2104 key schedule),
   * and MUST return exactly {@link SHA256_BYTES} bytes.
   */
  hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;

  /**
   * HKDF-SHA256, extract THEN expand (RFC 5869 §2.2 and §2.3 in that order) —
   * not expand-only. Callers here pass a full-entropy `ikm` and rely on `info`,
   * not `salt`, for domain separation, so an implementation that silently
   * skipped extract would produce different bytes for the same inputs and
   * break every stored wrap on the day the two adapters disagreed.
   *
   * MUST return exactly `outputBytes` bytes and MUST reject `outputBytes > 255 * 32`.
   */
  hkdfSha256(request: HkdfRequest): Promise<Uint8Array>;

  /**
   * Argon2id (RFC 9106), the `id` variant — not `i`, not `d`. MUST honour
   * `params` exactly as given rather than substituting its own defaults, and
   * MUST return exactly `outputBytes` bytes.
   *
   * The two adapters MUST agree byte-for-byte: this derives the key that wraps
   * the master key on the server, so a browser and a desktop that disagree
   * about Argon2id produce an account nobody can open.
   */
  argon2id(request: Argon2idRequest): Promise<Uint8Array>;

  /**
   * AEAD sealing, XChaCha20-Poly1305, with the 16-byte tag APPENDED to the
   * ciphertext (never returned as a separate field — a separated tag is one more
   * thing a caller can forget to authenticate).
   *
   * MUST reject a `key` that is not {@link AEAD_KEY_BYTES} bytes or a `nonce`
   * that is not {@link AEAD_NONCE_BYTES} bytes, by throwing: both are
   * programming errors in the caller, never runtime conditions.
   *
   * **The AEAD key is bytes, and that is a concession this file should own.**
   * {@link X25519SecretKey} is an opaque `object` specifically so an
   * implementation can keep a private scalar off the JS heap — and then
   * {@link AeadSealRequest.key} is a `Uint8Array`, which cannot. The asymmetry is
   * real and it is deliberate: a content key is derived, re-derived, wrapped and
   * unwrapped by this package's own code, so it has to be a value here, whereas
   * an ephemeral scalar is generated and consumed entirely inside the port. The
   * consequence to state plainly is that an implementation is FREE to be a pure
   * JavaScript one for the AEAD without giving up a property that was ever held.
   */
  aeadSeal(request: AeadSealRequest): Promise<Uint8Array>;

  /**
   * AEAD opening.
   *
   * MUST return `null` — NOT throw — when authentication fails, whatever the
   * cause (wrong key, wrong nonce, wrong AAD, edited bytes, truncated tag).
   * The distinction matters twice over. First, an authentication failure is an
   * ordinary, expected outcome in this package: it is how a wrong password, a
   * server that moved a row between profiles, and a burned pairing code all
   * announce themselves, and each of those has a state to transition to rather
   * than an exception to propagate. Second, `null` makes it impossible for an
   * implementation to leak WHY through the exception type — a distinguishable
   * failure reason is exactly the oracle an attacker wants.
   *
   * MUST still throw for a malformed *key* or *nonce* length, which is a bug.
   */
  aeadOpen(request: AeadOpenRequest): Promise<Uint8Array | null>;

  /**
   * A fresh ephemeral X25519 pair. MUST draw from the same CSPRNG as
   * `randomBytes` and MUST NOT reuse a pair across calls — the pairing
   * handshake's forward secrecy is exactly the freshness of this pair.
   */
  x25519GenerateKeyPair(): Promise<X25519KeyPair>;

  /**
   * X25519 (RFC 7748 §6.1).
   *
   * MUST return `null` — not throw, and never an all-zero array — when
   * `peerPublicKey` is not {@link X25519_PUBLIC_KEY_BYTES} bytes or is a
   * low-order point (one of the 12 inputs for which the shared secret is
   * all-zero regardless of the private scalar). RFC 7748 §6.1 makes that check
   * mandatory for any protocol without contributory behaviour, which this one
   * is: without it a man in the middle forces both sides to a shared secret it
   * knows in advance, and the pairing confirmation would then depend on the
   * pairing code alone. `pairing.ts` re-checks for an all-zero secret in
   * `contributorySharedSecret`, because a rule that only one layer enforces is
   * a rule one refactor away from being gone.
   */
  x25519SharedSecret(
    secretKey: X25519SecretKey,
    peerPublicKey: Uint8Array,
  ): Promise<Uint8Array | null>;
}
