import { describe, expect, it } from "vitest";
import {
  KeyUnwrapError,
  derivePasscodeKey,
  deriveRecoveryKey,
  generateSalt,
  unwrapDataKey,
  wrapDataKey,
  type KdfParams,
} from "../auth/keyChain.js";
import {
  derivePrivCredentialKey,
  generatePrivDek,
  unwrapPrivDek,
  unwrapPrivDekWithKit,
  wrapPrivDek,
  wrapPrivDekWithKit,
} from "./privKeys.js";

// Same reduced parameters as keyChain.test.ts: Argon2id at the real 64 MiB is
// deliberately slow, and every value pinned here was generated at these
// parameters by an independent script (WebCrypto + hash-wasm spelled out from
// the ADR-057 spec, never through this module).
const FAST_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8,
  iterations: 1,
  parallelism: 1,
};

const bytes = (length: number, fn: (i: number) => number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => fn(i));
const toHex = (u8: Uint8Array): string =>
  Array.from(u8, (byte) => byte.toString(16).padStart(2, "0")).join("");

const PRIV_DEK = bytes(32, (i) => i);
const SALT = bytes(16, (i) => i + 1);
const DEVICE_SECRET = bytes(32, (i) => 0x20 + i);
const KIT_SALT = bytes(16, (i) => 0x40 + i);
const KIT_CODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // canonical 32-char Crockford code

/** Flips the ciphertext's first base64 character — a one-byte tamper without reimplementing base64. */
function flipFirstChar(base64: string): string {
  const alt = base64.startsWith("A") ? "B" : "A";
  return alt + base64.slice(1);
}

describe("generatePrivDek", () => {
  it("returns 32 random bytes that differ across calls", () => {
    const a = generatePrivDek();
    const b = generatePrivDek();
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a).not.toEqual(b);
  });
});

describe("derivePrivCredentialKey", () => {
  it("matches the known answer for the v1 chain (argon2id -> HKDF info nexus/priv-wrap/v1)", async () => {
    const key = await derivePrivCredentialKey(
      "correct horse 1",
      SALT,
      DEVICE_SECRET,
      FAST_KDF_PARAMS,
    );
    expect(toHex(key)).toBe("9abf9557ecf8bb606014b6f94f042240803a6418f8f23714e528e31b49faa990");
  });

  it("derives a DIFFERENT key than derivePasscodeKey for identical inputs (info separation)", async () => {
    const priv = await derivePrivCredentialKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const passcode = await derivePasscodeKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    expect(priv).not.toEqual(passcode);
  });

  it("NFKC-normalizes the credential: fullwidth and ASCII spellings derive the same key", async () => {
    const a = await derivePrivCredentialKey("Ａ１correct horse", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const b = await derivePrivCredentialKey("A1correct horse", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    expect(a).toEqual(b);
  });

  it("binds to the device secret: a different device secret yields a different key", async () => {
    const a = await derivePrivCredentialKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const b = await derivePrivCredentialKey(
      "correct horse 1",
      SALT,
      bytes(32, (i) => 0x60 + i),
      FAST_KDF_PARAMS,
    );
    expect(a).not.toEqual(b);
  });
});

describe("wrapPrivDek / unwrapPrivDek", () => {
  it("round-trips the PRIV DEK under a derived credential KEK", async () => {
    const kek = await derivePrivCredentialKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const wrapped = await wrapPrivDek(PRIV_DEK, kek);
    expect(await unwrapPrivDek(wrapped, kek)).toEqual(PRIV_DEK);
  });

  it("throws KeyUnwrapError under the wrong KEK", async () => {
    const kek = await derivePrivCredentialKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const wrongKek = await derivePrivCredentialKey("wrong horse 2", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const wrapped = await wrapPrivDek(PRIV_DEK, kek);
    await expect(unwrapPrivDek(wrapped, wrongKek)).rejects.toThrow(KeyUnwrapError);
  });

  it("throws KeyUnwrapError when a ciphertext byte is flipped", async () => {
    const kek = await derivePrivCredentialKey("correct horse 1", SALT, DEVICE_SECRET, FAST_KDF_PARAMS);
    const wrapped = await wrapPrivDek(PRIV_DEK, kek);
    const tampered = { ...wrapped, ciphertext: flipFirstChar(wrapped.ciphertext) };
    await expect(unwrapPrivDek(tampered, kek)).rejects.toThrow(KeyUnwrapError);
  });
});

describe("wrapPrivDekWithKit / unwrapPrivDekWithKit", () => {
  it("round-trips the PRIV DEK under a canonical recovery code", async () => {
    const wrapped = await wrapPrivDekWithKit(PRIV_DEK, KIT_CODE, KIT_SALT, FAST_KDF_PARAMS);
    expect(await unwrapPrivDekWithKit(wrapped, KIT_CODE, KIT_SALT, FAST_KDF_PARAMS)).toEqual(PRIV_DEK);
  });

  it("matches the known answer: opens a wrap sealed by an independent implementation", async () => {
    const fixture = {
      nonce: "AAECAwQFBgcICQoL",
      ciphertext: "P0ghDV33dEdoHG/o7JAeFNvWArvKyAHAie2L6t24WZCR52LsscWe95cfuUpdxJqU",
    };
    expect(await unwrapPrivDekWithKit(fixture, KIT_CODE, KIT_SALT, FAST_KDF_PARAMS)).toEqual(PRIV_DEK);
  });

  it("one kit code + two salts opens the data-key wrap and the PRIV wrap independently", async () => {
    // The regenerate-kit flow (ADR-057 §4): ONE new recovery code, a fresh salt
    // per wrap. Each wrap must open on its own salt and fail on the other's —
    // pinning that the distinct salt really is the domain separation.
    const dataKey = bytes(32, (i) => 0x80 + i);
    const dataSalt = generateSalt();
    const privSalt = generateSalt();

    const dataWrap = await wrapDataKey(dataKey, await deriveRecoveryKey(KIT_CODE, dataSalt, FAST_KDF_PARAMS));
    const privWrap = await wrapPrivDekWithKit(PRIV_DEK, KIT_CODE, privSalt, FAST_KDF_PARAMS);

    const openedData = await unwrapDataKey(dataWrap, await deriveRecoveryKey(KIT_CODE, dataSalt, FAST_KDF_PARAMS));
    const openedPriv = await unwrapPrivDekWithKit(privWrap, KIT_CODE, privSalt, FAST_KDF_PARAMS);
    expect(openedData).toEqual(dataKey);
    expect(openedPriv).toEqual(PRIV_DEK);

    // Cross the salts: the same code must NOT open either wrap on the other's salt.
    await expect(unwrapPrivDekWithKit(privWrap, KIT_CODE, dataSalt, FAST_KDF_PARAMS)).rejects.toThrow(KeyUnwrapError);
    await expect(
      unwrapDataKey(dataWrap, await deriveRecoveryKey(KIT_CODE, privSalt, FAST_KDF_PARAMS)),
    ).rejects.toThrow(KeyUnwrapError);
  });

  it("throws KeyUnwrapError for a wrong recovery code", async () => {
    const wrapped = await wrapPrivDekWithKit(PRIV_DEK, KIT_CODE, KIT_SALT, FAST_KDF_PARAMS);
    const wrongCode = "ZYXWVTSRQPNMKJHGFEDCBA9876543210";
    await expect(unwrapPrivDekWithKit(wrapped, wrongCode, KIT_SALT, FAST_KDF_PARAMS)).rejects.toThrow(
      KeyUnwrapError,
    );
  });
});
