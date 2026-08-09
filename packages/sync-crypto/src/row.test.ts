import { describe, expect, it } from "vitest";
import { base64urlToBytes, bytesToBase64url, utf8 } from "./bytes.js";
import { type SyncCryptoErrorCode } from "./errors.js";
import { openRow, openRowFields, parseSealedRow, sealRow, sealRowFields, type RowIdentity } from "./row.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";

const port = createFakeCryptoPort({ seed: 23 });

const CONTENT_KEY = new Uint8Array(32).fill(0x5a);

const IDENTITY: RowIdentity = {
  userId: "user-1",
  profileId: "profile-a",
  collection: "tasks",
  objectId: "01J0000000000000000000000",
  version: 7,
  deleted: false,
  parentId: null,
  ckEpoch: 1,
};

const PLAINTEXT = utf8("zadatak: kupiti hleb");

async function expectCode(promise: Promise<unknown>, code: SyncCryptoErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "SyncCryptoError", code });
}

describe("sealRow / openRow", () => {
  it("round-trips", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    expect(await openRow(port, CONTENT_KEY, IDENTITY, sealed)).toEqual(PLAINTEXT);
  });

  it("draws a fresh 24-byte nonce from the port on every seal", async () => {
    const local = createFakeCryptoPort({ seed: 5 });
    const before = local.drawnBytes;
    const first = await sealRow(local, CONTENT_KEY, IDENTITY, PLAINTEXT);
    const second = await sealRow(local, CONTENT_KEY, IDENTITY, PLAINTEXT);
    expect(local.drawnBytes - before).toBe(48);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("does not open under a different content key", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    await expectCode(
      openRow(port, new Uint8Array(32).fill(0x5b), IDENTITY, sealed),
      "row/aead-failed",
    );
  });

  it("does not open when the ciphertext is edited", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    const bytes = base64urlToBytes(sealed.ciphertext) as Uint8Array;
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await expectCode(
      openRow(port, CONTENT_KEY, IDENTITY, { ...sealed, ciphertext: bytesToBase64url(bytes) }),
      "row/aead-failed",
    );
  });
});

describe("the AAD binds the row to its identity", () => {
  const moves: readonly (readonly [string, RowIdentity])[] = [
    ["another user", { ...IDENTITY, userId: "user-2" }],
    ["another profile", { ...IDENTITY, profileId: "profile-b" }],
    ["another collection", { ...IDENTITY, collection: "notes" }],
    ["another object", { ...IDENTITY, objectId: "01J1111111111111111111111" }],
    ["another version", { ...IDENTITY, version: 8 }],
    ["a stripped tombstone", { ...IDENTITY, deleted: true }],
    // `parent_id` is a clear column the server writes, and it was the one clear
    // column this AAD did not cover: rewriting it silently reparented any
    // object — under another account, or beneath a tombstone that then reaps it
    // — with the tag still verifying, because the tag never covered the byte.
    ["a rewritten parent", { ...IDENTITY, parentId: "01J2222222222222222222222" }],
    // The content-key generation. A hostile server that serves a row sealed
    // under the RETIRED key while claiming the current one is what puts
    // `ck_epoch` in the AAD — without it a client trials both keys and a
    // half-finished rotation is invisible.
    ["a claimed key rotation", { ...IDENTITY, ckEpoch: 2 }],
  ];

  for (const [what, moved] of moves) {
    it(`refuses a ciphertext relocated to ${what}`, async () => {
      const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
      await expectCode(openRow(port, CONTENT_KEY, moved, sealed), "row/aead-failed");
    });
  }

  it("refuses to promote a child to a root", async () => {
    // The direction that matters and the one the presence byte in `parentField`
    // exists for: „this hangs off object X" and „this is a root" are different
    // claims about the same row, and the server owns the column that carries
    // the difference.
    const child: RowIdentity = { ...IDENTITY, parentId: "01J2222222222222222222222" };
    const sealed = await sealRow(port, CONTENT_KEY, child, PLAINTEXT);
    await expectCode(
      openRow(port, CONTENT_KEY, { ...child, parentId: null }, sealed),
      "row/aead-failed",
    );
  });

  it("refuses an empty parent id on both sides, so `null` and `\"\"` never meet", async () => {
    // TWO LAYERS, and they are asserted separately because they fail
    // differently. `assertIdentity` refuses `""` outright — an object whose
    // parent cannot be named is a caller bug, not a row — so the ambiguous
    // value never reaches the AEAD at all. The presence byte in `parentField`
    // is the second layer, and it is not redundant: it is what keeps `null`
    // and `""` producing different tags on the day somebody relaxes this
    // validator, which is the kind of change that looks harmless.
    await expect(
      sealRow(port, CONTENT_KEY, { ...IDENTITY, parentId: "" }, PLAINTEXT),
    ).rejects.toThrow(TypeError);

    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    await expect(
      openRow(port, CONTENT_KEY, { ...IDENTITY, parentId: "" }, sealed),
    ).rejects.toThrow(TypeError);
  });

  it("refuses a tombstone whose `deleted` flag was cleared by the server", async () => {
    // The reverse direction of the case above, and the one that matters: a
    // server that could strip a tombstone would resurrect deleted rows.
    const tombstone: RowIdentity = { ...IDENTITY, deleted: true, version: 9 };
    const sealed = await sealRow(port, CONTENT_KEY, tombstone, PLAINTEXT);
    await expectCode(
      openRow(port, CONTENT_KEY, { ...tombstone, deleted: false }, sealed),
      "row/aead-failed",
    );
  });

  it("is not fooled by ids that concatenate the same way", async () => {
    // Without length framing, ("a", "b/c") and ("a/b", "c") produce identical
    // AAD bytes and the second opens the first.
    const left: RowIdentity = { ...IDENTITY, userId: "a", profileId: "b/c" };
    const right: RowIdentity = { ...IDENTITY, userId: "a/b", profileId: "c" };
    const sealed = await sealRow(port, CONTENT_KEY, left, PLAINTEXT);
    await expectCode(openRow(port, CONTENT_KEY, right, sealed), "row/aead-failed");
  });
});

describe("identity validation", () => {
  it("refuses a version that is not a non-negative safe integer", async () => {
    for (const version of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      await expect(
        sealRow(port, CONTENT_KEY, { ...IDENTITY, version }, PLAINTEXT),
      ).rejects.toThrow(TypeError);
    }
  });

  it("refuses an empty user, profile or collection — those really do bind nothing", async () => {
    for (const field of ["userId", "profileId", "collection"] as const) {
      await expect(
        sealRow(port, CONTENT_KEY, { ...IDENTITY, [field]: "" }, PLAINTEXT),
      ).rejects.toThrow(TypeError);
    }
  });

  // THE OPPOSITE RULE FOR `objectId`, and it used to be in the list above. Six
  // collections are per-profile singletons whose primary key is the profile
  // alone — `calendar_settings`, `study_settings`, … — so their object id is the
  // empty string, and rejecting it would have made those six unsyncable. It is
  // safe because `encodeStruct` length-frames every field: the empty id is a
  // field with content zero, not an absent one.
  it("accepts the empty object id the per-profile singletons really have", async () => {
    const singleton: RowIdentity = { ...IDENTITY, collection: "calendar_settings", objectId: "" };
    const sealed = await sealRow(port, CONTENT_KEY, singleton, PLAINTEXT);
    expect(await openRow(port, CONTENT_KEY, singleton, sealed)).toEqual(PLAINTEXT);

    // And it is still bound: the same empty id in another collection, or in
    // another profile, is a different row and does not open.
    await expectCode(
      openRow(port, CONTENT_KEY, { ...singleton, collection: "study_settings" }, sealed),
      "row/aead-failed",
    );
    await expectCode(
      openRow(port, CONTENT_KEY, { ...singleton, profileId: "profile-b" }, sealed),
      "row/aead-failed",
    );
  });

  it("refuses a ck_epoch below 1 or off the integers", async () => {
    for (const ckEpoch of [0, -1, 1.5, Number.NaN]) {
      await expect(
        sealRow(port, CONTENT_KEY, { ...IDENTITY, ckEpoch }, PLAINTEXT),
      ).rejects.toThrow(TypeError);
    }
  });

  it("refuses a content key that is not 32 bytes", async () => {
    await expect(sealRow(port, new Uint8Array(16), IDENTITY, PLAINTEXT)).rejects.toThrow(TypeError);
  });
});

describe("sealRowFields / openRowFields", () => {
  it("round-trips a field map through canonical JSON", async () => {
    const fields = { title: "Kupiti hleb", done: false, priority: 2, tags: ["kuca", "hitno"] };
    const sealed = await sealRowFields(port, CONTENT_KEY, IDENTITY, fields);
    expect(await openRowFields(port, CONTENT_KEY, IDENTITY, sealed)).toEqual(fields);
  });

  it("serialises equal state to equal plaintext regardless of key order", async () => {
    const local = createFakeCryptoPort({ seed: 1 });
    const nonce = new Uint8Array(24).fill(0x77);
    local.enqueueRandom(nonce);
    const a = await sealRowFields(local, CONTENT_KEY, IDENTITY, { a: 1, b: 2 });
    local.enqueueRandom(nonce);
    const b = await sealRowFields(local, CONTENT_KEY, IDENTITY, { b: 2, a: 1 });
    expect(b.ciphertext).toBe(a.ciphertext);
  });

  it("reports a plaintext that is not a JSON object", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, utf8("[1,2,3]"));
    await expectCode(openRowFields(port, CONTENT_KEY, IDENTITY, sealed), "row/bad-plaintext");
  });

  it("reports a plaintext carrying a prototype-poisoning key", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, utf8('{"__proto__":{"x":1}}'));
    await expectCode(openRowFields(port, CONTENT_KEY, IDENTITY, sealed), "row/bad-plaintext");
  });
});

describe("parseSealedRow", () => {
  it("accepts what sealRow produced and rejects everything else", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    expect(parseSealedRow(JSON.parse(JSON.stringify(sealed)))).toEqual(sealed);
    expect(parseSealedRow(null)).toBeNull();
    // `v: 1` is the AES-GCM/12-byte format this package used to write. There is
    // no reader for it and there is nothing in the world that produced one, so
    // the only way it can arrive is from a server trying to talk a client down
    // to a shorter nonce and a weaker AAD.
    expect(parseSealedRow({ ...sealed, v: 1 })).toBeNull();
    expect(parseSealedRow({ ...sealed, v: 3 })).toBeNull();
    expect(parseSealedRow({ ...sealed, v: "2" })).toBeNull();
    expect(parseSealedRow({ ...sealed, nonce: bytesToBase64url(new Uint8Array(23)) })).toBeNull();
    expect(parseSealedRow({ ...sealed, ciphertext: bytesToBase64url(new Uint8Array(15)) })).toBeNull();
    expect(parseSealedRow({ ...sealed, extra: true })).toBeNull();
  });

  it("throws row/malformed rather than reaching the AEAD", async () => {
    const sealed = await sealRow(port, CONTENT_KEY, IDENTITY, PLAINTEXT);
    await expectCode(
      openRow(port, CONTENT_KEY, IDENTITY, { ...sealed, nonce: "%%%" }),
      "row/malformed",
    );
  });
});
