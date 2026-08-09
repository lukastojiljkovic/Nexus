import { describe, expect, it } from "vitest";
import {
  applyEdit,
  emptyRowState,
  encodeRowState,
  hlcSend,
  hlcZero,
  markDeleted,
  rowFields,
  sealRowFields,
  type Hlc,
  type RowState,
} from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { applyPull, type PullApplied, type PullResult } from "./pull.js";
import { planPush, type PushAccepted, type SyncScope } from "./push.js";
import type { PulledRow } from "./wire.js";

const port = createFakeCryptoPort({ seed: 23 });

const SCOPE: SyncScope = { userId: "user-1", profileId: "profile-a" };
const CONTENT_KEY = new Uint8Array(32).fill(0x33);
const OTHER_KEY = new Uint8Array(32).fill(0x44);
const EPOCH = 2;
const OBJECT = "01J0000000000000000000000";

const T0 = 1_800_000_000_000;
const EARLY: Hlc = hlcSend(hlcZero("device-b"), T0);
const LATE: Hlc = hlcSend(hlcZero("device-b"), T0 + 60_000);

const keyFor = (epoch: number): Uint8Array | null => (epoch === EPOCH ? CONTENT_KEY : null);
const noLocal = (): null => null;

/**
 * A row as the server would serve it, produced by the real push path — so the
 * ciphertext under test is the one a peer would actually have written.
 */
async function served(
  state: RowState,
  overrides: Partial<PulledRow> = {},
  epoch = EPOCH,
): Promise<PulledRow> {
  const [outcome] = await planPush(port, SCOPE, CONTENT_KEY, epoch, [
    { collection: "tasks", objectId: OBJECT, parentId: null, state },
  ]);
  const { row } = outcome as PushAccepted;
  return {
    collection: row.collection,
    objectId: row.objectId,
    parentId: row.parentId,
    version: row.version,
    deleted: row.deleted,
    ckEpoch: row.ckEpoch,
    seq: 10,
    nonce: row.sealed.nonce,
    ciphertext: row.sealed.ciphertext,
    ...overrides,
  };
}

/** `n` fields, stamped at `at`, over an object last seen at `version`. */
function state(fields: Record<string, string>, at: Hlc, version = 0): RowState {
  return { ...applyEdit(emptyRowState(at), fields, at), version };
}

const applied = (result: PullResult): PullApplied => result.outcomes[0] as PullApplied;

describe("opening what the server served", () => {
  it("merges a row this device has never seen and reports it as a change it owes nothing on", async () => {
    const row = await served(state({ title: "Kupovina" }, EARLY));
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 0, [row]);

    const outcome = applied(result);
    expect(outcome.ok).toBe(true);
    expect(rowFields(outcome.merged)).toEqual({ title: "Kupovina" });
    expect(outcome.changed).toBe(true);
    expect(outcome.owed).toBe(false);
    expect(outcome.rolledBack).toBe(false);
    expect(result.nextSeq).toBe(10);
    expect(result.quarantined).toEqual([]);
  });

  it("takes the newer stamp field by field, and owes a push when the local side won anything", async () => {
    const remote = await served(state({ title: "stari", note: "sa servera" }, EARLY));
    const local = state({ title: "noviji" }, LATE, 1);

    const outcome = applied(await applyPull(port, SCOPE, keyFor, () => local, 0, [remote]));
    expect(rowFields(outcome.merged)).toEqual({ title: "noviji", note: "sa servera" });
    // The merge differs from BOTH sides: the local row must be rewritten, and
    // the server has not seen `title: "noviji"` yet.
    expect(outcome.changed).toBe(true);
    expect(outcome.owed).toBe(true);
  });

  it("reports no change at all when the server is serving back what this device holds", async () => {
    const fields = { title: "Kupovina" };
    const remote = await served(state(fields, EARLY));
    const local = state(fields, EARLY, 1);

    const outcome = applied(await applyPull(port, SCOPE, keyFor, () => local, 0, [remote]));
    expect(outcome.changed).toBe(false);
    expect(outcome.owed).toBe(false);
  });

  it("ignores the version when deciding `owed` — otherwise every pull would owe a push", async () => {
    // Identical content, but the server is three versions ahead. Counting the
    // version as content would make this a push of bytes the server already has,
    // on every sync, forever.
    const fields = { title: "Kupovina" };
    const remote = await served({ ...state(fields, EARLY), version: 6 });
    const local = state(fields, EARLY, 1);

    const outcome = applied(await applyPull(port, SCOPE, keyFor, () => local, 0, [remote]));
    expect(remote.version).toBe(7);
    expect(outcome.owed).toBe(false);
  });

  it("flags a server serving a version below one already merged, and merges anyway", async () => {
    const remote = await served(state({ title: "stari" }, EARLY, 1));
    const local = state({ title: "noviji" }, LATE, 9);

    const outcome = applied(await applyPull(port, SCOPE, keyFor, () => local, 0, [remote]));
    expect(remote.version).toBe(2);
    expect(outcome.rolledBack).toBe(true);
    // It recovers on its own: the greater version survives and the push that
    // follows carries the newer state.
    expect(outcome.merged.version).toBe(9);
    expect(rowFields(outcome.merged)).toEqual({ title: "noviji" });
  });

  it("carries a tombstone through as a stamped fact, not an absence", async () => {
    const remote = await served(markDeleted(state({ title: "Kupovina" }, EARLY), LATE));
    expect(remote.deleted).toBe(true);

    const outcome = applied(await applyPull(port, SCOPE, keyFor, noLocal, 0, [remote]));
    expect(outcome.merged.deleted).toEqual({ value: true, at: LATE });
    expect(rowFields(outcome.merged)).toEqual({ title: "Kupovina" });
  });
});

describe("the AAD is rebuilt from the server's own claim", () => {
  it("refuses every clear column the server could have rewritten", async () => {
    const row = await served(state({ title: "Kupovina" }, EARLY));

    for (const tamper of [
      { version: row.version + 1 },
      { deleted: true },
      { parentId: "01J1111111111111111111111" },
      { collection: "notes" },
      { objectId: "01J2222222222222222222222" },
    ] as const) {
      const result = await applyPull(port, SCOPE, keyFor, noLocal, 0, [{ ...row, ...tamper }]);
      expect(result.outcomes[0]).toMatchObject({ ok: false, reason: "aead-failed" });
    }
  });

  it("refuses a row moved into another profile, which is the same rewrite one layer up", async () => {
    const row = await served(state({ title: "Kupovina" }, EARLY));
    const elsewhere = { userId: SCOPE.userId, profileId: "profile-b" };
    const result = await applyPull(port, elsewhere, keyFor, noLocal, 0, [row]);
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: "aead-failed" });
  });

  it("refuses a claimed epoch the row was not sealed under, rather than trying another key", async () => {
    // `ckEpoch` is in the AAD, so a row relabelled from epoch 2 to epoch 3 has
    // to fail — and it must fail as a tag error, not as a second decryption
    // attempt under whichever key happens to be lying around.
    const row = await served(state({ title: "Kupovina" }, EARLY));
    const bothEpochs = (): Uint8Array => CONTENT_KEY;
    const result = await applyPull(port, SCOPE, bothEpochs, noLocal, 0, [
      { ...row, ckEpoch: EPOCH + 1 },
    ]);
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: "aead-failed" });
  });

  it("refuses a ciphertext written under a key this account does not hold", async () => {
    const row = await served(state({ title: "Kupovina" }, EARLY));
    const wrong = (): Uint8Array => OTHER_KEY;
    const result = await applyPull(port, SCOPE, wrong, noLocal, 0, [row]);
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: "aead-failed" });
  });

  it("separates a peer this client cannot understand from a server it cannot trust", async () => {
    // Sealed correctly, by someone holding CK_p — and the tombstone inside the
    // ciphertext contradicts the one in the envelope the same key authenticated.
    // Nothing about that is the server's doing, so it must not be reported as
    // an AEAD failure.
    const identity = {
      userId: SCOPE.userId,
      profileId: SCOPE.profileId,
      collection: "tasks",
      objectId: OBJECT,
      version: 1,
      deleted: true,
      parentId: null,
      ckEpoch: EPOCH,
    };
    const sealed = await sealRowFields(
      port,
      CONTENT_KEY,
      identity,
      encodeRowState(state({ title: "Kupovina" }, EARLY)),
    );
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 0, [
      {
        collection: "tasks",
        objectId: OBJECT,
        parentId: null,
        version: 1,
        deleted: true,
        ckEpoch: EPOCH,
        seq: 10,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
      },
    ]);
    expect(result.outcomes[0]).toMatchObject({ ok: false, reason: "bad-plaintext" });
  });
});

describe("the cursor", () => {
  const rows = async (): Promise<PulledRow[]> => [
    await served(state({ title: "a" }, EARLY), { seq: 11 }),
    await served(state({ title: "b" }, EARLY), { seq: 12 }),
    await served(state({ title: "c" }, EARLY), { seq: 13 }),
  ];

  it("advances to the last row of a clean batch", async () => {
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 5, await rows());
    expect(result.nextSeq).toBe(13);
  });

  it("HOLDS at the row before a missing key — a retry after unwrapping will succeed", async () => {
    const batch = await rows();
    batch[1] = { ...batch[1]!, ckEpoch: 5 };
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 5, batch);

    expect(result.outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(result.nextSeq).toBe(11);
    // Reported, but NOT quarantined: the row is arriving again from seq 11 on
    // the next pull, so telling the caller to chase it by key would be telling
    // it to report a rotation in progress as a row that cannot be read.
    expect(result.outcomes[1]).toMatchObject({ reason: "no-key", seq: 12 });
    expect(result.quarantined).toEqual([]);
  });

  it("holds at `fromSeq` when the very first row blocks, so nothing is ever skipped", async () => {
    const batch = await rows();
    batch[0] = { ...batch[0]!, ckEpoch: 5 };
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 5, batch);
    expect(result.nextSeq).toBe(5);
  });

  it("ADVANCES past a row that will never open, and quarantines it by key", async () => {
    // The alternative is a permanent stall on a failure that answers the same
    // way every time, with every later row behind it.
    const batch = await rows();
    batch[1] = { ...batch[1]!, deleted: true };
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 5, batch);

    expect(result.nextSeq).toBe(13);
    expect(result.quarantined).toEqual([
      { ok: false, collection: "tasks", objectId: OBJECT, seq: 12, reason: "aead-failed" },
    ]);
  });

  it("stops at a row out of order rather than throwing — a shuffling server stalls itself", async () => {
    const batch = await rows();
    const shuffled = [batch[0]!, batch[2]!, batch[1]!];
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 5, shuffled);

    // Every row is still opened and reported; only the cursor refuses to move.
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, true]);
    expect(result.nextSeq).toBe(13);

    const repeated = [batch[0]!, batch[0]!, batch[2]!];
    expect((await applyPull(port, SCOPE, keyFor, noLocal, 5, repeated)).nextSeq).toBe(11);
  });

  it("does not move at all on an empty batch", async () => {
    const result = await applyPull(port, SCOPE, keyFor, noLocal, 42, []);
    expect(result).toEqual({ outcomes: [], nextSeq: 42, quarantined: [] });
  });
});
