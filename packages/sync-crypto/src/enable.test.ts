import { describe, expect, it } from "vitest";
import { base64urlToBytes } from "./bytes.js";
import { openDeviceName } from "./device-name.js";
import { prepareSyncEnable, type SyncEnableInput } from "./enable.js";
import { WEB_KDF_PARAMS, deriveWebPasswordKeys, type WebPasswordInput } from "./kdf.js";
import { AEAD_KEY_BYTES, type CryptoPort } from "./port.js";
import {
  SYNC_RECOVERY_CODE_DIGITS,
  SYNC_RECOVERY_KDF_PARAMS,
  SYNC_RECOVERY_SALT_BYTES,
  deriveSyncRecoveryKey,
} from "./recovery.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";
import { unwrapKey } from "./wrap.js";

const port = createFakeCryptoPort({ seed: 77 });

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DK = new Uint8Array(32).fill(0x55);

const WEB: WebPasswordInput = {
  email: "luka@example.test",
  password: "a sufficiently long web password",
  params: WEB_KDF_PARAMS,
};

const INPUT: SyncEnableInput = {
  userId: USER_ID,
  web: WEB,
  localDataKey: DK,
  deviceName: "Radna stanica",
};

describe("prepareSyncEnable", () => {
  it("produces a master key, a recovery code and three wraps of the same key", async () => {
    const material = await prepareSyncEnable(port, INPUT);

    expect(material.masterKey.length).toBe(AEAD_KEY_BYTES);
    expect(material.recoveryCode).toMatch(/^[0-9A-Z]+$/);
    expect(material.recoveryCode.length).toBe(SYNC_RECOVERY_CODE_DIGITS);
    expect(material.recoverySalt.length).toBe(SYNC_RECOVERY_SALT_BYTES);

    expect(material.localWrap.purpose).toBe("mk/local-data-key");
    expect(material.passwordWrap.purpose).toBe("mk/web-password");
    expect(material.recoveryWrap.purpose).toBe("mk/sync-recovery");
  });

  it("reports the parameters it actually derived under", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    expect(material.passwordKdfParams).toEqual(WEB_KDF_PARAMS);
    expect(material.recoveryKdfParams).toEqual(SYNC_RECOVERY_KDF_PARAMS);
  });

  it("wraps under the local data key the caller supplied", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    const opened = await unwrapKey(port, DK, material.localWrap, {
      purpose: "mk/local-data-key",
      userId: USER_ID,
    });
    expect(opened).toEqual(material.masterKey);
  });

  /**
   * The assertion the whole „derive K_wrap here rather than accept it" argument
   * rests on: a K_wrap derived INDEPENDENTLY from the same email, password and
   * reported parameters opens the wrap. If the function ever recorded parameters
   * other than the ones it used, this is where it shows — and nowhere else until
   * a future device tries to sign in and cannot.
   */
  it("wraps under a K_wrap that the reported parameters reproduce", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    const { wrapKey: kwrap } = await deriveWebPasswordKeys(port, {
      email: WEB.email,
      password: WEB.password,
      params: material.passwordKdfParams,
    });
    const opened = await unwrapKey(port, kwrap, material.passwordWrap, {
      purpose: "mk/web-password",
      userId: USER_ID,
    });
    expect(opened).toEqual(material.masterKey);
  });

  it("wraps under a recovery key that the returned code, salt and parameters reproduce", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    const kek = await deriveSyncRecoveryKey(port, {
      code: material.recoveryCode,
      salt: material.recoverySalt,
      params: material.recoveryKdfParams,
    });
    const opened = await unwrapKey(port, kek, material.recoveryWrap, {
      purpose: "mk/sync-recovery",
      userId: USER_ID,
    });
    expect(opened).toEqual(material.masterKey);
  });

  it("seals the device name under the master key it just minted", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    const name = await openDeviceName(
      port,
      material.masterKey,
      { userId: USER_ID, platform: "desktop" },
      material.sealedDeviceName,
    );
    expect(name).toBe(INPUT.deviceName);
  });

  it("mints a different key, code and salt every time", async () => {
    const first = await prepareSyncEnable(port, INPUT);
    const second = await prepareSyncEnable(port, INPUT);
    expect(second.masterKey).not.toEqual(first.masterKey);
    expect(second.recoveryCode).not.toBe(first.recoveryCode);
    expect(second.recoverySalt).not.toEqual(first.recoverySalt);
    expect(second.passwordWrap.nonce).not.toBe(first.passwordWrap.nonce);
  });

  it("binds every wrap to the account, so another account's id does not open them", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    await expect(
      unwrapKey(port, DK, material.localWrap, {
        purpose: "mk/local-data-key",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toMatchObject({ name: "SyncCryptoError" });
  });
});

describe("what prepareSyncEnable refuses before it mints anything", () => {
  it("refuses an empty account id", async () => {
    await expect(prepareSyncEnable(port, { ...INPUT, userId: "" })).rejects.toThrow(TypeError);
  });

  it("refuses a device name the consent screen could not render", async () => {
    const hostile = `Laptop${String.fromCodePoint(0x202e)}`;
    await expect(prepareSyncEnable(port, { ...INPUT, deviceName: hostile })).rejects.toThrow(
      TypeError,
    );
  });

  /**
   * The message is asserted, not just the type. `wrapKey` refuses a short KEK
   * too — but three statements later, after a master key and a recovery code
   * have been minted. Naming the field pins WHICH check fired, so the up-front
   * one cannot quietly be deleted and left looking covered.
   */
  it("refuses a local data key that is not 32 bytes, before minting", async () => {
    await expect(
      prepareSyncEnable(port, { ...INPUT, localDataKey: new Uint8Array(16) }),
    ).rejects.toThrow(/localDataKey must be 32 bytes/);
  });
});

/**
 * The failure this function exists to catch: an adapter that seals correctly and
 * cannot read its own output. Simulated by a port whose `aeadOpen` returns
 * plaintext of the right length and the wrong content — the commitment tag is
 * derived from the KEK and the AAD, not from the key inside, so it still
 * verifies and nothing but the comparison notices.
 */
describe("a crypto port that cannot read what it wrote", () => {
  const brokenPort: CryptoPort = {
    ...port,
    aeadOpen: async (request) => {
      const opened = await port.aeadOpen(request);
      return opened === null ? null : new Uint8Array(opened.length);
    },
  };

  it("refuses to hand back a master key it could not open again", async () => {
    await expect(prepareSyncEnable(brokenPort, INPUT)).rejects.toMatchObject({
      name: "SyncCryptoError",
      code: "enable/round-trip-mismatch",
    });
  });
});

describe("the sealed forms fit the columns that store them", () => {
  it("puts every master-key wrap at the widths key_wraps demands", async () => {
    const material = await prepareSyncEnable(port, INPUT);
    for (const wrap of [material.localWrap, material.passwordWrap, material.recoveryWrap]) {
      // 24-byte nonce, 32-byte key plus a 16-byte tag, 32-byte commitment — the
      // three `key_wraps` CHECKs, restated where the bytes are produced.
      expect(base64urlToBytes(wrap.nonce)?.length).toBe(24);
      expect(base64urlToBytes(wrap.ciphertext)?.length).toBe(48);
      expect(base64urlToBytes(wrap.commitment)?.length).toBe(32);
    }
  });
});
