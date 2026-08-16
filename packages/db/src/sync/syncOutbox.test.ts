import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, emptyRowState, hlcSend, hlcZero, rowFields } from "@nexus/sync-crypto";
import type { Hlc, RowState } from "@nexus/sync-crypto";
import { SyncJournal, TaskListStore, TaskStore, openDatabase, uuidv7 } from "../index.js";
import type { ApplyRequest, NexusDatabase } from "../index.js";

/**
 * The owed set — „the server does not have this object" — and the defect it
 * exists to close.
 *
 * `sweep` writes the new `RowState` into `sync_row_state` and drops the journal
 * entry, and both happen before a push is even attempted. Before migration 066
 * nothing recorded that the server had not got it, so a push that came back
 * `unavailable` left an object that was clean locally and unsent — and it would
 * never be swept again, because `sweepRow` diffs the row against the shadow state
 * and returns `null` when they agree, which after the sweep they do.
 *
 * The test that matters here is „a sweep, a failed push, and a second sweep" —
 * the second sweep is what proves the journal ALONE could not have remembered.
 */

const NOW = "2026-08-16T10:00:00.000Z";
const LATER = "2026-08-16T10:05:00.000Z";
const LATEST = "2026-08-16T10:10:00.000Z";
const LATEST_HLC: Hlc = hlcSend(hlcZero("device-b"), Date.parse(LATEST));

/** One merged object, as a pull hands it to the apply. */
function request(objectId: string, merged: RowState, owed: boolean): ApplyRequest {
  return { collection: "tasks", objectId, merged, changed: true, owed };
}

let dir: string;
let db: NexusDatabase;
let journal: SyncJournal;
let profileId: string;

/** The Inbox and the first sweep, so every test below starts from a settled file. */
function settle(): void {
  journal.setEnabled(true, [profileId]);
  journal.sweep(profileId, NOW);
  for (const owed of journal.owed(profileId)) {
    journal.confirmPushed(profileId, owed.collection, owed.objectId, owed.state, NOW);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-outbox-"));
  db = openDatabase({ path: join(dir, "outbox.db") });
  journal = new SyncJournal(db.raw);
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  new TaskListStore(db.raw, profileId).ensureInbox(NOW);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("what a sweep owes", () => {
  it("queues every object it produced, with the state the push will seal", () => {
    settle();
    const task = new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);

    const swept = journal.sweep(profileId, LATER);
    const owed = journal.owed(profileId);

    expect(swept).toHaveLength(1);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.collection).toBe("tasks");
    expect(owed[0]?.objectId).toBe(task.id);
    expect(owed[0]?.attempts).toBe(0);
    // The same state, not a re-read: what is owed is what the sweep decided.
    expect(rowFields(owed[0]!.state)["title"]).toBe("Prijava");
    expect(owed[0]?.state).toEqual(swept[0]?.state);
  });

  it("queues nothing for an entry whose row turned out not to have changed", () => {
    settle();
    const store = new TaskStore(db.raw, profileId);
    const task = store.create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    for (const owed of journal.owed(profileId)) {
      journal.confirmPushed(profileId, owed.collection, owed.objectId, owed.state, LATER);
    }

    // A save that writes the same values still fires the trigger and journals.
    store.update(task.id, { title: "Prijava" });
    expect(journal.pendingCount(profileId)).toBe(1);

    expect(journal.sweep(profileId, LATEST)).toEqual([]);
    expect(journal.owed(profileId)).toEqual([]);
  });
});

describe("what happens after the push", () => {
  it("clears the row and stores the version the server accepted", () => {
    settle();
    new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    const owed = journal.owed(profileId)[0]!;
    expect(owed.state.version).toBe(0);

    // What `planPush` hands back as `next`: the same state at version + 1.
    journal.confirmPushed(
      profileId,
      owed.collection,
      owed.objectId,
      { ...owed.state, version: 1 },
      LATEST,
    );

    expect(journal.owed(profileId)).toEqual([]);
    expect(journal.readState(profileId, owed.collection, owed.objectId)?.version).toBe(1);
  });

  it("does not re-dirty the journal when it stores the accepted version", () => {
    settle();
    new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    const owed = journal.owed(profileId)[0]!;

    journal.confirmPushed(
      profileId,
      owed.collection,
      owed.objectId,
      { ...owed.state, version: 1 },
      LATEST,
    );

    expect(journal.pendingCount(profileId)).toBe(0);
  });

  it("keeps it owed after a failure, and records what the server said", () => {
    settle();
    new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    const first = journal.owed(profileId)[0]!;

    journal.recordPushFailure(profileId, first.collection, first.objectId, "unavailable", "503");

    const again = journal.owed(profileId);
    expect(again).toHaveLength(1);
    expect(again[0]?.attempts).toBe(1);
    // The state is untouched: a failed push changes nothing about what is owed.
    expect(again[0]?.state).toEqual(first.state);
  });

  it("THE DEFECT: a failed push survives a second sweep, which produces nothing", () => {
    settle();
    const task = new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    const owed = journal.owed(profileId)[0]!;
    journal.recordPushFailure(profileId, owed.collection, owed.objectId, "unavailable", null);

    // The row and the shadow state now agree, so nothing here can rediscover it:
    // journaling the object again produces an empty sweep. Before the outbox this
    // is exactly where the object was lost — clean locally, and never sent.
    new TaskStore(db.raw, profileId).update(task.id, { title: "Prijava" });
    expect(journal.sweep(profileId, LATEST)).toEqual([]);

    expect(journal.owed(profileId).map((row) => row.objectId)).toEqual([task.id]);
  });
});

describe("what a pull leaves owed", () => {
  /**
   * The same defect as above, in the other direction. `applyPull` answers
   * `owed: true` when the merge differs from what the SERVER holds — a local
   * edit the peer had not seen, folded into an arriving row — and that fact
   * lived only in a return value. The apply writes with migration 063's trigger
   * flag off, so no journal entry appears, and afterwards the row and the shadow
   * state agree, so no sweep can rediscover it either. The edit would be on this
   * device, correct, and never sent again.
   */
  function taskState(title: string): { objectId: string; state: RowState } {
    settle();
    const task = new TaskStore(db.raw, profileId).create({ title }, LATER);
    journal.sweep(profileId, LATER);
    // By id rather than by position: what this helper hands back has to be the
    // task it just created, and „the first thing the sweep produced" is only the
    // same object for as long as nothing else is ever swept alongside it.
    const owed = journal.owed(profileId).find((each) => each.objectId === task.id)!;
    journal.confirmPushed(profileId, "tasks", owed.objectId, owed.state, LATER);
    return { objectId: owed.objectId, state: owed.state };
  }

  it("owes the merge the server has not seen, at the state the merge produced", () => {
    const { objectId, state } = taskState("Prijava");
    expect(journal.owed(profileId)).toEqual([]);

    const merged = applyEdit(state, { title: "Prijava na ispit" }, LATEST_HLC);
    expect(journal.apply(profileId, [request(objectId, merged, true)], LATEST)).toEqual([
      { collection: "tasks", objectId, status: "written" },
    ]);

    const owed = journal.owed(profileId);
    expect(owed.map((each) => each.objectId)).toEqual([objectId]);
    expect(rowFields(owed[0]!.state)["title"]).toBe("Prijava na ispit");
  });

  it("owes nothing when the merge is what the server already holds", () => {
    const { objectId, state } = taskState("Prijava");

    journal.apply(profileId, [request(objectId, state, false)], LATEST);

    expect(journal.owed(profileId)).toEqual([]);
  });

  it("THE DEFECT AGAIN: nothing else could have remembered it", () => {
    const { objectId, state } = taskState("Prijava");
    const merged = applyEdit(state, { title: "Prijava na ispit" }, LATEST_HLC);
    journal.apply(profileId, [request(objectId, merged, true)], LATEST);

    // The apply ran with the trigger flag off, so it journalled nothing; and the
    // row it wrote now matches the shadow state, so a sweep answers empty. The
    // outbox row is the only surviving record that the server is behind.
    expect(journal.pendingCount(profileId)).toBe(0);
    expect(journal.sweep(profileId, LATEST)).toEqual([]);
    expect(journal.owed(profileId).map((each) => each.objectId)).toEqual([objectId]);
  });

  it("owes nothing for a row SQLite refused, because the queue is inside its transaction", () => {
    const { state } = taskState("Prijava");
    // A task pointing at a list that does not exist here — the ordinary shape of
    // a cursor walk that reached the child before the parent.
    const orphan = uuidv7();
    const merged = applyEdit(state, { list_id: uuidv7() }, LATEST_HLC);

    const [outcome] = journal.apply(profileId, [request(orphan, merged, true)], LATEST);

    expect(outcome?.status).toBe("refused");
    expect(journal.owed(profileId)).toEqual([]);
  });

  it("owes nothing for a merge it refused as stale", () => {
    settle();
    const task = new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    // Never swept, so the local edit is still in the journal and the merge was
    // computed against a baseline this device no longer holds.
    expect(journal.pendingCount(profileId)).toBe(1);

    const merged = applyEdit(emptyRowState(LATEST_HLC), { title: "Sa servera" }, LATEST_HLC);
    const [outcome] = journal.apply(profileId, [request(task.id, merged, true)], LATEST);

    expect(outcome?.status).toBe("stale");
    expect(journal.owed(profileId)).toEqual([]);
  });
});

describe("the order the queue is drained in", () => {
  it("puts the objects that have failed least first, so one bad row cannot starve it", () => {
    settle();
    const store = new TaskStore(db.raw, profileId);
    const a = store.create({ title: "A" }, LATER);
    const b = store.create({ title: "B" }, LATER);
    journal.sweep(profileId, LATER);

    // `a` is the one that can never be sent — a permanent refusal, retried twice.
    journal.recordPushFailure(profileId, "tasks", a.id, "rejected", "NX004");
    journal.recordPushFailure(profileId, "tasks", a.id, "rejected", "NX004");

    expect(journal.owed(profileId).map((row) => row.objectId)).toEqual([b.id, a.id]);
  });

  it("counts the whole queue even when a page of it is all anyone asked for", () => {
    settle();
    const store = new TaskStore(db.raw, profileId);
    for (const title of ["A", "B", "C"]) store.create({ title }, LATER);
    journal.sweep(profileId, LATER);

    // The count is what a screen shows. Derived from a page it would silently
    // stop counting at the page size, which is the shape of „247 of your items
    // are waiting" reading 100 for ever.
    expect(journal.owed(profileId, 1)).toHaveLength(1);
    expect(journal.owedCount(profileId)).toBe(3);
  });

  it("counts nothing for a queue entry whose shadow state is gone", () => {
    settle();
    new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    const owed = journal.owed(profileId)[0]!;
    db.raw
      .prepare("DELETE FROM sync_row_state WHERE profile_id = ? AND object_id = ?")
      .run(profileId, owed.objectId);

    // `owed` skips it, so counting it would report work the push can never find.
    expect(journal.owed(profileId)).toEqual([]);
    expect(journal.owedCount(profileId)).toBe(0);
  });

  it("hands back no more than it was asked for", () => {
    settle();
    const store = new TaskStore(db.raw, profileId);
    store.create({ title: "A" }, LATER);
    store.create({ title: "B" }, LATER);
    journal.sweep(profileId, LATER);

    expect(journal.owed(profileId, 1)).toHaveLength(1);
  });
});

describe("forgetting", () => {
  it("empties the owed set with the rest of the profile's sync state", () => {
    settle();
    new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);
    expect(journal.owed(profileId)).toHaveLength(1);

    journal.forget(profileId);

    expect(journal.owed(profileId)).toEqual([]);
  });

  it("keeps one profile's owed set out of another's", () => {
    const other = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(other, "personal", "Drugi", NOW);
    new TaskListStore(db.raw, other).ensureInbox(NOW);

    journal.setEnabled(true, [profileId]);
    journal.sweep(profileId, NOW);

    expect(journal.owed(profileId).length).toBeGreaterThan(0);
    expect(journal.owed(other)).toEqual([]);
  });
});
