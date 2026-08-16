import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncProgressStore, openDatabase, uuidv7 } from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * What this device knows about its walk of the server's log: how far it has read
 * per collection, and which objects it read and could not open.
 *
 * The watermark's one rule is that it never goes backwards, and every test that
 * looks like it is about arithmetic is really about that: the pull deliberately
 * starts BEHIND the stored cursor (`pullWindow` subtracts the overlap), so a
 * caller storing what a page returned would walk the cursor back a little on
 * every sync and re-read a growing tail forever without ever being visibly
 * broken.
 */

const NOW = "2026-08-16T10:00:00.000Z";
const LATER = "2026-08-16T10:05:00.000Z";

let dir: string;
let db: NexusDatabase;
let progress: SyncProgressStore;
let profileId: string;
let otherId: string;

function seedProfile(id: string): void {
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-progress-"));
  db = openDatabase({ path: join(dir, "progress.db") });
  progress = new SyncProgressStore(db.raw);
  profileId = uuidv7();
  otherId = uuidv7();
  seedProfile(profileId);
  seedProfile(otherId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SyncProgressStore — the watermark", () => {
  it("answers 0 for a collection this device has never pulled", () => {
    expect(progress.cursor(profileId, "tasks")).toBe(0);
  });

  it("stores what it is given the first time", () => {
    expect(progress.advance(profileId, "tasks", 12)).toBe(12);
    expect(progress.cursor(profileId, "tasks")).toBe(12);
  });

  it("RAISES but never lowers — the overlap makes a lower number the normal case", () => {
    progress.advance(profileId, "tasks", 120);
    expect(progress.advance(profileId, "tasks", 56)).toBe(120);
    expect(progress.cursor(profileId, "tasks")).toBe(120);
  });

  it("holds still when a page blocked on its first row and returned fromSeq unchanged", () => {
    progress.advance(profileId, "tasks", 90);
    expect(progress.advance(profileId, "tasks", 90 - 64)).toBe(90);
  });

  it("keeps one watermark per collection, not one per profile", () => {
    progress.advance(profileId, "tasks", 12);
    progress.advance(profileId, "notes", 7);
    expect(progress.cursor(profileId, "tasks")).toBe(12);
    expect(progress.cursor(profileId, "notes")).toBe(7);
  });

  it("keeps one profile's walk out of another's", () => {
    progress.advance(profileId, "tasks", 12);
    progress.advance(otherId, "tasks", 900);
    expect(progress.cursor(profileId, "tasks")).toBe(12);
    expect(progress.cursor(otherId, "tasks")).toBe(900);
  });

  it("hands back every cursor at once, which is what a round needs to start", () => {
    progress.advance(profileId, "tasks", 12);
    progress.advance(profileId, "notes", 7);
    progress.advance(otherId, "tasks", 900);
    expect([...progress.cursors(profileId)].sort()).toEqual([
      ["notes", 7],
      ["tasks", 12],
    ]);
  });

  it("refuses a watermark that is not a whole non-negative number", () => {
    expect(() => progress.advance(profileId, "tasks", -1)).toThrow(TypeError);
    expect(() => progress.advance(profileId, "tasks", 1.5)).toThrow(TypeError);
    expect(() => progress.advance(profileId, "tasks", Number.NaN)).toThrow(TypeError);
  });
});

describe("SyncProgressStore — quarantine", () => {
  const rows = [
    { collection: "tasks", objectId: "o1", seq: 9, reason: "aead-failed", seenAt: NOW },
    { collection: "notes", objectId: "o2", seq: 11, reason: "bad-plaintext", seenAt: NOW },
  ] as const;

  it("records what the cursor moved past, so a restart still knows what is missing", () => {
    progress.quarantine(profileId, rows);
    expect(progress.quarantined(profileId)).toEqual([
      { collection: "notes", objectId: "o2", seq: 11, reason: "bad-plaintext", seenAt: NOW },
      { collection: "tasks", objectId: "o1", seq: 9, reason: "aead-failed", seenAt: NOW },
    ]);
  });

  it("writes nothing and asks nothing of the database for an empty batch", () => {
    progress.quarantine(profileId, []);
    expect(progress.quarantined(profileId)).toEqual([]);
  });

  it("keeps ONE row per object — a second failure updates rather than accumulates", () => {
    progress.quarantine(profileId, [rows[0]]);
    progress.quarantine(profileId, [
      { collection: "tasks", objectId: "o1", seq: 40, reason: "bad-plaintext", seenAt: LATER },
    ]);
    expect(progress.quarantined(profileId)).toEqual([
      { collection: "tasks", objectId: "o1", seq: 40, reason: "bad-plaintext", seenAt: LATER },
    ]);
  });

  it("releases one object when it has finally been read", () => {
    progress.quarantine(profileId, rows);
    progress.release(profileId, "tasks", "o1");
    expect(progress.quarantined(profileId).map((row) => row.objectId)).toEqual(["o2"]);
  });

  it("keeps one profile's unreadable objects out of another's", () => {
    progress.quarantine(profileId, [rows[0]]);
    expect(progress.quarantined(otherId)).toEqual([]);
  });
});

describe("SyncProgressStore — forgetting a profile", () => {
  it("drops both the walk and what it could not read", () => {
    progress.advance(profileId, "tasks", 12);
    progress.quarantine(profileId, [
      { collection: "tasks", objectId: "o1", seq: 9, reason: "aead-failed", seenAt: NOW },
    ]);
    progress.advance(otherId, "tasks", 900);

    progress.forget(profileId);

    expect(progress.cursor(profileId, "tasks")).toBe(0);
    expect(progress.quarantined(profileId)).toEqual([]);
    expect(progress.cursor(otherId, "tasks")).toBe(900);
  });

  it("goes with the profile itself, through migration 066's trigger", () => {
    progress.advance(profileId, "tasks", 12);
    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    expect(progress.cursor(profileId, "tasks")).toBe(0);
  });
});
