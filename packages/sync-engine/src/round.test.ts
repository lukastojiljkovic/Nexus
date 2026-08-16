import { beforeEach, describe, expect, it } from "vitest";
import {
  applyEdit,
  decodeRowState,
  emptyRowState,
  hlcSend,
  hlcZero,
  openRowFields,
  rowFields,
} from "@nexus/sync-crypto";
import type { Hlc, RowState } from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { collections, planPush } from "@nexus/sync";
import type { PushAccepted, PushRow, SyncScope } from "@nexus/sync";
import { byteaToBase64url } from "@nexus/sync-transport";
import { fakeServer, type FakeServer } from "./testing.js";
import { syncOnce } from "./round.js";
import type {
  ApplyOutcome,
  ApplyRequest,
  OwedObject,
  QuarantinedObject,
  SyncDeps,
  SyncStore,
} from "./index.js";

const port = createFakeCryptoPort({ seed: 11 });
const SCOPE: SyncScope = { userId: "user-1", profileId: "profile-a" };
const CONTENT_KEY = new Uint8Array(32).fill(0x21);
const OTHER_KEY = new Uint8Array(32).fill(0x77);
const EPOCH = 3;

const T0 = 1_800_000_000_000;
const EARLY: Hlc = hlcSend(hlcZero("device-a"), T0);
const LATE: Hlc = hlcSend(hlcZero("device-b"), T0 + 60_000);
const NOW = "2026-08-16T12:00:00.000Z";

/** A state this device holds, at the version the server last accepted. */
function state(fields: Record<string, string>, version = 0, at: Hlc = EARLY): RowState {
  return { ...applyEdit(emptyRowState(at), fields, at), version };
}

// ─── The local store, in memory ─────────────────────────────────────────────

interface Fake extends SyncStore {
  sweeps: number;
  readonly states: Map<string, RowState>;
  readonly outbox: Map<string, { attempts: number; code: string | null }>;
  readonly cursors: Map<string, number>;
  readonly quarantined: QuarantinedObject[];
  readonly applied: ApplyRequest[];
  /** Object ids whose write-back comes back `refused` / `stale`. */
  readonly refuse: Set<string>;
  readonly stale: Set<string>;
  queue(collection: string, objectId: string, row: RowState): void;
}

function fakeStore(): Fake {
  const id = (collection: string, objectId: string): string => `${collection}/${objectId}`;
  const states = new Map<string, RowState>();
  const outbox = new Map<string, { attempts: number; code: string | null }>();
  const cursors = new Map<string, number>();
  const quarantined: QuarantinedObject[] = [];
  const applied: ApplyRequest[] = [];
  const refuse = new Set<string>();
  const stale = new Set<string>();

  return {
    sweeps: 0,
    states,
    outbox,
    cursors,
    quarantined,
    applied,
    refuse,
    stale,

    queue(collection, objectId, row) {
      states.set(id(collection, objectId), row);
      outbox.set(id(collection, objectId), { attempts: 0, code: null });
    },

    sweep() {
      this.sweeps += 1;
    },

    owedCount: () => outbox.size,

    owed(limit) {
      const out: OwedObject[] = [];
      const entries = [...outbox.entries()].sort((a, b) => a[1].attempts - b[1].attempts);
      for (const [key, entry] of entries) {
        // The state comes from the shadow map, never from the queue entry —
        // exactly as `sync_outbox` joins `sync_row_state`, which is what makes a
        // pull's merge the thing the next push sends.
        const row = states.get(key);
        if (row === undefined) continue;
        const slash = key.indexOf("/");
        out.push({
          collection: key.slice(0, slash),
          objectId: key.slice(slash + 1),
          state: row,
          attempts: entry.attempts,
        });
        if (out.length === limit) break;
      }
      return out;
    },

    confirmPushed(collection, objectId, next) {
      states.set(id(collection, objectId), next);
      outbox.delete(id(collection, objectId));
    },

    recordPushFailure(collection, objectId, code) {
      const entry = outbox.get(id(collection, objectId));
      if (entry !== undefined) outbox.set(id(collection, objectId), { attempts: entry.attempts + 1, code });
    },

    readState(collection, objectId) {
      return states.get(id(collection, objectId)) ?? null;
    },

    apply(requests) {
      const outcomes: ApplyOutcome[] = [];
      for (const request of requests) {
        applied.push(request);
        const key = id(request.collection, request.objectId);
        if (stale.has(request.objectId)) {
          outcomes.push({ ...named(request), status: "stale" });
          continue;
        }
        if (refuse.has(request.objectId)) {
          outcomes.push({ ...named(request), status: "refused" });
          continue;
        }
        states.set(key, request.merged);
        if (request.owed && !outbox.has(key)) outbox.set(key, { attempts: 0, code: null });
        outcomes.push({ ...named(request), status: request.changed ? "written" : "state-only" });
      }
      return outcomes;
    },

    cursor(collection) {
      return cursors.get(collection) ?? 0;
    },

    advance(collection, seq) {
      cursors.set(collection, Math.max(cursors.get(collection) ?? 0, seq));
    },

    quarantine(rows) {
      quarantined.push(...rows);
    },
  };
}

const named = (request: ApplyRequest): { collection: string; objectId: string } => ({
  collection: request.collection,
  objectId: request.objectId,
});

// ─── The round under test ───────────────────────────────────────────────────

let store: Fake;
let server: FakeServer;

function deps(): SyncDeps {
  return {
    crypto: port,
    http: server.port,
    store,
    scope: SCOPE,
    contentKey: CONTENT_KEY,
    ckEpoch: EPOCH,
    keyFor: (epoch) => (epoch === EPOCH ? CONTENT_KEY : null),
    now: () => NOW,
  };
}

/** A round over one collection, so a test's request count is about the test. */
const round = (names: readonly string[] = ["tasks"]) =>
  syncOnce(deps(), { collections: names, pushBatch: 100 });

/** A row as a peer would have left it on the server. */
async function peerRow(
  objectId: string,
  fields: Record<string, string>,
  options: { at?: Hlc; version?: number; key?: Uint8Array; epoch?: number } = {},
): Promise<PushRow> {
  const observed = (options.version ?? 1) - 1;
  const [outcome] = await planPush(
    port,
    SCOPE,
    options.key ?? CONTENT_KEY,
    options.epoch ?? EPOCH,
    [
      {
        collection: "tasks",
        objectId,
        parentId: null,
        state: state(fields, observed, options.at ?? EARLY),
      },
    ],
  );
  return (outcome as PushAccepted).row;
}

/** What the server is actually holding for one object, opened. */
async function onServer(objectId: string): Promise<Record<string, unknown>> {
  const row = server.rows().find((each) => each.object_id === objectId);
  if (row === undefined) throw new Error(`no server row for ${objectId}`);
  const plaintext = await openRowFields(
    port,
    CONTENT_KEY,
    {
      userId: SCOPE.userId,
      profileId: SCOPE.profileId,
      collection: row.collection,
      objectId: row.object_id,
      version: row.version,
      deleted: row.deleted,
      parentId: row.parent_id,
      ckEpoch: row.ck_epoch,
    },
    {
      v: 2,
      nonce: byteaToBase64url(row.nonce)!,
      ciphertext: byteaToBase64url(row.ciphertext)!,
    },
  );
  return rowFields(decodeRowState(plaintext, { version: row.version, deleted: row.deleted })!);
}

beforeEach(() => {
  store = fakeStore();
  server = fakeServer();
});

describe("the order a round runs in", () => {
  it("sweeps before it asks the server anything", async () => {
    await round();

    expect(store.sweeps).toBe(1);
    expect(server.requests[0]?.method).toBe("GET");
  });

  it("pulls before it pushes, so what it sends is what the merge produced", async () => {
    // The server holds a title this device has never seen; this device holds a
    // note the server has never seen, and owes it. One round must produce one
    // row carrying both — not a stale push, an NX001, and a second round.
    server.place(await peerRow("task-1", { title: "Sa servera" }, { at: LATE }));
    store.queue("tasks", "task-1", state({ note: "lokalno" }, 1, EARLY));

    const report = await round();

    expect(report.pulled).toBe(1);
    expect(report.pushed).toBe(1);
    expect(report.conflicts).toBe(0);
    expect(await onServer("task-1")).toEqual({ title: "Sa servera", note: "lokalno" });
    expect(store.outbox.size).toBe(0);
  });

  it("walks every collection in the map when it is given no hint", async () => {
    await syncOnce(deps());

    const asked = server.requests.filter((request) => request.method === "GET");
    expect(asked).toHaveLength(collections().length);
  });
});

describe("the pull walk", () => {
  it("starts behind the stored cursor, by the overlap the transport sets", async () => {
    store.advance("tasks", 100);

    await round();

    expect(server.requests[0]?.path).toContain("seq=gt.36");
  });

  it("keeps asking until a page comes back empty", async () => {
    server.place(await peerRow("task-1", { title: "A" }));
    server.place(await peerRow("task-2", { title: "B" }));

    const report = await round();

    expect(report.pulled).toBe(2);
    // Two rows in one page, then the empty page that ends the walk.
    expect(server.requests.filter((request) => request.method === "GET")).toHaveLength(2);
    expect(store.cursor("tasks")).toBe(2);
  });

  it("writes what it read into the local store, merged", async () => {
    server.place(await peerRow("task-1", { title: "Sa servera" }));

    const report = await round();

    expect(report.applied).toBe(1);
    expect(rowFields(store.readState("tasks", "task-1")!)["title"]).toBe("Sa servera");
  });

  it("THE DEADLOCK: holds the cursor at a refused row but keeps walking past it", async () => {
    // A child that arrived before its parent is refused by a foreign key, and
    // its parent is very often further down the same log. Holding the WALK back
    // as well would mean the parent is in a page nobody fetches — the child
    // refused for ever, on a log that already contains its cure.
    server.place(await peerRow("task-1", { title: "A" }));
    server.place(await peerRow("task-2", { title: "B" }));
    server.place(await peerRow("task-3", { title: "C" }));
    store.refuse.add("task-2");

    const report = await round();

    expect(report.pulled).toBe(3);
    expect(report.applied).toBe(2);
    // The cursor stops before the refusal, so the next round is served it again.
    expect(store.cursor("tasks")).toBe(1);
    // And the walk did not: the third row reached the store all the same.
    expect(store.applied.map((request) => request.objectId)).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
    expect(store.readState("tasks", "task-3")).not.toBeNull();
  });

  it("does not let the cursor recover later in the same walk", async () => {
    for (const id of ["task-1", "task-2", "task-3"]) {
      server.place(await peerRow(id, { title: id }));
    }
    store.refuse.add("task-1");

    await round();

    // Every later row applied cleanly, and the cursor still may not pass the
    // first one: „the last consecutive success" is the rule, not „the last one".
    expect(store.cursor("tasks")).toBe(0);
  });

  it("keeps the cursor held across the pages that come after the refusal", async () => {
    // One row per page, which is what `max_rows` does to a client that asked for
    // five hundred — it truncates and says nothing, so a page is „done" only when
    // it is EMPTY. Three pages apply cleanly after the held one, and the cursor
    // may not take any of them: the hold is a property of the walk, not of a page.
    for (const id of ["task-1", "task-2", "task-3"]) {
      server.place(await peerRow(id, { title: id }));
    }
    server.pageCap(1);
    store.refuse.add("task-1");

    const report = await round();

    expect(report.pulled).toBe(3);
    expect(server.requests.filter((request) => request.method === "GET")).toHaveLength(4);
    expect(store.cursor("tasks")).toBe(0);
  });

  it("files a row it could not open, and moves past it", async () => {
    server.place(await peerRow("task-1", { title: "A" }));
    server.place(await peerRow("task-2", { title: "B" }));
    server.corrupt("tasks", "task-1");

    const report = await round();

    expect(report.quarantined).toBe(1);
    expect(store.quarantined).toEqual([
      { collection: "tasks", objectId: "task-1", seq: 1, reason: "aead-failed", seenAt: NOW },
    ]);
    // An unreadable row is damage, not a rotation in progress: the cursor passes
    // it rather than stalling the whole collection behind it.
    expect(store.cursor("tasks")).toBe(2);
  });

  it("stops on a row whose key is missing, without filing it as damage", async () => {
    server.place(await peerRow("task-1", { title: "A" }, { key: OTHER_KEY, epoch: 9 }));
    server.place(await peerRow("task-2", { title: "B" }));

    const report = await round();

    expect(report.quarantined).toBe(0);
    expect(store.quarantined).toEqual([]);
    // A key that has not been unwrapped yet is worth waiting for, so the cursor
    // holds — and the walk ends rather than asking for the same page for ever.
    expect(store.cursor("tasks")).toBe(0);
    expect(server.requests.filter((request) => request.method === "GET")).toHaveLength(1);
  });
});

describe("the push drain", () => {
  it("sends what is owed and stops owing it", async () => {
    store.queue("tasks", "task-1", state({ title: "Prijava" }));

    const report = await round();

    expect(report.pushed).toBe(1);
    expect(report.owed).toBe(0);
    expect(await onServer("task-1")).toEqual({ title: "Prijava" });
    expect(store.states.get("tasks/task-1")?.version).toBe(1);
  });

  it("takes more than one batch when the queue is longer than one", async () => {
    for (const id of ["task-1", "task-2", "task-3"]) {
      store.queue("tasks", id, state({ title: id }));
    }

    const report = await syncOnce(deps(), { collections: ["tasks"], pushBatch: 2 });

    expect(report.pushed).toBe(3);
    expect(server.rows()).toHaveLength(3);
  });

  it("keeps a refused object owed, with the server's code, and does not retry it", async () => {
    store.queue("tasks", "task-1", state({ title: "A" }));
    store.queue("tasks", "task-2", state({ title: "B" }));
    server.refuseWrites(1, 400, JSON.stringify({ code: "23514", message: "check", details: null }));

    const report = await round();

    expect(report.pushed).toBe(1);
    expect(report.owed).toBe(1);
    expect([...store.outbox.values()]).toEqual([{ attempts: 1, code: "rejected" }]);
    // Two writes, not three: the round attempts an object once, so one refusal
    // cannot inflate its `attempts` and look like two independent failures.
    expect(server.requests.filter((request) => request.method !== "GET")).toHaveLength(2);
  });

  it("counts a version the server has already moved past as a conflict", async () => {
    // The server is at version 2; this device thinks it is at 1 and plans 2.
    server.place(await peerRow("task-1", { title: "Sa servera" }, { version: 2 }));
    store.queue("tasks", "task-1", state({ title: "Lokalno" }, 1));
    // Nothing is pulled, so the stale picture survives into the push.
    store.stale.add("task-1");

    const report = await round();

    expect(report.conflicts).toBe(1);
    expect(report.pushed).toBe(0);
    expect([...store.outbox.values()]).toEqual([{ attempts: 1, code: "conflict" }]);
  });
});

describe("what ends a round early", () => {
  it("stops on a dead session, and does not go on to push", async () => {
    store.queue("tasks", "task-1", state({ title: "A" }));
    // A revoked session refuses everything, so the port does too — the fake
    // server is not consulted at all, which is the point being asserted.
    const failing: SyncDeps = {
      ...deps(),
      http: async () => ({ status: 401, body: JSON.stringify({ message: "JWT expired" }) }),
    };

    const report = await syncOnce(failing, { collections: ["tasks"] });

    expect(report.halted).toBe("forbidden");
    expect(report.pushed).toBe(0);
    expect(report.owed).toBe(1);
  });

  it("still pushes when the pull failed for a reason a write does not share", async () => {
    store.queue("tasks", "task-1", state({ title: "A" }));
    let first = true;
    const flaky: SyncDeps = {
      ...deps(),
      http: async (request) => {
        // A page of something that is not a row of `sync_objects`. The write
        // that follows goes to the real fake server, because „the log served
        // nonsense" says nothing about whether a PATCH would be taken.
        if (request.method === "GET" && first) {
          first = false;
          return { status: 200, body: JSON.stringify([{ nope: 1 }]) };
        }
        return server.port(request);
      },
    };

    const report = await syncOnce(flaky, { collections: ["tasks"] });

    expect(report.halted).toBe("malformed");
    expect(report.pushed).toBe(1);
  });

  it("stops everything on a nonce the key has already used", async () => {
    store.queue("tasks", "task-1", state({ title: "A" }));
    store.queue("tasks", "task-2", state({ title: "B" }));
    server.refuseWrites(1, 409, JSON.stringify({ code: "NX005", message: "nonce reuse" }));

    const report = await syncOnce(deps(), { collections: ["tasks"], pushBatch: 2 });

    expect(report.halted).toBe("nonce-reuse");
    // The batch stopped at the alarm rather than sending the second row from the
    // same generator.
    expect(server.rows()).toHaveLength(0);
  });
});
