import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";
import {
  MAX_CIPHERTEXT_BYTES,
  MAX_OBJECT_ID_BYTES,
  MIN_CIPHERTEXT_BYTES,
  NONCE_BYTES,
  parsePulledRow,
} from "./wire.js";

const NONCE = bytesToBase64url(new Uint8Array(NONCE_BYTES).fill(1));
const CIPHERTEXT = bytesToBase64url(new Uint8Array(64).fill(2));

const ROW = {
  collection: "tasks",
  objectId: "01J0000000000000000000000",
  parentId: null,
  version: 3,
  deleted: false,
  ckEpoch: 1,
  seq: 17,
  nonce: NONCE,
  ciphertext: CIPHERTEXT,
};

describe("parsePulledRow", () => {
  it("accepts the shape the server really serves", () => {
    expect(parsePulledRow({ ...ROW })).toEqual(ROW);
  });

  it("accepts the empty object id the per-profile singletons have", () => {
    expect(parsePulledRow({ ...ROW, collection: "calendar_settings", objectId: "" })).not.toBeNull();
  });

  it("accepts a natural key and a U+001F composite", () => {
    expect(parsePulledRow({ ...ROW, collection: "fit_measurements", objectId: "2026-08-09" }))
      .not.toBeNull();
    expect(
      parsePulledRow({
        ...ROW,
        collection: "note_updates",
        objectId: `a0000000-0000-4000-8000-00000000000f7`,
      }),
    ).not.toBeNull();
  });

  it("rejects anything that is not an object", () => {
    for (const value of [null, undefined, 0, "row", [ROW], true]) {
      expect(parsePulledRow(value)).toBeNull();
    }
  });

  it("rejects a column the server invented", () => {
    // The same rule `parseSealedRow` and `parseSealedKey` follow: a field this
    // client does not understand but stores and re-emits is a channel the
    // server controls.
    expect(parsePulledRow({ ...ROW, extra: 1 })).toBeNull();
  });

  it("rejects a collection name that is not the server's own shape", () => {
    for (const collection of ["Tasks", "1tasks", "tasks-list", "", "a".repeat(65), "tasks;drop"]) {
      expect(parsePulledRow({ ...ROW, collection })).toBeNull();
    }
    expect(parsePulledRow({ ...ROW, collection: "a".repeat(64) })).not.toBeNull();
  });

  it("measures the object id in BYTES, as the server's octet_length does", () => {
    // 255 ASCII characters fit; 128 two-byte characters are 256 bytes and do
    // not. A client checking String.length would have sent the second one.
    expect(parsePulledRow({ ...ROW, objectId: "x".repeat(MAX_OBJECT_ID_BYTES) })).not.toBeNull();
    expect(parsePulledRow({ ...ROW, objectId: "x".repeat(MAX_OBJECT_ID_BYTES + 1) })).toBeNull();
    expect(parsePulledRow({ ...ROW, objectId: "š".repeat(128) })).toBeNull();
    expect(parsePulledRow({ ...ROW, objectId: "š".repeat(127) })).not.toBeNull();
  });

  it("rejects a parent id that names nothing", () => {
    expect(parsePulledRow({ ...ROW, parentId: "" })).toBeNull();
    expect(parsePulledRow({ ...ROW, parentId: "x".repeat(256) })).toBeNull();
    expect(parsePulledRow({ ...ROW, parentId: "x" })).not.toBeNull();
  });

  it("treats a missing parent id as a root, and a non-string as a lie", () => {
    const { parentId: _parentId, ...withoutParent } = ROW;
    expect(parsePulledRow(withoutParent)?.parentId).toBe(null);
    expect(parsePulledRow({ ...ROW, parentId: 7 })).toBeNull();
  });

  it("rejects a version, epoch or seq that is not a positive safe integer", () => {
    for (const field of ["version", "ckEpoch", "seq"] as const) {
      for (const value of [0, -1, 1.5, Number.NaN, "3", Number.MAX_SAFE_INTEGER + 2]) {
        expect(parsePulledRow({ ...ROW, [field]: value })).toBeNull();
      }
    }
  });

  it("rejects an epoch above the smallint column that would hold it", () => {
    expect(parsePulledRow({ ...ROW, ckEpoch: 32767 })).not.toBeNull();
    expect(parsePulledRow({ ...ROW, ckEpoch: 32768 })).toBeNull();
  });

  it("rejects a tombstone flag that is not a boolean", () => {
    expect(parsePulledRow({ ...ROW, deleted: "true" })).toBeNull();
    expect(parsePulledRow({ ...ROW, deleted: 1 })).toBeNull();
  });

  it("rejects a nonce that is not exactly 24 bytes of base64url", () => {
    expect(parsePulledRow({ ...ROW, nonce: bytesToBase64url(new Uint8Array(23)) })).toBeNull();
    expect(parsePulledRow({ ...ROW, nonce: bytesToBase64url(new Uint8Array(25)) })).toBeNull();
    expect(parsePulledRow({ ...ROW, nonce: "!!!!" })).toBeNull();
    // Padded base64 is not base64url, and accepting it would mean two spellings
    // of one nonce reaching the AEAD.
    expect(parsePulledRow({ ...ROW, nonce: `${NONCE}==` })).toBeNull();
  });

  it("rejects a ciphertext shorter than one byte plus a tag", () => {
    expect(
      parsePulledRow({
        ...ROW,
        ciphertext: bytesToBase64url(new Uint8Array(MIN_CIPHERTEXT_BYTES - 1)),
      }),
    ).toBeNull();
    expect(
      parsePulledRow({ ...ROW, ciphertext: bytesToBase64url(new Uint8Array(MIN_CIPHERTEXT_BYTES)) }),
    ).not.toBeNull();
  });

  it("rejects a ciphertext past the 4 MiB ceiling without decoding it", () => {
    // The character count alone decides, which is the point: a hostile server
    // does not get to make a client materialise a gigabyte to find that out.
    const tooLong = "A".repeat(Math.ceil(((MAX_CIPHERTEXT_BYTES + 1024) * 4) / 3));
    expect(parsePulledRow({ ...ROW, ciphertext: tooLong })).toBeNull();
  });
});
