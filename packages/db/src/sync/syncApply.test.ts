import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdit, hlcSend, hlcZero, type RowState } from "@nexus/sync-crypto";
import {
  NoteStore,
  SyncJournal,
  TaskListStore,
  TaskStore,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { ApplyRequest, NexusDatabase, SweptObject } from "../index.js";

/**
 * The apply, as a round trip between two real databases.
 *
 * Every test here sweeps on one device and applies on another — separate files,
 * separate stores, the same profile id (which is what the AAD binds, so it is
 * the same on every device of an account). Asserting the columns one by one
 * would prove the writer does what the writer's author expected; making the
 * second device's row come out of the first device's row proves the sweep and
 * the apply are inverses, which is the property the engine actually rests on and
 * the only one a peer can break.
 */

const NOW = "2026-08-16T10:00:00.000Z";
const LATER = "2026-08-16T10:05:00.000Z";
const LATEST = "2026-08-16T10:10:00.000Z";
const US = String.fromCharCode(31);

interface Device {
  readonly db: NexusDatabase;
  readonly journal: SyncJournal;
  readonly dir: string;
}

let alice: Device;
let bob: Device;
let profileId: string;

function open(label: string, seed: boolean): Device {
  const dir = mkdtempSync(join(tmpdir(), `nexus-apply-${label}-`));
  const db = openDatabase({ path: join(dir, "apply.db") });
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  // Only the first device seeds content. The second one receives it, which is
  // both what a real first pull is and the only way the two end up agreeing
  // about the Inbox's id — two `ensureInbox` calls mint two different lists, and
  // a task pointing at one of them cannot be written on the other.
  if (seed) new TaskListStore(db.raw, profileId).ensureInbox(NOW);
  const journal = new SyncJournal(db.raw);
  journal.setEnabled(true, [profileId]);
  return { db, journal, dir };
}

/** Everything one device has to say, as the other device's apply wants it. */
function toApply(swept: readonly SweptObject[]): ApplyRequest[] {
  return swept.map((object) => ({ ...object, merged: object.state, changed: true }));
}

/** One device's whole outbound batch, applied to the other. */
function handOver(from: Device, to: Device, at = LATER): ReturnType<SyncJournal["apply"]> {
  return to.journal.apply(profileId, toApply(from.journal.sweep(profileId, at)), at);
}

type Row = Record<string, unknown> | undefined;

function row(device: Device, sql: string, ...params: unknown[]): Row {
  return device.db.raw.prepare(sql).get(...params) as Row;
}

beforeEach(() => {
  profileId = uuidv7();
  alice = open("a", true);
  bob = open("b", false);
  // Bob's baseline arrives the way it would in life: Alice's Inbox, swept and
  // applied. After it both devices agree about every id, and the tests below are
  // about what happens NEXT rather than about what was already in the file.
  handOver(alice, bob, NOW);
});

afterEach(() => {
  for (const device of [alice, bob]) {
    device.db.close();
    rmSync(device.dir, { recursive: true, force: true });
  }
});

describe("the round trip", () => {
  it("puts Alice's task on Bob's device, field for field", () => {
    const task = new TaskStore(alice.db.raw, profileId).create(
      { title: "Prijava ispita", priority: "high" },
      LATER,
    );

    const outcomes = handOver(alice, bob);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["written"]);
    const applied = row(bob, "SELECT * FROM tasks WHERE id = ?", task.id);
    expect(applied).toMatchObject({
      id: task.id,
      profile_id: profileId,
      title: "Prijava ispita",
      priority: "high",
      status: "todo",
      list_id: task.listId,
      deleted_at: null,
    });
    // `updated_at` is derived from the newest field stamp rather than copied, so
    // it is a real column with a real value and not the string „now".
    expect(typeof applied?.["updated_at"]).toBe("string");
  });

  it("does not echo: applying leaves Bob with nothing to push back", () => {
    // The defect this prevents runs forever and on both devices — Bob's apply
    // dirties his journal, his sweep resolves it, he pushes it to Alice, whose
    // apply dirties hers. Nothing in either device looks wrong on its own.
    new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);

    handOver(alice, bob);

    expect(bob.journal.pendingCount(profileId)).toBe(0);
    // And the flag the triggers read is back up, or the NEXT local edit is the
    // one that goes missing.
    expect(bob.journal.isEnabled()).toBe(true);
  });

  it("survives a reopen, which is what proves the write was committed", () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Trajno" }, LATER);
    handOver(alice, bob);

    const path = join(bob.dir, "apply.db");
    bob.db.close();
    const reopened = openDatabase({ path });
    try {
      const found = reopened.raw.prepare("SELECT title FROM tasks WHERE id = ?").get(task.id);
      expect(found).toEqual({ title: "Trajno" });
    } finally {
      reopened.close();
    }
    bob = { ...bob, db: openDatabase({ path }) };
  });

  it("is idempotent — the same batch twice is the same row", () => {
    new TaskStore(alice.db.raw, profileId).create({ title: "Dvaput" }, LATER);
    const batch = toApply(alice.journal.sweep(profileId, LATER));

    bob.journal.apply(profileId, batch, LATER);
    const first = row(bob, "SELECT * FROM tasks WHERE title = 'Dvaput'");
    bob.journal.apply(profileId, batch, LATEST);

    expect(row(bob, "SELECT * FROM tasks WHERE title = 'Dvaput'")).toEqual(first);
    expect(bob.journal.pendingCount(profileId)).toBe(0);
  });

  it("carries an edit made later, and only the column that moved", () => {
    const tasks = new TaskStore(alice.db.raw, profileId);
    const task = tasks.create({ title: "Prvo ime", priority: "low" }, LATER);
    handOver(alice, bob);

    tasks.update(task.id, { title: "Drugo ime" });
    handOver(alice, bob, LATEST);

    expect(row(bob, "SELECT title, priority FROM tasks WHERE id = ?", task.id)).toEqual({
      title: "Drugo ime",
      priority: "low",
    });
  });

  it("carries a soft delete as the tombstone column, not as a missing row", () => {
    const tasks = new TaskStore(alice.db.raw, profileId);
    const task = tasks.create({ title: "Za brisanje" }, LATER);
    handOver(alice, bob);

    tasks.softDelete(task.id, LATEST);
    handOver(alice, bob, LATEST);

    const applied = row(bob, "SELECT title, deleted_at FROM tasks WHERE id = ?", task.id);
    // The row survives with its content: a device that later restores it brings
    // back what the user actually typed, not an empty shell.
    expect(applied?.["title"]).toBe("Za brisanje");
    expect(typeof applied?.["deleted_at"]).toBe("string");
  });
});

describe("the shapes that are not one row with one id", () => {
  it("applies a per-profile singleton, whose object id is the empty string", () => {
    alice.db.raw
      .prepare("INSERT INTO calendar_settings (profile_id, semester_start) VALUES (?, ?)")
      .run(profileId, "2026-10-01");

    handOver(alice, bob);

    expect(row(bob, "SELECT * FROM calendar_settings")).toMatchObject({
      profile_id: profileId,
      semester_start: "2026-10-01",
    });
  });

  it("updates that singleton in place rather than trying to insert a second one", () => {
    // `profile_id` IS the primary key here, so it is also the UPSERT's conflict
    // target — the one collection shape where the identity list is empty.
    alice.db.raw
      .prepare("INSERT INTO calendar_settings (profile_id, semester_start) VALUES (?, ?)")
      .run(profileId, "2026-10-01");
    handOver(alice, bob);

    alice.db.raw
      .prepare("UPDATE calendar_settings SET semester_end = ? WHERE profile_id = ?")
      .run("2027-01-31", profileId);
    handOver(alice, bob, LATEST);

    expect(row(bob, "SELECT count(*) AS n FROM calendar_settings")).toEqual({ n: 1 });
    expect(row(bob, "SELECT semester_end FROM calendar_settings")).toEqual({
      semester_end: "2027-01-31",
    });
  });

  it("rebuilds a composite natural key, and turns base64url back into bytes", () => {
    const notes = new NoteStore(alice.db.raw, profileId);
    const note = notes.create(LATER);
    notes.appendUpdate(note.id, new Uint8Array([1, 2, 3]), "Beleska", LATER);

    const swept = alice.journal.sweep(profileId, LATER);
    // Parent first: `note_updates` has a foreign key to `notes`, and the pull
    // walks its log in order for exactly this reason.
    const ordered = [
      ...swept.filter((each) => each.collection === "notes"),
      ...swept.filter((each) => each.collection !== "notes"),
    ];
    const outcomes = bob.journal.apply(profileId, toApply(ordered), LATER);

    expect(outcomes.every((outcome) => outcome.status === "written")).toBe(true);
    const update = row(
      bob,
      "SELECT note_id, seq, update_blob FROM note_updates WHERE note_id = ?",
      note.id,
    );
    expect(update?.["seq"]).toBe(1);
    // A BLOB column, so the base64url the sweep produced has to come back as
    // bytes — writing the string would corrupt every note on the device.
    expect(update?.["update_blob"]).toBeInstanceOf(Uint8Array);
    expect([...(update?.["update_blob"] as Uint8Array)]).toEqual([1, 2, 3]);
    expect(swept.find((each) => each.collection === "note_updates")?.objectId).toBe(
      `${note.id}${US}1`,
    );
  });
});

describe("what it refuses, and what it does afterwards", () => {
  it("refuses an object whose local edit has not been swept, and keeps that edit", () => {
    // The merge Alice's row was folded into was computed against Bob's LAST
    // SWEPT state. If Bob has edited since and not swept, that baseline is stale
    // and writing the merge would erase his edit on the device that made it,
    // with no conflict recorded anywhere.
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Alisin" }, LATER);
    handOver(alice, bob);

    new TaskStore(alice.db.raw, profileId).update(task.id, { title: "Alisin, izmenjen" });
    const batch = toApply(alice.journal.sweep(profileId, LATEST));
    // Bob types into the same task before the batch lands.
    new TaskStore(bob.db.raw, profileId).update(task.id, { title: "Bobov naslov" });

    const outcomes = bob.journal.apply(profileId, batch, LATEST);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["stale"]);
    expect(row(bob, "SELECT title FROM tasks WHERE id = ?", task.id)).toEqual({
      title: "Bobov naslov",
    });
    // And it is still queued, so the sweep that follows will find it.
    expect(bob.journal.pendingCount(profileId)).toBe(1);
  });

  it("reports a collection this build no longer carries, and writes nothing", () => {
    const outcomes = bob.journal.apply(
      profileId,
      [{ collection: "ghost_table", objectId: "x", merged: emptyState(), changed: true }],
      LATER,
    );

    expect(outcomes).toEqual([{ collection: "ghost_table", objectId: "x", status: "unknown" }]);
    expect(bob.journal.readState(profileId, "ghost_table", "x")).toBeNull();
  });

  /**
   * A task in a list Bob has not received yet — the batch minus its own parent.
   * That is what a cursor walk interrupted between two rows looks like, and it
   * is reachable without corrupting anything on Alice's side: her own foreign
   * keys are enforced too, so „point a task at a list that does not exist" is
   * not a state either device can be put into directly.
   */
  function orphanBatch(): { orphan: string; sibling: string; batch: ApplyRequest[] } {
    const lists = new TaskListStore(alice.db.raw, profileId);
    const tasks = new TaskStore(alice.db.raw, profileId);
    const list = lists.createList({ name: "Fakultet" }, LATER);
    const orphan = tasks.create({ title: "Bez liste", listId: list.id }, LATER);
    const sibling = tasks.create({ title: "Sa listom" }, LATER);

    const swept = alice.journal.sweep(profileId, LATER);
    return {
      orphan: orphan.id,
      sibling: sibling.id,
      batch: toApply(swept.filter((each) => each.objectId !== list.id)),
    };
  }

  it("reports a row SQLite refused and still applies the rest of the batch", () => {
    const { orphan, sibling, batch } = orphanBatch();

    const outcomes = bob.journal.apply(profileId, batch, LATER);

    const refused = outcomes.find((outcome) => outcome.objectId === orphan);
    expect(refused?.status).toBe("refused");
    expect(refused?.error ?? "").toMatch(/FOREIGN KEY/i);
    // One object rolled back, and only that one: forty rows must not be undone
    // by a parent that is one page further down the same cursor.
    expect(row(bob, "SELECT title FROM tasks WHERE id = ?", sibling)).toEqual({
      title: "Sa listom",
    });
    // And no shadow state was left claiming the refused row had been merged —
    // which would make the next pull skip it forever.
    expect(bob.journal.readState(profileId, "tasks", orphan)).toBeNull();
    expect(bob.journal.readState(profileId, "tasks", sibling)).not.toBeNull();
  });

  it("puts the journal flag back even when an object in the batch is refused", () => {
    bob.journal.apply(profileId, orphanBatch().batch, LATER);

    expect(bob.journal.isEnabled()).toBe(true);
    // And the triggers really are armed again, not merely flagged: a flag that
    // says „on" over triggers nobody re-enabled loses the next local edit.
    new TaskStore(bob.db.raw, profileId).create({ title: "Posle" }, LATEST);
    expect(bob.journal.pendingCount(profileId)).toBe(1);
  });
});

describe("what `changed` decides", () => {
  it("moves only the shadow state when the local row already carries the merge", () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Isto" }, LATER);
    const swept = alice.journal.sweep(profileId, LATER);
    bob.journal.apply(profileId, toApply(swept), LATER);
    const before = row(bob, "SELECT * FROM tasks WHERE id = ?", task.id);

    // The version moved but the content did not — which is the ordinary case
    // after this device's own push comes back around, and the version is what
    // the next push's compare-and-swap is built on.
    const bumped = swept.map((object) => ({
      collection: object.collection,
      objectId: object.objectId,
      merged: { ...object.state, version: object.state.version + 3 },
      changed: false,
    }));
    const outcomes = bob.journal.apply(profileId, bumped, LATEST);

    expect(outcomes.every((outcome) => outcome.status === "state-only")).toBe(true);
    expect(row(bob, "SELECT * FROM tasks WHERE id = ?", task.id)).toEqual(before);
    expect(bob.journal.readState(profileId, "tasks", task.id)?.version).toBe(
      (swept.find((each) => each.objectId === task.id)?.state.version ?? 0) + 3,
    );
  });
});

describe("the coupled-CHECK repair, through the apply", () => {
  it("writes a legal card when the merge said basic and kept the cloze text", () => {
    // The one place the DC-14 repair has to actually fire. `deriveColumns` runs
    // it, so a merged state SQLite would refuse arrives here already legal —
    // and if it ever stops running it, this row cannot be written at all.
    const subject = uuidv7();
    const deck = uuidv7();
    for (const device of [alice, bob]) {
      device.db.raw
        .prepare(
          `INSERT INTO subjects (id, profile_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(subject, profileId, "Baze", NOW, NOW);
      device.db.raw
        .prepare(
          `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(deck, profileId, subject, "Špil", NOW, NOW);
    }
    alice.db.raw
      .prepare(
        `INSERT INTO cards (id, profile_id, deck_id, kind, front, back, cloze_text, cloze_ordinal,
                            due, stability, difficulty, elapsed_days, scheduled_days,
                            learning_steps, reps, lapses, state, created_at, updated_at)
         VALUES (?, ?, ?, 'cloze', '', '', ?, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
      )
      .run(uuidv7(), profileId, deck, "Glavni grad je {{c1::Beograd}}", NOW, NOW, NOW);

    const swept = alice.journal
      .sweep(profileId, LATER)
      .filter((each) => each.collection === "cards");
    expect(swept).toHaveLength(1);

    // Bob's device merged a newer `kind` from a third device: basic, while the
    // cloze text is still the newer value. Legal per field, refused as a row.
    const conflicted: ApplyRequest = {
      collection: "cards",
      objectId: swept[0]!.objectId,
      merged: applyEdit(swept[0]!.state, { kind: "basic" }, hlcSend(hlcZero("c"), 9_000)),
      changed: true,
    };
    const outcomes = bob.journal.apply(profileId, [conflicted], LATER);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["written"]);
    expect(row(bob, "SELECT kind, cloze_text, cloze_ordinal FROM cards")).toEqual({
      kind: "basic",
      cloze_text: null,
      cloze_ordinal: null,
    });
    // Lossless: the state Bob stores still holds the text, so the day the user
    // switches the card back to cloze it is there.
    const stored = bob.journal.readState(profileId, "cards", swept[0]!.objectId);
    expect(stored?.fields["cloze_text"]?.value).toBe("Glavni grad je {{c1::Beograd}}");
  });
});

/** A state carrying nothing, for the paths that never get as far as reading it. */
function emptyState(): RowState {
  return { version: 1, fields: {}, deleted: { value: false, at: hlcZero("x") } };
}
