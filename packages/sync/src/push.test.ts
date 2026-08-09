import { describe, expect, it } from "vitest";
import {
  applyEdit,
  decodeRowState,
  emptyRowState,
  hlcSend,
  hlcZero,
  markDeleted,
  openRowFields,
  rowFields,
  type Hlc,
  type RowState,
} from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { planPush, type PushAccepted, type PushCandidate, type SyncScope } from "./push.js";
import { MAX_VERSION } from "./wire.js";

const port = createFakeCryptoPort({ seed: 7 });

const SCOPE: SyncScope = { userId: "user-1", profileId: "profile-a" };
const CONTENT_KEY = new Uint8Array(32).fill(0x33);
const EPOCH = 2;

const T0 = 1_800_000_000_000;
const NOW: Hlc = hlcSend(hlcZero("device-a"), T0);

/** A row this device has edited once and never pushed. */
function fresh(fields: Record<string, string> = { title: "Kupovina" }): RowState {
  return applyEdit(emptyRowState(NOW), fields, NOW);
}

function candidate(overrides: Partial<PushCandidate> = {}): PushCandidate {
  return {
    collection: "tasks",
    objectId: "01J0000000000000000000000",
    parentId: null,
    state: fresh(),
    ...overrides,
  };
}

async function planOne(candidate: PushCandidate) {
  const [outcome] = await planPush(port, SCOPE, CONTENT_KEY, EPOCH, [candidate]);
  return outcome!;
}

/** Every accepted push is asserted through this, never through its own return value alone. */
async function openBack(accepted: PushAccepted) {
  const { row } = accepted;
  return openRowFields(
    port,
    CONTENT_KEY,
    {
      userId: SCOPE.userId,
      profileId: SCOPE.profileId,
      collection: row.collection,
      objectId: row.objectId,
      version: row.version,
      deleted: row.deleted,
      parentId: row.parentId,
      ckEpoch: row.ckEpoch,
    },
    row.sealed,
  );
}

describe("the version arithmetic", () => {
  it("creates a never-pushed object at version 1 — the one number NX002 accepts", async () => {
    const outcome = await planOne(candidate());
    expect(outcome.ok).toBe(true);
    expect((outcome as PushAccepted).row.version).toBe(1);
  });

  it("submits observed + 1, which is the whole of NX001", async () => {
    const state: RowState = { ...fresh(), version: 41 };
    const outcome = (await planOne(candidate({ state }))) as PushAccepted;
    expect(outcome.row.version).toBe(42);
  });

  it("returns the next local state at the SUBMITTED version, not the observed one", async () => {
    // A local copy left at the observed version would push the same number
    // twice and be refused as NX001 forever; one advanced further would skip a
    // number the server never saw.
    const state: RowState = { ...fresh(), version: 4 };
    const outcome = (await planOne(candidate({ state }))) as PushAccepted;
    expect(outcome.next.version).toBe(5);
    expect(rowFields(outcome.next)).toEqual(rowFields(state));
    expect(outcome.next.deleted).toEqual(state.deleted);
  });

  it("refuses a version that is not a non-negative safe integer, or would overflow", async () => {
    for (const version of [-1, 1.5, Number.NaN, MAX_VERSION]) {
      const outcome = await planOne(candidate({ state: { ...fresh(), version } }));
      expect(outcome).toMatchObject({ ok: false, reason: "version-range" });
    }
  });
});

describe("what the server would refuse, refused here by name", () => {
  it("names the collection, the object id and the parent id separately", async () => {
    const long = "x".repeat(256);
    expect(await planOne(candidate({ collection: "Tasks" }))).toMatchObject({
      ok: false,
      reason: "collection-shape",
    });
    expect(await planOne(candidate({ objectId: long }))).toMatchObject({
      ok: false,
      reason: "object-id-too-long",
    });
    expect(await planOne(candidate({ parentId: "" }))).toMatchObject({
      ok: false,
      reason: "parent-id-shape",
    });
    expect(await planOne(candidate({ parentId: long }))).toMatchObject({
      ok: false,
      reason: "parent-id-shape",
    });
  });

  it("measures ids in BYTES, because the server's CHECKs are octet_length", async () => {
    // 128 two-byte characters: 128 code units, 256 bytes. A length check in
    // JavaScript's units would wave this through and collect a 23514 instead.
    const objectId = "š".repeat(128);
    expect(objectId.length).toBe(128);
    expect(await planOne(candidate({ objectId }))).toMatchObject({
      ok: false,
      reason: "object-id-too-long",
    });
    expect((await planOne(candidate({ objectId: "š".repeat(127) }))).ok).toBe(true);
  });

  it("accepts an empty object id — the per-profile singletons identify by it", async () => {
    expect((await planOne(candidate({ collection: "calendar_settings", objectId: "" }))).ok).toBe(
      true,
    );
  });

  it("refuses one candidate without costing the rest of the batch their round trip", async () => {
    const outcomes = await planPush(port, SCOPE, CONTENT_KEY, EPOCH, [
      candidate({ objectId: "a" }),
      candidate({ collection: "NOPE", objectId: "b" }),
      candidate({ objectId: "c" }),
    ]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    // In order, and named — a `filter` would have dropped the middle one silently.
    expect(outcomes[1]).toMatchObject({ objectId: "b", reason: "collection-shape" });
  });
});

describe("what is actually sealed", () => {
  it("seals the STAMPED state, so the clocks travel inside the ciphertext", async () => {
    // The reason field-level merge survives a hostile server: a server that
    // could read or rewrite the HLCs would decide every conflict on the account.
    const state = fresh({ title: "Kupovina" });
    const accepted = (await planOne(candidate({ state }))) as PushAccepted;
    const plaintext = await openBack(accepted);
    const decoded = decodeRowState(plaintext, { version: 1, deleted: false });
    expect(decoded).not.toBeNull();
    expect(decoded!.fields["title"]).toEqual({ value: "Kupovina", at: NOW });
  });

  it("binds the version, the tombstone, the parent and the epoch into the AAD", async () => {
    const accepted = (await planOne(
      candidate({ parentId: "01J1111111111111111111111", state: markDeleted(fresh(), NOW) }),
    )) as PushAccepted;

    expect(accepted.row.deleted).toBe(true);
    expect(accepted.row.ckEpoch).toBe(EPOCH);
    await expect(openBack(accepted)).resolves.toBeTruthy();

    // Each of these is a clear column the server can rewrite with one UPDATE.
    for (const tamper of [
      { version: accepted.row.version + 1 },
      { deleted: false },
      { parentId: null },
      { ckEpoch: EPOCH + 1 },
      { collection: "notes" },
      { objectId: "01J2222222222222222222222" },
    ]) {
      const moved = { ...accepted, row: { ...accepted.row, ...tamper } };
      await expect(openBack(moved)).rejects.toMatchObject({ code: "row/aead-failed" });
    }
  });

  it("draws a fresh nonce every time, so NX005 can never fire on an honest client", async () => {
    const state = fresh();
    const first = (await planOne(candidate({ state }))) as PushAccepted;
    const second = (await planOne(candidate({ state }))) as PushAccepted;
    expect(second.row.sealed.nonce).not.toBe(first.row.sealed.nonce);
    // Same state, same version, different bytes — which is also why NX003 („the
    // ciphertext must change") is free for a client that never reuses one.
    expect(second.row.sealed.ciphertext).not.toBe(first.row.sealed.ciphertext);
  });

  it("seals at the epoch it was given, not the one the row was stored under", async () => {
    // That is what makes a content-key rotation an ordinary push.
    const [outcome] = await planPush(port, SCOPE, CONTENT_KEY, 9, [
      candidate({ state: { ...fresh(), version: 3 } }),
    ]);
    expect((outcome as PushAccepted).row.ckEpoch).toBe(9);
  });

  it("puts the parent id in the row AND in the AAD, so the hint cannot disagree", async () => {
    const accepted = (await planOne(
      candidate({ parentId: "01J1111111111111111111111" }),
    )) as PushAccepted;
    expect(accepted.row.parentId).toBe("01J1111111111111111111111");
    await expect(openBack(accepted)).resolves.toBeTruthy();
  });
});
