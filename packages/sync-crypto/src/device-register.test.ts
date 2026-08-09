import { describe, expect, it } from "vitest";

import { bytesToBase64url, utf8 } from "./bytes.js";
import { DEVICE_REGISTER_PROOF_BYTES, deriveDeviceRegisterProof } from "./device-register.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";

const port = createFakeCryptoPort({ seed: 71 });

const MK = new Uint8Array(32).fill(0x11);
const OTHER_MK = new Uint8Array(32).fill(0x12);
const USER = "6a1f8f6e-0000-4000-8000-000000000001";
const OTHER_USER = "6a1f8f6e-0000-4000-8000-000000000002";

/**
 * The 32 the schema demands, restated rather than imported from anywhere. The
 * assertion is that two independently-written layers agree on a length; a shared
 * constant would only prove the file agrees with itself.
 */
const DB_PROOF_BYTES = 32;

describe("deriveDeviceRegisterProof", () => {
  it("is 32 bytes, which is what the column's CHECK demands", async () => {
    const proof = await deriveDeviceRegisterProof(port, MK, USER);
    expect(proof.length).toBe(DB_PROOF_BYTES);
    expect(DEVICE_REGISTER_PROOF_BYTES).toBe(DB_PROOF_BYTES);
  });

  it("is deterministic, because a stranded desktop derives it offline", async () => {
    // The whole reason this is HKDF over MK and not a challenge-response: the
    // machine that needs to prove something is the machine that cannot currently
    // ask the server for anything. Two derivations a month apart must agree.
    const first = await deriveDeviceRegisterProof(port, MK, USER);
    const second = await deriveDeviceRegisterProof(port, MK, USER);
    expect(bytesToBase64url(first)).toBe(bytesToBase64url(second));
  });

  it("separates accounts, so one account's proof is nothing on another", async () => {
    const mine = await deriveDeviceRegisterProof(port, MK, USER);
    const theirs = await deriveDeviceRegisterProof(port, MK, OTHER_USER);
    expect(bytesToBase64url(mine)).not.toBe(bytesToBase64url(theirs));
  });

  it("separates master keys", async () => {
    const mine = await deriveDeviceRegisterProof(port, MK, USER);
    const theirs = await deriveDeviceRegisterProof(port, OTHER_MK, USER);
    expect(bytesToBase64url(mine)).not.toBe(bytesToBase64url(theirs));
  });

  it("is not the device-name subkey, nor anything else derived from MK", async () => {
    // Domain separation stated as a test rather than trusted to the label being
    // spelled differently. Every subkey in this package hangs off the same
    // full-entropy MK with an empty extract salt, so `info` is the only thing
    // keeping them apart, and a copy-pasted label would be invisible in review.
    const proof = await deriveDeviceRegisterProof(port, MK, USER);
    const deviceNameKey = await port.hkdfSha256({
      ikm: MK,
      salt: new Uint8Array(0),
      info: utf8("nexus/sync/device-name/key/v1"),
      outputBytes: 32,
    });
    expect(bytesToBase64url(proof)).not.toBe(bytesToBase64url(deviceNameKey));
  });

  it("refuses a master key of the wrong length rather than deriving from it", async () => {
    await expect(deriveDeviceRegisterProof(port, new Uint8Array(31), USER)).rejects.toThrow(
      TypeError,
    );
    await expect(deriveDeviceRegisterProof(port, new Uint8Array(0), USER)).rejects.toThrow(
      TypeError,
    );
  });

  it("refuses an empty account id, which would silently drop the binding", async () => {
    await expect(deriveDeviceRegisterProof(port, MK, "")).rejects.toThrow(TypeError);
  });
});
