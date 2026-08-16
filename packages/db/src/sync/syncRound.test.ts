import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import type { SyncScope } from "@nexus/sync";
import { syncOnce } from "@nexus/sync-engine";
import type { SyncDeps } from "@nexus/sync-engine";
import { fakeServer } from "@nexus/sync-engine/testing";
import type { FakeServer } from "@nexus/sync-engine/testing";
import {
  SyncJournal,
  SyncProgressStore,
  TaskListStore,
  TaskStore,
  openDatabase,
  syncStoreFor,
  uuidv7,
} from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * The loop, end to end: two real databases and one server.
 *
 * Everything under it has been tested against a double of the thing next to it —
 * the journal against hand-made states, the round against a scripted store, the
 * wire against a running PostgREST. This is the first test in which a row a user
 * created on one machine arrives on another by the mechanism that will actually
 * carry it, and it is the only one that can catch the gaps BETWEEN those pieces:
 * a sweep that produces a state the planner refuses, a merge the apply cannot
 * write, a cursor that skips the row it just failed on.
 *
 * The two devices share a profile id — that is what the AAD binds, so it is the
 * same on every device of an account — and a content key, and nothing else.
 */

const port = createFakeCryptoPort({ seed: 5 });
const CONTENT_KEY = new Uint8Array(32).fill(0x44);
const EPOCH = 1;

const NOW = "2026-08-16T10:00:00.000Z";
const LATER = "2026-08-16T10:05:00.000Z";
const LATEST = "2026-08-16T10:10:00.000Z";

let profileId: string;
/**
 * The wall clock both devices read, advanced by a test between its phases.
 *
 * It is the HLC's physical component (`sweep` parses it), so an edit made after
 * another has to carry a later value or the merge falls through to the node-id
 * tie-break — which is a coin flip, and a test decided by one is a test about
 * nothing. Two real machines do not share an instant; two that did would be
 * asking last-write-wins a question it has no answer to.
 */
let at: string;
let server: FakeServer;

interface Device {
  readonly db: NexusDatabase;
  readonly deps: SyncDeps;
  readonly dir: string;
}

function open(label: string, seed: boolean): Device {
  const dir = mkdtempSync(join(tmpdir(), `nexus-round-${label}-`));
  const db = openDatabase({ path: join(dir, "round.db") });
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  // Only the first device seeds content: the second receives it, which is what a
  // first pull is, and the only way the two end up agreeing about the Inbox's id.
  if (seed) new TaskListStore(db.raw, profileId).ensureInbox(NOW);

  const journal = new SyncJournal(db.raw);
  journal.setEnabled(true, [profileId]);
  const scope: SyncScope = { userId: "user-1", profileId };
  return {
    db,
    dir,
    deps: {
      crypto: port,
      http: server.port,
      store: syncStoreFor(journal, new SyncProgressStore(db.raw), profileId),
      scope,
      contentKey: CONTENT_KEY,
      ckEpoch: EPOCH,
      keyFor: (epoch) => (epoch === EPOCH ? CONTENT_KEY : null),
      now: () => at,
    },
  };
}

let alice: Device;
let bob: Device;

/**
 * Rounds until nothing moves, so a test asserts convergence and not a step count.
 *
 * The failure carries every report it saw. „It did not settle" is true of a loop
 * that is stuck pushing, one that is stuck pulling and one that is doing nothing
 * at all, and a harness that cannot tell those apart answers „failed" to every
 * question asked of it.
 */
async function settle(...devices: Device[]): Promise<void> {
  const seen: string[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const device of devices) {
      const report = await syncOnce(device.deps);
      seen.push(JSON.stringify(report));
      expect(report.halted, seen.join("\n")).toBeNull();
      if (report.pushed > 0 || report.applied > 0) moved = true;
    }
    if (!moved) return;
  }
  throw new Error(`the round never settled:\n${seen.join("\n")}`);
}

const tasksOf = (device: Device): { id: string; title: string; status: string }[] =>
  device.db.raw
    .prepare(
      "SELECT id, title, status FROM tasks WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id",
    )
    .all(profileId) as { id: string; title: string; status: string }[];

beforeEach(() => {
  profileId = uuidv7();
  server = fakeServer();
  at = LATER;
  alice = open("a", true);
  bob = open("b", false);
});

afterEach(() => {
  for (const device of [alice, bob]) {
    device.db.close();
    rmSync(device.dir, { recursive: true, force: true });
  }
});

describe("a row crossing between two machines", () => {
  it("carries a task Alice created to Bob's database", async () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);

    await settle(alice, bob);

    expect(tasksOf(bob)).toEqual([{ id: task.id, title: "Prijava", status: "todo" }]);
  });

  it("leaves nothing owed once both have settled", async () => {
    new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);

    await settle(alice, bob);

    const last = await syncOnce(alice.deps);
    expect(last.owed).toBe(0);
    expect(last.pushed).toBe(0);
    expect(last.applied).toBe(0);
  });

  it("carries a deletion, not just a creation", async () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);
    await settle(alice, bob);
    expect(tasksOf(bob)).toHaveLength(1);

    at = LATEST;
    new TaskStore(alice.db.raw, profileId).softDelete(task.id, LATEST);
    await settle(alice, bob);

    expect(tasksOf(bob)).toEqual([]);
  });

  it("merges two devices' edits to different fields of the same object", async () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);
    await settle(alice, bob);

    at = LATEST;
    // Neither device has seen the other's edit when it makes its own.
    new TaskStore(alice.db.raw, profileId).update(task.id, { title: "Prijava na ispit" });
    new TaskStore(bob.db.raw, profileId).setDone(task.id, true, LATEST);

    await settle(alice, bob);

    // Field-level last-write-wins: two fields, two winners, one row.
    expect(tasksOf(alice)).toEqual([{ id: task.id, title: "Prijava na ispit", status: "done" }]);
    expect(tasksOf(bob)).toEqual(tasksOf(alice));
  });

  it("leaves the server holding one row per object, at the version both agree on", async () => {
    const task = new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);
    await settle(alice, bob);
    at = LATEST;
    new TaskStore(bob.db.raw, profileId).update(task.id, { title: "Izmenjeno" });
    await settle(alice, bob);

    const rows = server.rows().filter((row) => row.collection === "tasks");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.object_id).toBe(task.id);
    expect(tasksOf(alice)[0]?.title).toBe("Izmenjeno");
  });
});

describe("what the round remembers between rounds", () => {
  it("does not re-read a log it has already walked", async () => {
    new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);
    await settle(alice, bob);

    const before = server.requests.length;
    const report = await syncOnce(bob.deps);

    expect(report.applied).toBe(0);
    // One GET per collection and no second page anywhere: the stored cursor is
    // what makes a quiet round cost one request per collection rather than one
    // per row that has ever existed.
    expect(server.requests.length - before).toBe(
      server.requests.slice(before).filter((request) => request.method === "GET").length,
    );
  });

  it("keeps an object owed across a round that could not reach the server", async () => {
    new TaskStore(alice.db.raw, profileId).create({ title: "Prijava" }, LATER);
    server.refuseWrites(99, 503, JSON.stringify({ message: "service unavailable" }));

    const first = await syncOnce(alice.deps);
    expect(first.halted).toBe("offline");
    expect(first.owed).toBeGreaterThan(0);

    // The queue is a table, so the second round finds the work without the first
    // round having handed anything over — which is the whole point of it.
    server.refuseWrites(0, 200, "");
    await settle(alice, bob);
    expect(tasksOf(bob)).toHaveLength(1);
  });
});
