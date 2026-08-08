import { describe, expect, it } from "vitest";
import { base64urlToBytes, bytesToBase64url } from "./bytes.js";
import { type SyncCryptoErrorCode } from "./errors.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";
import {
  generateContentKey,
  generateMasterKey,
  parseSealedKey,
  unwrapKey,
  wrapKey,
  type WrapContext,
} from "./wrap.js";

const port = createFakeCryptoPort({ seed: 11 });

const KEK = new Uint8Array(32).fill(0x42);
const OTHER_KEK = new Uint8Array(32).fill(0x43);
const MASTER_KEY = new Uint8Array(32).fill(0x11);
const CONTENT_KEY = new Uint8Array(32).fill(0x22);

const MK_LOCAL: WrapContext = { purpose: "mk/local-data-key", userId: "user-1" };
const MK_WEB: WrapContext = { purpose: "mk/web-password", userId: "user-1" };
const MK_RECOVERY: WrapContext = { purpose: "mk/sync-recovery", userId: "user-1" };
const CK: WrapContext = { purpose: "ck/master-key", userId: "user-1", profileId: "profile-a" };

/** Asserts the thrown error is a SyncCryptoError carrying exactly `code`. */
async function expectCode(promise: Promise<unknown>, code: SyncCryptoErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "SyncCryptoError", code });
}

describe("wrapKey / unwrapKey", () => {
  it("round-trips the master key under every master-key purpose", async () => {
    for (const context of [MK_LOCAL, MK_WEB, MK_RECOVERY]) {
      const sealed = await wrapKey(port, KEK, MASTER_KEY, context);
      expect(await unwrapKey(port, KEK, sealed, context)).toEqual(MASTER_KEY);
    }
  });

  it("round-trips a content key under its profile", async () => {
    const sealed = await wrapKey(port, KEK, CONTENT_KEY, CK);
    expect(await unwrapKey(port, KEK, sealed, CK)).toEqual(CONTENT_KEY);
  });

  it("uses a fresh nonce for every wrap of the same key under the same KEK", async () => {
    const first = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const second = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });
});

describe("purpose binding", () => {
  it("refuses to open a password wrap as a recovery wrap", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    await expectCode(unwrapKey(port, KEK, sealed, MK_RECOVERY), "wrap/purpose-mismatch");
  });

  it("stays closed even when the stored purpose is rewritten to match the context", async () => {
    // The cheap `purpose` check is a courtesy. This is the real defence: the
    // purpose is inside the key derivation AND the AAD, so relabelling the
    // record does not produce a key that opens it.
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const relabelled = { ...sealed, purpose: MK_RECOVERY.purpose };
    await expectCode(unwrapKey(port, KEK, relabelled, MK_RECOVERY), "wrap/commitment-mismatch");
  });

  it("binds the user id: another account's wrap does not open", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    await expectCode(
      unwrapKey(port, KEK, sealed, { purpose: "mk/web-password", userId: "user-2" }),
      "wrap/commitment-mismatch",
    );
  });

  it("binds the profile id: a content key does not open under another profile", async () => {
    const sealed = await wrapKey(port, KEK, CONTENT_KEY, CK);
    await expectCode(
      unwrapKey(port, KEK, sealed, {
        purpose: "ck/master-key",
        userId: "user-1",
        profileId: "profile-b",
      }),
      "wrap/commitment-mismatch",
    );
  });
});

describe("key commitment", () => {
  it("rejects a wrong KEK at the commitment, before the AEAD is ever called", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    await expectCode(unwrapKey(port, OTHER_KEK, sealed, MK_WEB), "wrap/commitment-mismatch");
  });

  it("commits deterministically: the same KEK and context always give the same tag", async () => {
    const first = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const second = await wrapKey(port, KEK, CONTENT_KEY, MK_WEB);
    expect(second.commitment).toBe(first.commitment);
  });

  it("gives a different tag for a different KEK, purpose or user", async () => {
    const base = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    expect((await wrapKey(port, OTHER_KEK, MASTER_KEY, MK_WEB)).commitment).not.toBe(base.commitment);
    expect((await wrapKey(port, KEK, MASTER_KEY, MK_RECOVERY)).commitment).not.toBe(base.commitment);
    expect(
      (await wrapKey(port, KEK, MASTER_KEY, { purpose: "mk/web-password", userId: "user-2" }))
        .commitment,
    ).not.toBe(base.commitment);
  });

  it("does not leak the KEK: the commitment is not the KEK and not derivable back to it", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    expect(base64urlToBytes(sealed.commitment)).not.toEqual(KEK);
    expect(base64urlToBytes(sealed.commitment)).toHaveLength(32);
  });

  it("rejects a forged commitment", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const forged = { ...sealed, commitment: bytesToBase64url(new Uint8Array(32).fill(0x99)) };
    await expectCode(unwrapKey(port, KEK, forged, MK_WEB), "wrap/commitment-mismatch");
  });
});

describe("integrity", () => {
  it("reports an AEAD failure when the ciphertext is edited under a correct KEK", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const bytes = base64urlToBytes(sealed.ciphertext) as Uint8Array;
    bytes[0] = (bytes[0] as number) ^ 0x01;
    const tampered = { ...sealed, ciphertext: bytesToBase64url(bytes) };
    await expectCode(unwrapKey(port, KEK, tampered, MK_WEB), "wrap/aead-failed");
  });

  it("reports an AEAD failure when the nonce is edited", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    const bytes = base64urlToBytes(sealed.nonce) as Uint8Array;
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await expectCode(
      unwrapKey(port, KEK, { ...sealed, nonce: bytesToBase64url(bytes) }, MK_WEB),
      "wrap/aead-failed",
    );
  });
});

describe("parseSealedKey", () => {
  it("accepts what wrapKey produced", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    expect(parseSealedKey(JSON.parse(JSON.stringify(sealed)))).toEqual(sealed);
  });

  it("rejects every shape a hostile server might substitute", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    expect(parseSealedKey(null)).toBeNull();
    expect(parseSealedKey("not an object")).toBeNull();
    expect(parseSealedKey({ ...sealed, v: 2 })).toBeNull();
    expect(parseSealedKey({ ...sealed, purpose: "mk/something-else" })).toBeNull();
    expect(parseSealedKey({ ...sealed, nonce: "!!!" })).toBeNull();
    expect(parseSealedKey({ ...sealed, nonce: bytesToBase64url(new Uint8Array(11)) })).toBeNull();
    expect(parseSealedKey({ ...sealed, commitment: bytesToBase64url(new Uint8Array(31)) })).toBeNull();
    expect(parseSealedKey({ ...sealed, ciphertext: bytesToBase64url(new Uint8Array(16)) })).toBeNull();
    expect(parseSealedKey({ ...sealed, extra: 1 })).toBeNull();
  });
});

describe("malformed sealed keys reaching unwrapKey", () => {
  it("throws wrap/malformed rather than reaching the AEAD", async () => {
    const sealed = await wrapKey(port, KEK, MASTER_KEY, MK_WEB);
    await expectCode(unwrapKey(port, KEK, { ...sealed, nonce: "%%%" }, MK_WEB), "wrap/malformed");
    await expectCode(
      unwrapKey(port, KEK, { ...sealed, ciphertext: bytesToBase64url(new Uint8Array(4)) }, MK_WEB),
      "wrap/malformed",
    );
  });

  it("rejects a KEK that is not 32 bytes — a caller bug, not a runtime condition", async () => {
    await expect(wrapKey(port, new Uint8Array(16), MASTER_KEY, MK_WEB)).rejects.toThrow(TypeError);
    await expect(wrapKey(port, KEK, new Uint8Array(16), MK_WEB)).rejects.toThrow(TypeError);
  });
});

describe("key generation", () => {
  it("draws 32 bytes from the port for a master key and for a content key", () => {
    const local = createFakeCryptoPort({ seed: 3 });
    const before = local.drawnBytes;
    expect(generateMasterKey(local)).toHaveLength(32);
    expect(generateContentKey(local)).toHaveLength(32);
    expect(local.drawnBytes - before).toBe(64);
  });

  it("never derives a master key from a password — two draws differ", () => {
    const local = createFakeCryptoPort({ seed: 3 });
    expect(generateMasterKey(local)).not.toEqual(generateMasterKey(local));
  });
});
