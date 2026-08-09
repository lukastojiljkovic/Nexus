/**
 * Tests for `rewrap.ts`, which used to live in `kdf.test.ts` and moved with the
 * function. The move is the point: `kdf.ts` is the module a browser imports, and
 * a re-wrap needs `unwrapKey` — so the two could not share a file without the
 * browser's module graph reaching the one call that turns K_wrap into MK.
 */
import { describe, expect, it } from "vitest";
import { SyncCryptoError } from "./errors.js";
import { WEB_KDF_PARAMS, deriveWebPasswordKeys } from "./kdf.js";
import { rewrapMasterKeyForEmailChange } from "./rewrap.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";
import { unwrapKey, wrapKey } from "./wrap.js";

const port = createFakeCryptoPort({ seed: 7 });

const EMAIL = "Luka.Stojiljkovic@Example.COM";
const PASSWORD = "a-long-enough-web-password-1";

describe("rewrapMasterKeyForEmailChange", () => {
  const userId = "user-1";
  const masterKey = new Uint8Array(32).fill(0xab);

  it("re-derives the wrap so the master key survives an address change", async () => {
    const before = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const sealed = await wrapKey(port, before.wrapKey, masterKey, {
      purpose: "mk/web-password",
      userId,
    });

    const rewrapped = await rewrapMasterKeyForEmailChange(port, {
      sealed,
      userId,
      currentEmail: EMAIL,
      nextEmail: "new.address@example.com",
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });

    const after = await deriveWebPasswordKeys(port, {
      email: "new.address@example.com",
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    expect(await unwrapKey(port, after.wrapKey, rewrapped, { purpose: "mk/web-password", userId }))
      .toEqual(masterKey);
  });

  it("leaves the OLD wrap unopenable under the new address — which is why it exists", async () => {
    const before = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const sealed = await wrapKey(port, before.wrapKey, masterKey, {
      purpose: "mk/web-password",
      userId,
    });
    const after = await deriveWebPasswordKeys(port, {
      email: "new.address@example.com",
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    await expect(
      unwrapKey(port, after.wrapKey, sealed, { purpose: "mk/web-password", userId }),
    ).rejects.toThrow(SyncCryptoError);
  });

  it("refuses when the password does not open the current wrap", async () => {
    const before = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const sealed = await wrapKey(port, before.wrapKey, masterKey, {
      purpose: "mk/web-password",
      userId,
    });
    await expect(
      rewrapMasterKeyForEmailChange(port, {
        sealed,
        userId,
        currentEmail: EMAIL,
        nextEmail: "new.address@example.com",
        password: "the-wrong-password-9",
        params: WEB_KDF_PARAMS,
      }),
    ).rejects.toThrow(SyncCryptoError);
  });
});
