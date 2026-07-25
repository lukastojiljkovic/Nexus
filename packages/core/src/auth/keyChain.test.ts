import { describe, expect, it } from "vitest";
import {
  DEFAULT_KDF_PARAMS,
  KeyUnwrapError,
  dataKeyToHex,
  deriveRecoveryKey,
  derivePasscodeKey,
  generateDataKey,
  generateDeviceSecret,
  generateSalt,
  unwrapDataKey,
  wrapDataKey,
  type KdfParams,
} from "./keyChain.js";

// Argon2id at DEFAULT_KDF_PARAMS's real 64 MiB is deliberately slow (ADR-018);
// every test but the one at the bottom of this file uses these reduced
// parameters so the suite stays fast enough that someone actually runs it.
const FAST_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8,
  iterations: 1,
  parallelism: 1,
};

/** Flips the ciphertext's first base64 character to a different one — a one-byte tamper without reimplementing base64 in the test. */
function flipFirstChar(base64: string): string {
  const alt = base64.startsWith("A") ? "B" : "A";
  return alt + base64.slice(1);
}

describe("generateDataKey / generateDeviceSecret / generateSalt", () => {
  it("generateDataKey returns 32 random bytes that differ across calls", () => {
    const a = generateDataKey();
    const b = generateDataKey();
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a).not.toEqual(b);
  });

  it("generateDeviceSecret returns 32 random bytes", () => {
    expect(generateDeviceSecret()).toHaveLength(32);
  });

  it("generateSalt returns 16 random bytes", () => {
    expect(generateSalt()).toHaveLength(16);
  });
});

describe("dataKeyToHex", () => {
  it("produces 64 lower-case hex characters that @nexus/db's RAW_KEY_HEX accepts", () => {
    const hex = dataKeyToHex(generateDataKey());
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("derivePasscodeKey / deriveRecoveryKey / wrapDataKey / unwrapDataKey", () => {
  it("round-trips: derive -> wrap -> unwrap -> the same data key bytes", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const deviceSecret = generateDeviceSecret();
    const kek = await derivePasscodeKey("correcthorse1", salt, deviceSecret, FAST_KDF_PARAMS);

    const wrapped = await wrapDataKey(dataKey, kek);
    const unwrapped = await unwrapDataKey(wrapped, kek);

    expect(unwrapped).toEqual(dataKey);
  });

  it("uses a fresh random nonce per wrap, even for the same data key and KEK", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const deviceSecret = generateDeviceSecret();
    const kek = await derivePasscodeKey("correcthorse1", salt, deviceSecret, FAST_KDF_PARAMS);

    const wrappedA = await wrapDataKey(dataKey, kek);
    const wrappedB = await wrapDataKey(dataKey, kek);

    expect(wrappedA.nonce).not.toBe(wrappedB.nonce);
  });

  it("throws KeyUnwrapError for a wrong passcode", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const deviceSecret = generateDeviceSecret();
    const kek = await derivePasscodeKey("correcthorse1", salt, deviceSecret, FAST_KDF_PARAMS);
    const wrapped = await wrapDataKey(dataKey, kek);

    const wrongKek = await derivePasscodeKey(
      "wrongpasscode2",
      salt,
      deviceSecret,
      FAST_KDF_PARAMS,
    );

    await expect(unwrapDataKey(wrapped, wrongKek)).rejects.toThrow(KeyUnwrapError);
  });

  it("throws KeyUnwrapError when a ciphertext byte is flipped (tamper detection)", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const deviceSecret = generateDeviceSecret();
    const kek = await derivePasscodeKey("correcthorse1", salt, deviceSecret, FAST_KDF_PARAMS);
    const wrapped = await wrapDataKey(dataKey, kek);

    const tampered = { ...wrapped, ciphertext: flipFirstChar(wrapped.ciphertext) };

    await expect(unwrapDataKey(tampered, kek)).rejects.toThrow(KeyUnwrapError);
  });

  it("binds the passcode key to the device secret: a different device secret yields a different key", async () => {
    const salt = generateSalt();
    const deviceSecretA = generateDeviceSecret();
    const deviceSecretB = generateDeviceSecret();

    const keyA = await derivePasscodeKey("correcthorse1", salt, deviceSecretA, FAST_KDF_PARAMS);
    const keyB = await derivePasscodeKey("correcthorse1", salt, deviceSecretB, FAST_KDF_PARAMS);

    expect(keyA).not.toEqual(keyB);
  });

  it("deriveRecoveryKey has no device-secret parameter to depend on — the Recovery Kit works after a device change", async () => {
    const dataKey = generateDataKey();
    const salt = generateSalt();
    const code = "ABCDEFGH1234JKMNPQRSTVWXYZ01234"; // 32-char code shape; content is not validated here

    const kek = await deriveRecoveryKey(code, salt, FAST_KDF_PARAMS);
    const wrapped = await wrapDataKey(dataKey, kek);

    // Re-derive from scratch, as a "new machine" with no shared device secret
    // would have to — the function signature simply has nothing else to feed it.
    const kekOnNewMachine = await deriveRecoveryKey(code, salt, FAST_KDF_PARAMS);
    expect(kekOnNewMachine).toEqual(kek);

    const unwrapped = await unwrapDataKey(wrapped, kekOnNewMachine);
    expect(unwrapped).toEqual(dataKey);
  });

  it(
    "end to end with DEFAULT_KDF_PARAMS — the only test paying Argon2id's real 64 MiB cost",
    async () => {
      expect(DEFAULT_KDF_PARAMS).toEqual({
        algorithm: "argon2id",
        memoryKiB: 64 * 1024,
        iterations: 3,
        parallelism: 1,
      });

      const dataKey = generateDataKey();
      const salt = generateSalt();
      const deviceSecret = generateDeviceSecret();
      const kek = await derivePasscodeKey(
        "correcthorse1",
        salt,
        deviceSecret,
        DEFAULT_KDF_PARAMS,
      );
      const wrapped = await wrapDataKey(dataKey, kek);
      const unwrapped = await unwrapDataKey(wrapped, kek);

      expect(unwrapped).toEqual(dataKey);
    },
    20_000,
  );
});
