import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareHlc, parseHlc, rowFields, type Hlc } from "@nexus/sync-crypto";
import { NoteStore, SyncJournal, TaskListStore, TaskStore, openDatabase, uuidv7 } from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * The sweep, end to end: a local edit becomes a stamped `RowState` in
 * `sync_row_state` and a journal entry disappears, or neither happens.
 */

const NOW = "2026-08-09T10:00:00.000Z";
const LATER = "2026-08-09T10:05:00.000Z";
const LATEST = "2026-08-09T10:10:00.000Z";
const US = String.fromCharCode(31);

let dir: string;
let db: NexusDatabase;
let journal: SyncJournal;
let profileId: string;

function meta(key: string): string | null {
  const row = db.raw.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function stateRows(): number {
  return (db.raw.prepare("SELECT count(*) AS n FROM sync_row_state").get() as { n: number }).n;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-sweep-"));
  db = openDatabase({ path: join(dir, "sweep.db") });
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

describe("switching it on", () => {
  it("starts off, and turning it on enqueues what is already in the file", () => {
    expect(journal.isEnabled()).toBe(false);
    expect(journal.pendingCount(profileId)).toBe(0);

    journal.setEnabled(true, [profileId]);

    expect(journal.isEnabled()).toBe(true);
    // The Inbox created before the flag went up — a row no trigger ever saw, and
    // exactly the thing an initial enqueue exists to catch.
    expect(journal.pendingCount(profileId)).toBe(1);
  });

  it("leaves another profile alone, because a local-only profile has nothing to send", () => {
    const other = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(other, "personal", "Lokalni", NOW);
    new TaskListStore(db.raw, other).ensureInbox(NOW);

    journal.setEnabled(true, [profileId]);

    expect(journal.pendingCount(other)).toBe(0);
  });

  it("empties the queue but keeps the baseline when it is switched off", () => {
    journal.setEnabled(true, [profileId]);
    journal.sweep(profileId, NOW);
    expect(stateRows()).toBe(1);

    journal.setEnabled(false);

    expect(journal.isEnabled()).toBe(false);
    expect(journal.pendingCount(profileId)).toBe(0);
    // The baseline survives, so a re-enable diffs against what was really last
    // sealed instead of restamping the user's whole database.
    expect(stateRows()).toBe(1);
  });

  it("forgets a profile completely when asked, queue and baseline together", () => {
    journal.setEnabled(true, [profileId]);
    journal.sweep(profileId, NOW);
    new TaskStore(db.raw, profileId).create({ title: "Posle" }, NOW);

    journal.forget(profileId);

    expect(journal.pendingCount(profileId)).toBe(0);
    expect(stateRows()).toBe(0);
  });
});

describe("the sweep", () => {
  beforeEach(() => {
    journal.setEnabled(true, [profileId]);
    journal.sweep(profileId, NOW);
  });

  it("turns a new row into a stamped state and drains the entry", () => {
    const task = new TaskStore(db.raw, profileId).create({ title: "Prijava" }, LATER);
    expect(journal.pendingCount(profileId)).toBe(1);

    const swept = journal.sweep(profileId, LATER);

    expect(swept).toHaveLength(1);
    expect(swept[0]?.collection).toBe("tasks");
    expect(swept[0]?.objectId).toBe(task.id);
    expect(rowFields(swept[0]!.state)["title"]).toBe("Prijava");
    expect(swept[0]!.state.deleted.value).toBe(false);
    // Never on the wire: the profile is decided by the key that opened the row,
    // and the two timestamps are shadows of the merge and the tombstone.
    const fields = rowFields(swept[0]!.state);
    expect(Object.keys(fields)).not.toContain("profile_id");
    expect(Object.keys(fields)).not.toContain("updated_at");
    expect(Object.keys(fields)).not.toContain("deleted_at");
    expect(journal.pendingCount(profileId)).toBe(0);
  });

  it("says nothing the second time, and nothing at all for a write that changed nothing", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Prijava" }, LATER);
    journal.sweep(profileId, LATER);

    // A write with the same values: the trigger fires, the diff finds nothing.
    tasks.update(task.id, { title: "Prijava" });
    expect(journal.pendingCount(profileId)).toBe(1);
    expect(journal.sweep(profileId, LATEST)).toEqual([]);
    expect(journal.pendingCount(profileId)).toBe(0);
  });

  it("stamps only the field that moved", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Prijava" }, LATER);
    const first = journal.sweep(profileId, LATER)[0]!.state;

    tasks.update(task.id, { title: "Prijava ispita" });
    const second = journal.sweep(profileId, LATEST)[0]!.state;

    expect(second.fields["title"]?.at).not.toEqual(first.fields["title"]?.at);
    expect(second.fields["status"]?.at).toEqual(first.fields["status"]?.at);
  });

  it("carries a soft delete as a tombstone, which is the only way tasks are deleted", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Za brisanje" }, LATER);
    journal.sweep(profileId, LATER);

    tasks.softDelete(task.id, LATEST);
    const swept = journal.sweep(profileId, LATEST);

    expect(swept).toHaveLength(1);
    expect(swept[0]!.state.deleted.value).toBe(true);
    expect(rowFields(swept[0]!.state)["title"]).toBe("Za brisanje");
  });

  it("gives a per-profile singleton the empty object id and reads it back", () => {
    db.raw
      .prepare("INSERT INTO calendar_settings (profile_id, semester_start) VALUES (?, ?)")
      .run(profileId, "2026-10-01");

    const swept = journal.sweep(profileId, LATER);

    expect(swept).toHaveLength(1);
    expect(swept[0]?.objectId).toBe("");
    expect(rowFields(swept[0]!.state)["semester_start"]).toBe("2026-10-01");
  });

  it("reads a composite natural key back out of its object id, and encodes the blob", () => {
    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(LATER);
    notes.appendUpdate(note.id, new Uint8Array([1, 2, 3]), "Beleska", LATER);

    const swept = journal.sweep(profileId, LATER);
    const update = swept.find((each) => each.collection === "note_updates");

    expect(update?.objectId).toBe(`${note.id}${US}1`);
    // A BLOB is not a JSON value; base64url is how it becomes one, and the apply
    // side reverses it from the same column type.
    expect(rowFields(update!.state)["update_blob"]).toBe("AQID");
  });

  it("keeps its clock, so two sweeps never stamp the same moment twice", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const one = tasks.create({ title: "Jedan" }, LATER);
    const first = journal.sweep(profileId, LATER)[0]!.state.fields["title"]!.at;

    tasks.create({ title: "Dva" }, LATER);
    const second = journal.sweep(profileId, LATER)[0]!.state.fields["title"]!.at;

    expect(compareHlc(second, first)).toBe(1);
    expect(one.id).not.toBe("");

    // And it survives a reopen, because a counter that restarts lets two devices
    // mint the same stamp after a crash.
    const stored = parseHlc(meta("sync_hlc") ?? "") as Hlc;
    expect(compareHlc(stored, second)).toBe(0);
    expect(stored.nodeId).toBe(meta("sync_node_id"));
  });

  it("drops an entry for a collection this build no longer carries", () => {
    db.raw
      .prepare(
        "INSERT INTO sync_journal (profile_id, collection, object_id) VALUES (?, 'ghost_table', 'x')",
      )
      .run(profileId);

    expect(journal.sweep(profileId, LATER)).toEqual([]);
    expect(journal.pendingCount(profileId)).toBe(0);
  });

  it("resolves at most `limit` entries in one pass, so a big enqueue is drained in batches", () => {
    const tasks = new TaskStore(db.raw, profileId);
    for (let index = 0; index < 5; index += 1) tasks.create({ title: `T${String(index)}` }, LATER);

    expect(journal.sweep(profileId, LATER, 2)).toHaveLength(2);
    expect(journal.pendingCount(profileId)).toBe(3);
  });
});
