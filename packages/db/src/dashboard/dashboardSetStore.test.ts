import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DashboardSetNotFoundError,
  DashboardSetStore,
  DashboardSetValidationError,
  DashboardWidgetStore,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-31T10:00:00.000Z";
const LATER = "2026-07-31T11:00:00.000Z";

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function storeFor(name: string): { store: DashboardSetStore; profileId: string } {
  const profileId = createProfile(name);
  return { store: new DashboardSetStore(db.raw, profileId), profileId };
}

function names(store: DashboardSetStore): string[] {
  return store.list().map((set) => set.name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-dashboard-sets-"));
  db = openDatabase({ path: join(dir, "sets.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("DashboardSetStore.create / list", () => {
  it("starts empty — the NULL set IS the default dashboard, and it is not a row", () => {
    const { store } = storeFor("a");
    expect(store.list()).toEqual([]);
  });

  it("creates sets at increasing ranks, in creation order", () => {
    const { store, profileId } = storeFor("a");
    const first = store.create("Fakultet", NOW);
    const second = store.create("Posao", NOW);
    expect(first.profileId).toBe(profileId);
    expect(first.rank < second.rank).toBe(true);
    expect(names(store)).toEqual(["Fakultet", "Posao"]);
    expect(first.createdAt).toBe(NOW);
    expect(first.updatedAt).toBe(NOW);
  });

  it("trims the name, and allows two sets to share one — a set's identity is its id", () => {
    const { store } = storeFor("a");
    store.create("  Fakultet  ", NOW);
    store.create("Fakultet", NOW);
    expect(names(store)).toEqual(["Fakultet", "Fakultet"]);
  });

  it("refuses an empty, whitespace-only or over-100-character name", () => {
    const { store } = storeFor("a");
    expect(() => store.create("", NOW)).toThrow(DashboardSetValidationError);
    expect(() => store.create("   ", NOW)).toThrow(DashboardSetValidationError);
    expect(() => store.create("x".repeat(101), NOW)).toThrow(DashboardSetValidationError);
    expect(() => store.create("x".repeat(100), NOW)).not.toThrow();
  });

  it("refuses a malformed now", () => {
    const { store } = storeFor("a");
    expect(() => store.create("Fakultet", "danas")).toThrow(DashboardSetValidationError);
  });

  it("is scoped to its own profile", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    first.store.create("Fakultet", NOW);
    expect(second.store.list()).toEqual([]);
  });
});

describe("DashboardSetStore.rename", () => {
  it("renames a set, trimming and stamping updated_at", () => {
    const { store } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    const renamed = store.rename(set.id, "  Faks  ", LATER);
    expect(renamed.name).toBe("Faks");
    expect(renamed.updatedAt).toBe(LATER);
    expect(renamed.createdAt).toBe(NOW);
    expect(names(store)).toEqual(["Faks"]);
  });

  it("refuses an unknown id, and another profile's set", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const foreign = second.store.create("Tudja", NOW);
    expect(() => first.store.rename("missing", "X", NOW)).toThrow(DashboardSetNotFoundError);
    expect(() => first.store.rename(foreign.id, "X", NOW)).toThrow(DashboardSetNotFoundError);
  });

  it("refuses an invalid name", () => {
    const { store } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    expect(() => store.rename(set.id, "  ", NOW)).toThrow(DashboardSetValidationError);
  });
});

describe("DashboardSetStore.delete", () => {
  it("removes the set together with its widget rows — they are arrangement, not content", () => {
    const { store, profileId } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    const widgets = new DashboardWidgetStore(db.raw, profileId);
    widgets.add(set.id, "calendar:danas", "M", NOW);
    widgets.add(null, "calendar:danas", "M", NOW);
    const countBySet = (setId: string | null): number =>
      (
        db.raw
          .prepare(
            "SELECT count(*) AS n FROM dashboard_widgets WHERE profile_id = ? AND set_id IS ?",
          )
          .get(profileId, setId) as { n: number }
      ).n;
    expect(countBySet(set.id)).toBeGreaterThan(0);
    const defaultRows = countBySet(null);

    store.delete(set.id, LATER);

    expect(store.list()).toEqual([]);
    expect(countBySet(set.id)).toBe(0);
    // The NULL set's own rows are untouched: deleting a named tabla never
    // reaches into Početna.
    expect(countBySet(null)).toBe(defaultRows);
  });

  it("clears active_set_id when the deleted set was the active one", () => {
    const { store } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    store.setActive(set.id, NOW);
    expect(store.activeSetId()).toBe(set.id);
    store.delete(set.id, LATER);
    expect(store.activeSetId()).toBeNull();
  });

  it("leaves active_set_id alone when some other set was active", () => {
    const { store } = storeFor("a");
    const keep = store.create("Fakultet", NOW);
    const drop = store.create("Posao", NOW);
    store.setActive(keep.id, NOW);
    store.delete(drop.id, LATER);
    expect(store.activeSetId()).toBe(keep.id);
  });

  it("refuses an unknown id, and another profile's set", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const foreign = second.store.create("Tudja", NOW);
    expect(() => first.store.delete("missing", NOW)).toThrow(DashboardSetNotFoundError);
    expect(() => first.store.delete(foreign.id, NOW)).toThrow(DashboardSetNotFoundError);
    expect(second.store.list()).toHaveLength(1);
  });
});

describe("DashboardSetStore.reorder", () => {
  it("moves a set between two neighbours by the pair API", () => {
    const { store } = storeFor("a");
    const a = store.create("A", NOW);
    store.create("B", NOW);
    const c = store.create("C", NOW);
    const after = store.reorder(c.id, null, a.id, LATER);
    expect(after.map((set) => set.name)).toEqual(["C", "A", "B"]);
  });

  it("places 200 boards between the same two neighbours without ever running out of room", () => {
    // The fractional-rank replacement for "the gap ran out and the scope was
    // renumbered": a rank always has room between two neighbours (@nexus/core's
    // `rankBetween`), so 200 inserts squeezed into the SAME narrowing gap next
    // to A must all succeed, and the scope must still come back in exactly the
    // order they were placed.
    const { store } = storeFor("a");
    const a = store.create("A", NOW);
    let boundary = store.create("B", NOW);
    for (let round = 0; round < 200; round += 1) {
      const inserted = store.create(`Mid-${round}`, NOW);
      store.reorder(inserted.id, a.id, boundary.id, NOW);
      boundary = inserted;
    }
    const order = names(store);
    expect(order).toHaveLength(202);
    expect(order[0]).toBe("A");
    expect(order[order.length - 1]).toBe("B");
    // Each round landed strictly between A and the previous round's board, so
    // the 200 middle boards come back in reverse insertion order.
    expect(order.slice(1, -1)).toEqual(Array.from({ length: 200 }, (_, i) => `Mid-${199 - i}`));
  });

  it("refuses a pair that describes no gap, and a set ordered against itself", () => {
    const { store } = storeFor("a");
    const a = store.create("A", NOW);
    const b = store.create("B", NOW);
    expect(() => store.reorder(a.id, a.id, b.id, NOW)).toThrow(DashboardSetValidationError);
    expect(() => store.reorder(a.id, b.id, a.id, NOW)).toThrow(DashboardSetValidationError);
  });

  it("refuses a neighbour from another profile", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const mine = first.store.create("A", NOW);
    const foreign = second.store.create("B", NOW);
    expect(() => first.store.reorder(mine.id, foreign.id, null, NOW)).toThrow(
      DashboardSetNotFoundError,
    );
  });
});

describe("DashboardSetStore.setActive / activeSetId", () => {
  it("defaults to null — Početna — while nothing was ever chosen", () => {
    const { store } = storeFor("a");
    expect(store.activeSetId()).toBeNull();
  });

  it("writes the choice, creating the settings row when the profile never had one", () => {
    const { store, profileId } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    expect(store.setActive(set.id, NOW)).toBe(set.id);
    expect(store.activeSetId()).toBe(set.id);
    // The settings row it upserted keeps the store's own defaults for the
    // background columns.
    expect(
      db.raw
        .prepare("SELECT background_hash, background_dim FROM dashboard_settings WHERE profile_id = ?")
        .get(profileId),
    ).toEqual({ background_hash: null, background_dim: 40 });
  });

  it("null returns the profile to Početna", () => {
    const { store } = storeFor("a");
    const set = store.create("Fakultet", NOW);
    store.setActive(set.id, NOW);
    expect(store.setActive(null, LATER)).toBeNull();
    expect(store.activeSetId()).toBeNull();
  });

  it("preserves a background choice the profile already made", () => {
    const { store, profileId } = storeFor("a");
    db.raw
      .prepare(
        `INSERT INTO dashboard_settings (profile_id, background_dim, created_at, updated_at)
         VALUES (?, 70, ?, ?)`,
      )
      .run(profileId, NOW, NOW);
    const set = store.create("Fakultet", NOW);
    store.setActive(set.id, LATER);
    expect(
      db.raw
        .prepare("SELECT background_dim, active_set_id FROM dashboard_settings WHERE profile_id = ?")
        .get(profileId),
    ).toEqual({ background_dim: 70, active_set_id: set.id });
  });

  it("refuses an unknown set, and another profile's", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const foreign = second.store.create("Tudja", NOW);
    expect(() => first.store.setActive("missing", NOW)).toThrow(DashboardSetNotFoundError);
    expect(() => first.store.setActive(foreign.id, NOW)).toThrow(DashboardSetNotFoundError);
  });

  it("refuses a malformed now", () => {
    const { store } = storeFor("a");
    expect(() => store.setActive(null, "danas")).toThrow(DashboardSetValidationError);
  });
});
