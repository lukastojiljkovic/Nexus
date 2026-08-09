import { describe, expect, it } from "vitest";

import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";
import {
  SYNC_RECOVERY_CODE_DIGITS,
  SYNC_RECOVERY_KDF_PARAMS,
  SYNC_RECOVERY_SALT_BYTES,
  deriveSyncRecoveryKey,
  formatSyncRecoveryCode,
  generateSyncRecoveryCode,
  generateSyncRecoverySalt,
  normalizeSyncRecoveryCode,
} from "./recovery.js";
import { unwrapKey, wrapKey } from "./wrap.js";

const USER = "11111111-1111-4111-8111-111111111111";

/** A canonical code, so a test that is not about generation does not depend on it. */
const CODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const salt = (fill: number): Uint8Array => new Uint8Array(SYNC_RECOVERY_SALT_BYTES).fill(fill);

describe("the code itself", () => {
  it("is 32 Crockford digits, and never contains a confusable", () => {
    const port = createFakeCryptoPort({ seed: 23 });
    for (let i = 0; i < 32; i += 1) {
      const code = generateSyncRecoveryCode(port);
      expect(code).toHaveLength(SYNC_RECOVERY_CODE_DIGITS);
      // I, L, O and U are the four characters Crockford leaves out — the first
      // three because they are read as digits, U so the bits cannot spell
      // something the user has to read aloud to support.
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{32}$/);
    }
  });

  it("prints as eight groups of four", () => {
    expect(formatSyncRecoveryCode(CODE)).toBe("0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ");
  });

  it("accepts what a human reading a printed sheet would type", () => {
    for (const typed of [
      CODE,
      CODE.toLowerCase(),
      formatSyncRecoveryCode(CODE),
      ` ${formatSyncRecoveryCode(CODE)} `,
      CODE.replace(/0/g, "O").replace(/1/g, "I"),
      CODE.replace(/1/g, "l"),
    ]) {
      expect(normalizeSyncRecoveryCode(typed), typed).toBe(CODE);
    }
  });

  it("refuses a code it would have to guess at, rather than repairing it", () => {
    // A silently repaired code is the worst outcome available: it derives a
    // DIFFERENT key and fails at the unwrap, where the message says „wrong
    // code" about a code the user copied correctly off the sheet.
    for (const bad of ["", CODE.slice(0, 31), `${CODE}0`, CODE.replace("0", "U"), CODE.replace("0", "!")]) {
      expect(normalizeSyncRecoveryCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("deriveSyncRecoveryKey", () => {
  it("returns 32 bytes and is deterministic in the code and the salt", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    const first = await deriveSyncRecoveryKey(port, {
      code: CODE,
      salt: salt(7),
      params: SYNC_RECOVERY_KDF_PARAMS,
    });
    const again = await deriveSyncRecoveryKey(port, {
      code: formatSyncRecoveryCode(CODE).toLowerCase(),
      salt: salt(7),
      params: SYNC_RECOVERY_KDF_PARAMS,
    });
    expect(first).toHaveLength(32);
    // The point of normalising inside the function: the dashed lower-case form
    // off a printed sheet must not be a different key from the canonical one.
    expect(Array.from(again)).toEqual(Array.from(first));
  });

  it("is a different key under a different salt", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    const a = await deriveSyncRecoveryKey(port, { code: CODE, salt: salt(1), params: SYNC_RECOVERY_KDF_PARAMS });
    const b = await deriveSyncRecoveryKey(port, { code: CODE, salt: salt(2), params: SYNC_RECOVERY_KDF_PARAMS });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("refuses a code that is not a code, before spending a second on Argon2id", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    await expect(
      deriveSyncRecoveryKey(port, { code: "nope", salt: salt(1), params: SYNC_RECOVERY_KDF_PARAMS }),
    ).rejects.toThrow(/32 Crockford/);
  });

  it("refuses a salt that is not 16 bytes", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    await expect(
      deriveSyncRecoveryKey(port, { code: CODE, salt: new Uint8Array(15), params: SYNC_RECOVERY_KDF_PARAMS }),
    ).rejects.toThrow(/16 bytes/);
  });

  it("refuses parameters a hostile server could use to weaken or to hang it", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    const refused = [
      { memoryKiB: 8, iterations: 1, parallelism: 1 },
      { memoryKiB: 64 * 1024, iterations: 2, parallelism: 1 },
      // The hang, which is the one a floor alone would let through.
      { memoryKiB: 64 * 1024 * 1024, iterations: 3, parallelism: 1 },
      { memoryKiB: 64 * 1024, iterations: 1000, parallelism: 1 },
      // Lanes are a RANGE, not a floor: more of them at fixed memory is a
      // speedup for an attacker with cores, not strength for the defender.
      { memoryKiB: 64 * 1024, iterations: 3, parallelism: 8 },
      // NaN passes `< floor` by being false. Integer-checked first for exactly this.
      { memoryKiB: Number.NaN, iterations: 3, parallelism: 1 },
      { memoryKiB: 64 * 1024, iterations: 3.5, parallelism: 1 },
    ];
    for (const params of refused) {
      await expect(
        deriveSyncRecoveryKey(port, { code: CODE, salt: salt(1), params }),
        JSON.stringify(params),
      ).rejects.toThrow(/refused/);
    }
  });

  it("accepts a cost RAISED above the baseline, which is why the floor is a floor", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    await expect(
      deriveSyncRecoveryKey(port, {
        code: CODE,
        salt: salt(1),
        params: { memoryKiB: 256 * 1024, iterations: 4, parallelism: 1 },
      }),
    ).resolves.toHaveLength(32);
  });
});

describe("the round trip this key exists for", () => {
  it("opens the master-key wrap it sealed, and refuses a wrap from another account", async () => {
    const port = createFakeCryptoPort({ seed: 23 });
    const code = generateSyncRecoveryCode(port);
    const recoverySalt = generateSyncRecoverySalt(port);
    const masterKey = port.randomBytes(32);

    const kek = await deriveSyncRecoveryKey(port, {
      code,
      salt: recoverySalt,
      params: SYNC_RECOVERY_KDF_PARAMS,
    });
    const sealed = await wrapKey(port, kek, masterKey, { purpose: "mk/sync-recovery", userId: USER });

    const opened = await unwrapKey(port, kek, sealed, { purpose: "mk/sync-recovery", userId: USER });
    expect(Array.from(opened)).toEqual(Array.from(masterKey));

    // The AAD binds the account, so a wrap lifted from another user's row does
    // not open here even though the code and the salt are right. That is the
    // defence a server operator with every row would otherwise walk through.
    await expect(
      unwrapKey(port, kek, sealed, {
        purpose: "mk/sync-recovery",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow();
  });

  it("a wrong code fails as a wrong code, not as 32 bytes of garbage", async () => {
    // The key-commitment tag is what makes this true: `unwrapKey` recomputes it
    // from the KEK and refuses to attempt the AEAD unless it matches, so the
    // failure is legible instead of being a key-shaped value that decrypts
    // nothing.
    const port = createFakeCryptoPort({ seed: 23 });
    const recoverySalt = generateSyncRecoverySalt(port);
    const right = await deriveSyncRecoveryKey(port, {
      code: generateSyncRecoveryCode(port),
      salt: recoverySalt,
      params: SYNC_RECOVERY_KDF_PARAMS,
    });
    const wrong = await deriveSyncRecoveryKey(port, {
      code: generateSyncRecoveryCode(port),
      salt: recoverySalt,
      params: SYNC_RECOVERY_KDF_PARAMS,
    });

    const sealed = await wrapKey(port, right, port.randomBytes(32), {
      purpose: "mk/sync-recovery",
      userId: USER,
    });
    await expect(
      unwrapKey(port, wrong, sealed, { purpose: "mk/sync-recovery", userId: USER }),
    ).rejects.toThrow();
  });
});
