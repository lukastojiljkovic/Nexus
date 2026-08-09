import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";
import type { PushRow, SyncScope } from "@nexus/sync";

import { base64urlToBytea } from "./bytea.js";
import { IDENTITY_COLUMNS, PULL_COLUMNS, PULL_SELECT, fromColumns, toInsert, toPatch } from "./rows.js";

const SCOPE: SyncScope = {
  userId: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
};

const filled = (length: number, value: number): string =>
  bytesToBase64url(Uint8Array.from({ length }, () => value));

const NONCE = filled(24, 0x0a);
const CIPHERTEXT = filled(17, 0x41);

const row = (over: Partial<PushRow> = {}): PushRow => ({
  collection: "tasks",
  objectId: "task-1",
  parentId: null,
  version: 1,
  deleted: false,
  ckEpoch: 1,
  sealed: { v: 2, nonce: NONCE, ciphertext: CIPHERTEXT },
  ...over,
});

describe("the select list", () => {
  it("names exactly the nine columns PulledRow has, and no more", () => {
    // `*` would bring back user_id/created_at/updated_at as well, and
    // `parsePulledRow` rejects unknown keys — so every pull would fail as
    // malformed. The list is not an optimisation.
    expect(PULL_COLUMNS).toHaveLength(9);
    expect(PULL_SELECT).toBe("collection,object_id,parent_id,version,deleted,ck_epoch,seq,nonce,ciphertext");
  });

  it("does not ask for the two columns the request already filtered on", () => {
    expect(PULL_SELECT.includes("user_id")).toBe(false);
    expect(PULL_SELECT.includes("profile_id")).toBe(false);
  });
});

describe("toInsert", () => {
  it("sends exactly the ten columns the INSERT grant names", () => {
    expect(Object.keys(toInsert(SCOPE, row())).sort()).toEqual(
      [
        "ciphertext",
        "ck_epoch",
        "collection",
        "deleted",
        "nonce",
        "object_id",
        "parent_id",
        "profile_id",
        "user_id",
        "version",
      ].sort(),
    );
  });

  it("does NOT send the format version, which is carried structurally", () => {
    // `SealedRow.v` exists so a parser can refuse a downgrade; the server has
    // nowhere to put it and does not need one — the 24-byte nonce CHECK and the
    // AAD label compiled into `row.ts` both pin the format. A column would be a
    // value the SERVER states and the client must then ignore.
    expect(JSON.stringify(toInsert(SCOPE, row())).includes('"v"')).toBe(false);
  });

  it("spells the two byte columns as hex bytea", () => {
    const insert = toInsert(SCOPE, row());
    expect(insert["nonce"]).toBe(base64urlToBytea(NONCE));
    expect(String(insert["nonce"]).startsWith("\\x")).toBe(true);
    expect(insert["ciphertext"]).toBe(base64urlToBytea(CIPHERTEXT));
  });

  it("takes the tenancy from the scope, never from the row", () => {
    const insert = toInsert(SCOPE, row());
    expect(insert["user_id"]).toBe(SCOPE.userId);
    expect(insert["profile_id"]).toBe(SCOPE.profileId);
  });
});

describe("toPatch", () => {
  it("sends exactly the six columns the UPDATE grant names", () => {
    expect(Object.keys(toPatch(row({ version: 2 }))).sort()).toEqual(
      ["ciphertext", "ck_epoch", "deleted", "nonce", "parent_id", "version"].sort(),
    );
  });

  it("names none of the four identity columns", () => {
    // They are the AEAD associated data. A statement that assigns them dies at
    // the parser with 42501 before a row is examined, which reads like an RLS
    // failure and is not one.
    const patch = toPatch(row({ version: 2 }));
    for (const column of IDENTITY_COLUMNS) {
      expect(Object.hasOwn(patch, column)).toBe(false);
    }
  });
});

describe("fromColumns", () => {
  const served = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    collection: "tasks",
    object_id: "task-1",
    parent_id: null,
    version: 3,
    deleted: false,
    ck_epoch: 1,
    seq: 42,
    nonce: base64urlToBytea(NONCE),
    ciphertext: base64urlToBytea(CIPHERTEXT),
    ...over,
  });

  it("renames the columns and decodes the bytea", () => {
    expect(fromColumns(served())).toEqual({
      collection: "tasks",
      objectId: "task-1",
      parentId: null,
      version: 3,
      deleted: false,
      ckEpoch: 1,
      seq: 42,
      nonce: NONCE,
      ciphertext: CIPHERTEXT,
    });
  });

  it("carries the empty object id of the six per-profile singletons", () => {
    expect(fromColumns(served({ collection: "calendar_settings", object_id: "" }))?.objectId).toBe("");
  });

  it("refuses a column the select list did not ask for", () => {
    // „The server answered a question it was not asked" is the signal
    // `parsePulledRow` refuses unknown keys to preserve, and it has to survive
    // the rename or it is lost exactly here.
    expect(fromColumns(served({ user_id: SCOPE.userId }))).toBeNull();
    expect(fromColumns(served({ updated_at: "2026-08-09T00:00:00Z" }))).toBeNull();
  });

  it("refuses a bytea that is not hex", () => {
    expect(fromColumns(served({ nonce: NONCE }))).toBeNull();
    expect(fromColumns(served({ ciphertext: "\\x0g" }))).toBeNull();
  });

  it("still enforces every bound parsePulledRow enforces", () => {
    // Delegated rather than re-checked, so this asserts the delegation happens
    // at all: a nonce of the wrong length, a version of zero, a collection name
    // the server's CHECK would refuse.
    expect(fromColumns(served({ nonce: base64urlToBytea(filled(23, 1)) }))).toBeNull();
    expect(fromColumns(served({ version: 0 }))).toBeNull();
    expect(fromColumns(served({ collection: "Tasks" }))).toBeNull();
    expect(fromColumns(served({ seq: 1.5 }))).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, 42, "row", [served()]]) {
      expect(fromColumns(value)).toBeNull();
    }
  });
});
