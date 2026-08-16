import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rowFields } from "@nexus/sync-crypto";
import { SyncJournal, TaskListStore, TaskStore, openDatabase, uuidv7 } from "../index.js";
import type { NexusDatabase } from "../index.js";

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
