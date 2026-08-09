import { describe, expect, it } from "vitest";
import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  SHA256_BYTES,
  generateContentKey,
  generateMasterKey,
  openRow,
  sealRow,
  unwrapKey,
  wrapKey,
  type RowIdentity,
} from "@nexus/sync-crypto";

import { createWebCryptoPort } from "./webCryptoPort.js";

const port = createWebCryptoPort();

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * EVERY VECTOR IN THIS BLOCK COMES FROM OUTSIDE THIS REPOSITORY, and that is
 * the only thing that makes them worth running.
 *
 * A test that pins whatever the implementation happened to produce proves the
 * implementation is deterministic, which nobody doubted. These are published
 * values — RFC 6234, RFC 4231, RFC 5869, and the Argon2 reference
 * implementation's own documented example — so a green run says the bytes agree
 * with the rest of the world, which is the actual requirement: the key that
 * wraps MK on the server is derived by this code on a desktop and by this code
 * in a browser, and if either ever drifts the account cannot be opened from one
 * of the user's own devices.
 */
describe("published test vectors", () => {
  it("SHA-256 matches RFC 6234's “abc” vector", async () => {
    expect(hex(await port.sha256(ascii("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("SHA-256 of the empty input is the empty-string digest", async () => {
    expect(hex(await port.sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("HMAC-SHA256 matches RFC 4231 test case 1", async () => {
    const key = fromHex("0b".repeat(20));
    expect(hex(await port.hmacSha256(key, ascii("Hi There")))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("HMAC-SHA256 matches RFC 4231 test case 2, where the key is shorter than the block", async () => {
    expect(hex(await port.hmacSha256(ascii("Jefe"), ascii("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("HMAC-SHA256 matches RFC 4231 test case 3, where the key is longer than the digest", async () => {
    const key = fromHex("aa".repeat(20));
    const data = fromHex("dd".repeat(50));
    expect(hex(await port.hmacSha256(key, data))).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });

  it("HKDF-SHA256 matches RFC 5869 test case 1", async () => {
    const okm = await port.hkdfSha256({
      ikm: fromHex("0b".repeat(22)),
      salt: fromHex("000102030405060708090a0b0c"),
      info: fromHex("f0f1f2f3f4f5f6f7f8f9"),
      outputBytes: 42,
    });
    expect(hex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865",
    );
  });

  it("HKDF-SHA256 matches RFC 5869 test case 3, where salt and info are empty", async () => {
    // The case that proves extract is NOT skipped: with an empty salt, an
    // expand-only implementation produces entirely different bytes, and this is
    // the shape `kdf.ts` actually uses (`info` for separation, salt often empty).
    const okm = await port.hkdfSha256({
      ikm: fromHex("0b".repeat(22)),
      salt: new Uint8Array(0),
      info: new Uint8Array(0),
      outputBytes: 42,
    });
    expect(hex(okm)).toBe(
      "8da4e775a563c18f715f802a063c5a31" +
        "b8a11f5c5ee1879ec3454e5f3c738d2d" +
        "9d201395faa4b61a96c8",
    );
  });

  /**
   * ARGON2id, AND WHERE THESE TWO NUMBERS CAME FROM.
   *
   * RFC 9106's own Argon2id vector feeds a secret and associated data, neither
   * of which `hash-wasm` exposes, so it cannot be run here. These were produced
   * instead by the REFERENCE C implementation (P-H-C/phc-winner-argon2, the
   * `argon2` CLI from Alpine's package of it) in a throwaway container:
   *
   *   echo -n 'password' | argon2 somesalt      -id -t 2 -m 16 -p 1 -l 24
   *   echo -n 'lozinka'  | argon2 nexussalt16byte -id -t 3 -m 12 -p 2 -l 32
   *
   * The first attempt at this test pinned `45d7ac72…`, remembered as „the
   * README example" — that is the Argon2**i** figure, and the mistake is worth
   * leaving recorded: `-i` and `-id` differ by one character on the command
   * line and by an entire algorithm in the output, and the way it was caught
   * was by asking the reference implementation instead of the test author.
   *
   * The second vector varies every parameter at once — different password,
   * salt length, memory, iterations, parallelism and output length — because a
   * single vector only proves the defaults are wired up. `p=2` in particular is
   * the one that catches an implementation quietly running single-threaded and
   * producing different bytes for it.
   */
  it("Argon2id matches the reference C implementation, 64 MiB / t=2 / p=1", async () => {
    const out = await port.argon2id({
      password: ascii("password"),
      salt: ascii("somesalt"),
      params: { memoryKiB: 65536, iterations: 2, parallelism: 1 },
      outputBytes: 24,
    });
    expect(hex(out)).toBe("da6cd3008f398f03fafa4fe61c3787dce80db7b13ce86e56");
  });

  it("Argon2id matches the reference C implementation, 4 MiB / t=3 / p=2", async () => {
    const out = await port.argon2id({
      password: ascii("lozinka"),
      salt: ascii("nexussalt16byte"),
      params: { memoryKiB: 4096, iterations: 3, parallelism: 2 },
      outputBytes: 32,
    });
    expect(hex(out)).toBe(
      "474a6203375a58b28bad70ca3fe8a2598a48cc74eb8839850766bc64c9084ad9",
    );
  });

  /**
   * XCHACHA20-POLY1305, AND WHY THIS ONE NEEDED MORE THAN A CITATION.
   *
   * Every other vector above is checked by WebCrypto or by WASM Argon2 — code
   * this repository did not choose and cannot change. The AEAD is the one
   * primitive that comes from a library (`@noble/ciphers`, pinned exactly),
   * because WebCrypto has no extended-nonce ChaCha and never will, so „the
   * vector matches" has to mean more than „the library agrees with itself".
   *
   * The vector is `draft-irtf-cfrg-xchacha-03` §A.3.1 — the CFRG draft's own
   * AEAD example, on the RFC 8439 „sunscreen" plaintext. Before it was pinned
   * here it was reproduced independently in a throwaway script, by composing
   * OpenSSL's `chacha20-poly1305` (through `node:crypto`, an implementation with
   * nothing to do with noble) under a subkey from an HChaCha20 written out of
   * §2.2 by hand — and that hand-written HChaCha20 was itself checked against
   * the draft's §2.2.1 HChaCha20 vector first, so it was an oracle rather than a
   * guess. The two implementations agreed on this vector and on 200 randomised
   * cases with varying AAD and plaintext lengths.
   *
   * `node:crypto` is deliberately NOT imported here: this package's tsconfig
   * carries `lib: ["ES2023", "DOM"]` and no Node types, because the package
   * targets the web platform surface so that one adapter serves main, browser
   * and Vitest. The differential run was the verification; this is the record of
   * it.
   */
  const XCHACHA_KEY = fromHex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
  const XCHACHA_NONCE = fromHex("404142434445464748494a4b4c4d4e4f5051525354555657");
  const XCHACHA_AAD = fromHex("50515253c0c1c2c3c4c5c6c7");
  const XCHACHA_PLAINTEXT =
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip " +
    "for the future, sunscreen would be it.";
  const XCHACHA_SEALED =
    "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb" +
    "731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452" +
    "2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9" +
    "21f9664c97637da9768812f615c68b13b52e" +
    // The 16-byte Poly1305 tag, which the draft prints separately and this port
    // appends. Split out on its own line so the layout is visible rather than
    // asserted: a port that returned the tag detached, or prepended it, fails
    // here and nowhere else.
    "c0875924c1c7987947deafd8780acf49";

  it("XChaCha20-Poly1305 seals draft-irtf-cfrg-xchacha-03 §A.3.1", async () => {
    const sealed = await port.aeadSeal({
      key: XCHACHA_KEY,
      nonce: XCHACHA_NONCE,
      plaintext: ascii(XCHACHA_PLAINTEXT),
      aad: XCHACHA_AAD,
    });
    expect(hex(sealed)).toBe(XCHACHA_SEALED);
  });

  it("XChaCha20-Poly1305 opens draft-irtf-cfrg-xchacha-03 §A.3.1", async () => {
    const opened = await port.aeadOpen({
      key: XCHACHA_KEY,
      nonce: XCHACHA_NONCE,
      ciphertext: fromHex(XCHACHA_SEALED),
      aad: XCHACHA_AAD,
    });
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe(XCHACHA_PLAINTEXT);
  });

  /**
   * The same vector, damaged one way at a time. A published vector proves the
   * cipher computes; these prove the ADAPTER refuses — and refuses identically,
   * with `null` and no reason attached, whichever byte was wrong.
   */
  it("XChaCha20-Poly1305 refuses every single-field corruption of §A.3.1 alike", async () => {
    const sealed = fromHex(XCHACHA_SEALED);
    const base = {
      key: XCHACHA_KEY,
      nonce: XCHACHA_NONCE,
      ciphertext: sealed,
      aad: XCHACHA_AAD,
    } as const;

    const flip = (bytes: Uint8Array, index: number): Uint8Array => {
      const copy = Uint8Array.from(bytes);
      copy.set([(copy.at(index) ?? 0) ^ 0x01], index);
      return copy;
    };

    for (const damaged of [
      // A body byte, the first tag byte, and the last tag byte.
      { ...base, ciphertext: flip(sealed, 0) },
      { ...base, ciphertext: flip(sealed, sealed.length - AEAD_TAG_BYTES) },
      { ...base, ciphertext: flip(sealed, sealed.length - 1) },
      // The tag cut off entirely, and cut in half.
      { ...base, ciphertext: sealed.subarray(0, sealed.length - AEAD_TAG_BYTES) },
      { ...base, ciphertext: sealed.subarray(0, sealed.length - 8) },
      // Nothing but a tag, and less than a tag.
      { ...base, ciphertext: sealed.subarray(sealed.length - AEAD_TAG_BYTES) },
      { ...base, ciphertext: new Uint8Array(AEAD_TAG_BYTES - 1) },
      { ...base, ciphertext: new Uint8Array(0) },
      // One bit of the key, one of the nonce, one of the AAD.
      { ...base, key: flip(XCHACHA_KEY, 31) },
      { ...base, nonce: flip(XCHACHA_NONCE, 0) },
      { ...base, nonce: flip(XCHACHA_NONCE, 23) },
      { ...base, aad: flip(XCHACHA_AAD, 0) },
      { ...base, aad: new Uint8Array(0) },
      { ...base, aad: new Uint8Array([...XCHACHA_AAD, 0]) },
    ]) {
      expect(await port.aeadOpen(damaged)).toBeNull();
    }
  });
});

describe("the contract port.ts states, method by method", () => {
  it("draws randomness that differs between calls and is the requested length", () => {
    const a = port.randomBytes(32);
    const b = port.randomBytes(32);
    expect(a).toHaveLength(32);
    expect(hex(a)).not.toBe(hex(b));
  });

  it("refuses a negative or fractional random length rather than guessing", () => {
    expect(() => port.randomBytes(-1)).toThrow(/non-negative integer/);
    expect(() => port.randomBytes(1.5)).toThrow(/non-negative integer/);
  });

  it("accepts an HMAC key of any length, including empty", async () => {
    // RFC 2104 zero-pads a short key to the block size, so an empty key IS a
    // block of zeros. WebCrypto refuses to import a zero-length key at all;
    // this asserts the substitution produces the mathematically identical
    // result rather than some other convenient answer.
    const empty = await port.hmacSha256(new Uint8Array(0), ascii("x"));
    const zeros = await port.hmacSha256(new Uint8Array(64), ascii("x"));
    expect(hex(empty)).toBe(hex(zeros));
    expect(empty).toHaveLength(SHA256_BYTES);
  });

  it("refuses an HKDF output beyond RFC 5869's 255-hash-length ceiling", async () => {
    await expect(
      port.hkdfSha256({
        ikm: new Uint8Array(32),
        salt: new Uint8Array(0),
        info: new Uint8Array(0),
        outputBytes: 255 * SHA256_BYTES + 1,
      }),
    ).rejects.toThrow(/RFC 5869/);
    // And the ceiling itself is allowed — an off-by-one here would silently
    // shrink the usable output of every future caller.
    const okm = await port.hkdfSha256({
      ikm: new Uint8Array(32),
      salt: new Uint8Array(0),
      info: new Uint8Array(0),
      outputBytes: 255 * SHA256_BYTES,
    });
    expect(okm).toHaveLength(255 * SHA256_BYTES);
  });

  it("appends the AEAD tag rather than returning it separately", async () => {
    const sealed = await port.aeadSeal({
      key: new Uint8Array(AEAD_KEY_BYTES),
      nonce: new Uint8Array(AEAD_NONCE_BYTES),
      plaintext: ascii("hello"),
      aad: ascii("ctx"),
    });
    expect(sealed).toHaveLength(5 + AEAD_TAG_BYTES);
  });

  it("round-trips a sealing, and authenticates the AAD", async () => {
    const key = port.randomBytes(AEAD_KEY_BYTES);
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    const sealed = await port.aeadSeal({
      key,
      nonce,
      plaintext: ascii("zdravo"),
      aad: ascii("nexus/ctx/1"),
    });
    const opened = await port.aeadOpen({ key, nonce, ciphertext: sealed, aad: ascii("nexus/ctx/1") });
    expect(opened === null ? "" : new TextDecoder().decode(opened)).toBe("zdravo");

    // One character of the AAD, which is not encrypted and which the server can
    // rewrite at will. This is the whole reason the AAD exists.
    expect(
      await port.aeadOpen({ key, nonce, ciphertext: sealed, aad: ascii("nexus/ctx/2") }),
    ).toBeNull();
  });

  it("returns null for every authentication failure, and never throws one", async () => {
    const key = port.randomBytes(AEAD_KEY_BYTES);
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    const aad = ascii("ctx");
    const sealed = await port.aeadSeal({ key, nonce, plaintext: ascii("x"), aad });

    const tampered = Uint8Array.from(sealed);
    // `noUncheckedIndexedAccess` types `tampered[0]` as possibly undefined, and
    // `^=` on it is therefore an error rather than a compile-time-known no-op.
    tampered.set([(tampered.at(0) ?? 0) ^ 0x01], 0);

    expect(await port.aeadOpen({ key, nonce, ciphertext: tampered, aad })).toBeNull();
    expect(
      await port.aeadOpen({ key: port.randomBytes(AEAD_KEY_BYTES), nonce, ciphertext: sealed, aad }),
    ).toBeNull();
    expect(
      await port.aeadOpen({ key, nonce: port.randomBytes(AEAD_NONCE_BYTES), ciphertext: sealed, aad }),
    ).toBeNull();
    // Shorter than the tag: a different internal failure, and it must be
    // indistinguishable from the others or it is an oracle.
    expect(await port.aeadOpen({ key, nonce, ciphertext: new Uint8Array(3), aad })).toBeNull();
  });

  it("throws — not returns null — for a malformed key or nonce length", async () => {
    const key = port.randomBytes(AEAD_KEY_BYTES);
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    await expect(
      port.aeadSeal({ key: new Uint8Array(16), nonce, plaintext: ascii("x"), aad: ascii("") }),
    ).rejects.toThrow(/key must be 32 bytes/);
    await expect(
      port.aeadOpen({ key, nonce: new Uint8Array(16), ciphertext: new Uint8Array(32), aad: ascii("") }),
    ).rejects.toThrow(/nonce must be 24 bytes/);
    // BOTH CHECKS RUN BEFORE THE LIBRARY DOES, which is the part worth pinning.
    // `@noble/ciphers` throws for a bad key length AND for a forged tag, so an
    // adapter that simply forwarded its exceptions would turn every forgery into
    // a throw, or — worse, if it caught them all — every caller bug into a
    // `null` the caller reads as "wrong password".
    await expect(
      port.aeadOpen({ key: new Uint8Array(31), nonce, ciphertext: new Uint8Array(32), aad: ascii("") }),
    ).rejects.toThrow(/key must be 32 bytes/);
  });

  it("neither seals nor opens by mutating what it was given", async () => {
    // `port.ts`: „an implementation MUST NOT retain or mutate any array it is
    // given". The JS cipher writes into buffers it allocates, but it takes the
    // key, nonce and AAD by reference — noble's own source says so — so this is
    // the assertion that a future version which decided to scrub them in place
    // would fail loudly instead of corrupting the caller's content key.
    const key = port.randomBytes(AEAD_KEY_BYTES);
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    const aad = ascii("nexus/ctx");
    const plaintext = ascii("zdravo");
    const before = [hex(key), hex(nonce), hex(aad), hex(plaintext)];

    const sealed = await port.aeadSeal({ key, nonce, plaintext, aad });
    expect([hex(key), hex(nonce), hex(aad), hex(plaintext)]).toEqual(before);

    const sealedCopy = hex(sealed);
    await port.aeadOpen({ key, nonce, ciphertext: sealed, aad });
    expect([hex(key), hex(nonce), hex(aad), hex(sealed)]).toEqual([...before.slice(0, 3), sealedCopy]);
  });

  it("seals the same plaintext twice under one key and nonce without refusing", async () => {
    // NOT AN ENDORSEMENT OF NONCE REUSE — `row.ts` explains at length why that
    // ends the integrity of everything sealed at that nonce, and `sealRow` is
    // the only caller, drawing 24 fresh bytes every time. This pins a property
    // of the ADAPTER: `@noble/ciphers` arms a one-shot guard („cannot encrypt()
    // twice with same key + nonce") on the cipher INSTANCE, so a port that
    // cached one instance would throw on its second seal and take sync down.
    // Constructing per call is what makes the port stateless, as `port.ts` says
    // it is.
    const key = port.randomBytes(AEAD_KEY_BYTES);
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    const first = await port.aeadSeal({ key, nonce, plaintext: ascii("x"), aad: ascii("") });
    const second = await port.aeadSeal({ key, nonce, plaintext: ascii("x"), aad: ascii("") });
    expect(hex(second)).toBe(hex(first));
  });
});

describe("X25519", () => {
  it("gives both sides the same secret, and a fresh pair every call", async () => {
    const a = await port.x25519GenerateKeyPair();
    const b = await port.x25519GenerateKeyPair();
    expect(a.publicKey).toHaveLength(32);
    expect(hex(a.publicKey)).not.toBe(hex(b.publicKey));

    const ab = await port.x25519SharedSecret(a.secretKey, b.publicKey);
    const ba = await port.x25519SharedSecret(b.secretKey, a.publicKey);
    expect(ab).not.toBeNull();
    expect(hex(ab as Uint8Array)).toBe(hex(ba as Uint8Array));
  });

  it("keeps the private scalar off the JS heap", async () => {
    const { secretKey } = await port.x25519GenerateKeyPair();
    // The `X25519SecretKey = object` type exists precisely so an implementation
    // may return a handle instead of bytes; this asserts we took that option.
    expect((secretKey as CryptoKey).extractable).toBe(false);
  });

  it("returns null for every low-order point rather than an all-zero secret", async () => {
    const { secretKey } = await port.x25519GenerateKeyPair();
    // RFC 7748 §6.1's small-order inputs: the identity, the order-2 point, and
    // the two order-4/8 points. A protocol without contributory behaviour —
    // which pairing is — must reject all of them, or a man in the middle forces
    // a shared secret it knew in advance.
    const lowOrder = [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "0100000000000000000000000000000000000000000000000000000000000000",
      "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
      "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    ];
    for (const point of lowOrder) {
      expect(await port.x25519SharedSecret(secretKey, fromHex(point))).toBeNull();
    }
  });

  it("returns null for a peer key of the wrong length", async () => {
    const { secretKey } = await port.x25519GenerateKeyPair();
    expect(await port.x25519SharedSecret(secretKey, new Uint8Array(31))).toBeNull();
    expect(await port.x25519SharedSecret(secretKey, new Uint8Array(33))).toBeNull();
  });
});

/**
 * The protocol, run on real primitives instead of the deterministic fake.
 *
 * `@nexus/sync-crypto`'s own suite drives every one of these through
 * `fakeCryptoPort`, which is what makes nonce-reuse and tampering testable —
 * but a fake agrees with itself by construction. These assertions are the ones
 * that would catch a real adapter that seals with the tag detached, treats an
 * `ArrayBuffer` view as its whole backing buffer, or reorders an AAD.
 */
describe("the real protocol on real primitives", () => {
  const identity: RowIdentity = {
    userId: "11111111-1111-4111-8111-111111111111",
    profileId: "22222222-2222-4222-8222-222222222222",
    collection: "tasks",
    objectId: "33333333-3333-4333-8333-333333333333",
    version: 7,
    deleted: false,
    parentId: null,
    ckEpoch: 1,
  };

  it("wraps and unwraps a master key under a real KEK", async () => {
    const kek = port.randomBytes(AEAD_KEY_BYTES);
    const mk = generateMasterKey(port);
    const context = { purpose: "mk/web-password", userId: identity.userId } as const;

    const sealed = await wrapKey(port, kek, mk, context);
    expect(hex(await unwrapKey(port, kek, sealed, context))).toBe(hex(mk));
  });

  it("refuses a master-key wrap opened under a different purpose", async () => {
    const kek = port.randomBytes(AEAD_KEY_BYTES);
    const mk = generateMasterKey(port);
    const sealed = await wrapKey(port, kek, mk, {
      purpose: "mk/web-password",
      userId: identity.userId,
    });
    await expect(
      unwrapKey(port, kek, sealed, {
        purpose: "mk/sync-recovery",
        userId: identity.userId,
      }),
    ).rejects.toThrow();
  });

  it("seals and opens a row, and refuses one the server moved", async () => {
    const ck = generateContentKey(port);
    const plaintext = new TextEncoder().encode('{"naslov":"Kupovina"}');
    const sealed = await sealRow(port, ck, identity, plaintext);

    expect(new TextDecoder().decode(await openRow(port, ck, identity, sealed))).toBe(
      '{"naslov":"Kupovina"}',
    );

    // Each of these is one clear column the server owns and could rewrite.
    for (const moved of [
      { ...identity, userId: "99999999-9999-4999-8999-999999999999" },
      { ...identity, profileId: "99999999-9999-4999-8999-999999999999" },
      { ...identity, collection: "notes" },
      { ...identity, objectId: "99999999-9999-4999-8999-999999999999" },
      { ...identity, version: 6 },
      { ...identity, deleted: true },
      // The content-key generation. A server that serves a row sealed under the
      // retired key while claiming the current one is what the epoch is in the
      // AAD to catch.
      { ...identity, ckEpoch: 2 },
    ] satisfies RowIdentity[]) {
      await expect(openRow(port, ck, moved, sealed)).rejects.toThrow();
    }
  });

  it("refuses a row whose parent the server rewrote", async () => {
    // The B8 finding, on real primitives. Before `parentId` joined the AAD this
    // block passed with the reparented identity opening cleanly.
    const ck = generateContentKey(port);
    const child: RowIdentity = { ...identity, parentId: "aaaa-parent" };
    const sealed = await sealRow(port, ck, child, ascii("x"));

    await expect(openRow(port, ck, { ...child, parentId: "bbbb-parent" }, sealed)).rejects.toThrow();
    // Promoting a child to a root is the same attack in the other direction.
    await expect(openRow(port, ck, { ...child, parentId: null }, sealed)).rejects.toThrow();
    // And a root demoted to a child.
    const root = await sealRow(port, ck, identity, ascii("x"));
    await expect(openRow(port, ck, { ...identity, parentId: "" }, root)).rejects.toThrow();
  });

  it("never repeats a nonce across seals of the same row", async () => {
    const ck = generateContentKey(port);
    const nonces = new Set<string>();
    for (let i = 0; i < 64; i++) {
      nonces.add((await sealRow(port, ck, identity, ascii("x"))).nonce);
    }
    expect(nonces.size).toBe(64);
  });
});
