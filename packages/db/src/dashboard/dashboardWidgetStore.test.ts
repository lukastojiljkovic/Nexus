import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DashboardSetNotFoundError,
  DashboardSetStore,
  DashboardWidgetNotFoundError,
  DashboardWidgetStore,
  DashboardWidgetValidationError,
  DEFAULT_DASHBOARD_LAYOUT,
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

function storeFor(name: string): { store: DashboardWidgetStore; profileId: string } {
  const profileId = createProfile(name);
  return { store: new DashboardWidgetStore(db.raw, profileId), profileId };
}

function widgetIds(store: DashboardWidgetStore): string[] {
  return store.listLayout(null).map((entry) => entry.widgetId);
}

function rowCount(): number {
  return (db.raw.prepare("SELECT count(*) AS n FROM dashboard_widgets").get() as { n: number }).n;
}

const DEFAULT_WIDGET_IDS = DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.widgetId);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-dashboard-widgets-"));
  db = openDatabase({ path: join(dir, "widgets.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("DashboardWidgetStore.listLayout", () => {
  it("answers with the default arrangement while no row exists", () => {
    const { store } = storeFor("a");
    expect(widgetIds(store)).toEqual(DEFAULT_WIDGET_IDS);
    expect(store.listLayout(null).every((entry) => entry.size === "M")).toBe(true);
    expect(store.listLayout(null).every((entry) => entry.config === null)).toBe(true);
  });

  it("never writes a row just by being read", () => {
    const { store } = storeFor("a");
    store.listLayout(null);
    expect(rowCount()).toBe(0);
  });

  it("gives the default entries stable instance ids across reads", () => {
    const { store } = storeFor("a");
    expect(store.listLayout(null).map((e) => e.instanceId)).toEqual(
      store.listLayout(null).map((e) => e.instanceId),
    );
  });

  it("gives two profiles' defaults different instance ids — the column is a global primary key", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const firstIds = new Set(first.store.listLayout(null).map((e) => e.instanceId));
    for (const entry of second.store.listLayout(null)) {
      expect(firstIds.has(entry.instanceId)).toBe(false);
    }
  });

  it("returns the stored rows, in position order, once the profile has any", () => {
    const { store } = storeFor("a");
    store.setSize(null, store.listLayout(null)[0]!.instanceId, "L", NOW);
    expect(widgetIds(store)).toEqual(DEFAULT_WIDGET_IDS);
    expect(store.listLayout(null)[0]?.size).toBe("L");
  });

  it("is scoped to its own profile", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    first.store.add(null, "finance:budzet", "S", NOW);
    expect(widgetIds(second.store)).toEqual(DEFAULT_WIDGET_IDS);
  });
});

describe("DashboardWidgetStore.listAll", () => {
  it("is empty while the profile is on the default arrangement — an archive carries what is stored", () => {
    const { store } = storeFor("a");
    expect(store.listAll()).toEqual([]);
  });

  it("returns full rows, in position order, once the default has been materialized", () => {
    const { store, profileId } = storeFor("a");
    store.add(null, "finance:budzet", "S", NOW);
    const rows = store.listAll();
    expect(rows.map((row) => row.widgetId)).toEqual([...DEFAULT_WIDGET_IDS, "finance:budzet"]);
    expect(rows.every((row) => row.profileId === profileId)).toBe(true);
    expect(rows[0]?.createdAt).toBe(NOW);
    expect(rows[0]?.updatedAt).toBe(NOW);
    expect(rows.map((row) => row.position)).toEqual([...rows.map((row) => row.position)].sort((a, b) => a - b));
  });
});

describe("DashboardWidgetStore materialization", () => {
  it("writes the whole default arrangement on the first mutation, then applies the change", () => {
    const { store } = storeFor("a");
    store.add(null, "finance:budzet", "M", NOW);
    expect(rowCount()).toBe(DEFAULT_DASHBOARD_LAYOUT.length + 1);
    expect(widgetIds(store)).toEqual([...DEFAULT_WIDGET_IDS, "finance:budzet"]);
  });

  it("keeps the unedited rest when the first mutation edits ONE default entry", () => {
    const { store } = storeFor("a");
    const target = store.listLayout(null)[2]!;
    store.setSize(null, target.instanceId, "L", NOW);

    const layout = store.listLayout(null);
    expect(layout.map((entry) => entry.widgetId)).toEqual(DEFAULT_WIDGET_IDS);
    expect(layout[2]?.size).toBe("L");
    expect(layout.filter((entry) => entry.size === "M")).toHaveLength(
      DEFAULT_DASHBOARD_LAYOUT.length - 1,
    );
  });

  it("materializes a default entry under the very instance id `listLayout` had already handed out", () => {
    const { store } = storeFor("a");
    const before = store.listLayout(null).map((entry) => entry.instanceId);
    store.setSize(null, before[0]!, "S", NOW);
    expect(store.listLayout(null).map((entry) => entry.instanceId)).toEqual(before);
  });

  it("happens exactly once — a second mutation adds no default rows", () => {
    const { store } = storeFor("a");
    store.add(null, "finance:budzet", "M", NOW);
    store.add(null, "finance:racuni", "M", LATER);
    expect(rowCount()).toBe(DEFAULT_DASHBOARD_LAYOUT.length + 2);
  });

  it("does not happen when the profile already has rows — even a single one", () => {
    const { store } = storeFor("a");
    store.add(null, "finance:budzet", "M", NOW);
    for (const entry of store.listLayout(null)) {
      if (entry.widgetId !== "finance:budzet") store.remove(null, entry.instanceId, LATER);
    }
    expect(widgetIds(store)).toEqual(["finance:budzet"]);
    store.setSize(null, store.listLayout(null)[0]!.instanceId, "L", LATER);
    expect(widgetIds(store)).toEqual(["finance:budzet"]);
  });

  it("brings the default back once the last widget is removed — no rows IS the default", () => {
    const { store } = storeFor("a");
    for (const entry of store.listLayout(null)) store.remove(null, entry.instanceId, NOW);
    expect(rowCount()).toBe(0);
    expect(widgetIds(store)).toEqual(DEFAULT_WIDGET_IDS);
  });
});

describe("DashboardWidgetStore.add", () => {
  it("appends at the end and returns the resulting layout", () => {
    const { store } = storeFor("a");
    const layout = store.add(null, "finance:budzet", "L", NOW);
    expect(layout.map((entry) => entry.widgetId)).toEqual([...DEFAULT_WIDGET_IDS, "finance:budzet"]);
    expect(layout.at(-1)?.size).toBe("L");
    expect(layout.at(-1)?.config).toBeNull();
  });

  it("mints a fresh instance id each time, so the same widget can be placed twice", () => {
    const { store } = storeFor("a");
    store.add(null, "calendar:danas", "S", NOW);
    store.add(null, "calendar:danas", "L", LATER);
    const placements = store.listLayout(null).filter((entry) => entry.widgetId === "calendar:danas");
    expect(placements).toHaveLength(3);
    expect(new Set(placements.map((entry) => entry.instanceId)).size).toBe(3);
  });

  it("refuses an unknown size", () => {
    const { store } = storeFor("a");
    expect(() => store.add(null, "calendar:danas", "XL" as never, NOW)).toThrow(
      DashboardWidgetValidationError,
    );
    expect(rowCount()).toBe(0);
  });

  it("refuses a widget id that is not a `moduleId:widgetId` slug", () => {
    const { store } = storeFor("a");
    expect(() => store.add(null, "", "M", NOW)).toThrow(DashboardWidgetValidationError);
    expect(() => store.add(null, "danas", "M", NOW)).toThrow(DashboardWidgetValidationError);
    expect(() => store.add(null, "calendar:danas:extra", "M", NOW)).toThrow(DashboardWidgetValidationError);
    expect(() => store.add(null, "Calendar:Danas", "M", NOW)).toThrow(DashboardWidgetValidationError);
    expect(() => store.add(null, "calendar: danas", "M", NOW)).toThrow(DashboardWidgetValidationError);
  });

  it("accepts a widget id no module publishes — the catalogue is not this store's to hold", () => {
    const { store } = storeFor("a");
    expect(() => store.add(null, "finance:budzet", "M", NOW)).not.toThrow();
  });

  it("refuses a `now` that is not an ISO-8601 date-time", () => {
    const { store } = storeFor("a");
    expect(() => store.add(null, "calendar:danas", "M", "yesterday")).toThrow(
      DashboardWidgetValidationError,
    );
  });
});

describe("DashboardWidgetStore.remove", () => {
  it("removes one placement, leaving the rest in order", () => {
    const { store } = storeFor("a");
    const layout = store.listLayout(null);
    store.remove(null, layout[1]!.instanceId, NOW);
    expect(widgetIds(store)).toEqual(DEFAULT_WIDGET_IDS.filter((_, index) => index !== 1));
  });

  it("throws for an instance this profile does not have", () => {
    const { store } = storeFor("a");
    expect(() => store.remove(null, "nema-ga", NOW)).toThrow(DashboardWidgetNotFoundError);
  });

  it("cannot reach another profile's placement", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const stolen = first.store.add(null, "finance:budzet", "M", NOW).at(-1)!.instanceId;
    expect(() => second.store.remove(null, stolen, LATER)).toThrow(DashboardWidgetNotFoundError);
    expect(first.store.listLayout(null).some((e) => e.instanceId === stolen)).toBe(true);
  });
});

describe("DashboardWidgetStore.setSize", () => {
  it("changes one placement's size and nothing else", () => {
    const { store } = storeFor("a");
    const target = store.listLayout(null)[3]!;
    const layout = store.setSize(null, target.instanceId, "S", NOW);
    expect(layout.map((entry) => entry.widgetId)).toEqual(DEFAULT_WIDGET_IDS);
    expect(layout[3]?.size).toBe("S");
  });

  it("stamps updated_at without touching created_at", () => {
    const { store } = storeFor("a");
    store.add(null, "finance:budzet", "M", NOW);
    const target = store.listLayout(null)[0]!;
    store.setSize(null, target.instanceId, "L", LATER);
    const row = store.listAll().find((entry) => entry.instanceId === target.instanceId);
    expect(row?.createdAt).toBe(NOW);
    expect(row?.updatedAt).toBe(LATER);
  });

  it("refuses an unknown size", () => {
    const { store } = storeFor("a");
    const target = store.listLayout(null)[0]!;
    expect(() => store.setSize(null, target.instanceId, "XL" as never, NOW)).toThrow(
      DashboardWidgetValidationError,
    );
  });

  it("throws for an instance this profile does not have", () => {
    const { store } = storeFor("a");
    expect(() => store.setSize(null, "nema-ga", "L", NOW)).toThrow(DashboardWidgetNotFoundError);
  });
});

describe("DashboardWidgetStore.move", () => {
  it("moves a placement between two neighbours", () => {
    const { store } = storeFor("a");
    const layout = store.listLayout(null);
    // Take the last entry and drop it between the first and the second.
    store.move(null, layout[4]!.instanceId, layout[0]!.instanceId, layout[1]!.instanceId, NOW);
    expect(widgetIds(store)).toEqual([
      DEFAULT_WIDGET_IDS[0],
      DEFAULT_WIDGET_IDS[4],
      DEFAULT_WIDGET_IDS[1],
      DEFAULT_WIDGET_IDS[2],
      DEFAULT_WIDGET_IDS[3],
    ]);
  });

  it("prepends when `beforeId` is null and appends when `afterId` is null", () => {
    const { store } = storeFor("a");
    const layout = store.listLayout(null);
    store.move(null, layout[2]!.instanceId, null, layout[0]!.instanceId, NOW);
    expect(widgetIds(store)[0]).toBe(DEFAULT_WIDGET_IDS[2]);

    const moved = store.listLayout(null);
    store.move(null, moved[0]!.instanceId, moved.at(-1)!.instanceId, null, LATER);
    expect(widgetIds(store).at(-1)).toBe(DEFAULT_WIDGET_IDS[2]);
  });

  it("renumbers the scope and still lands the move when the gap has run out", () => {
    const { store } = storeFor("a");
    // Each pass drops a fresh widget into the SAME slot — right after the first
    // entry — halving the remaining room every time. Ten passes exhaust a 1024
    // gap; the ones after that are what force the renumber-and-retry inside
    // `placeBetween`.
    for (let index = 0; index < 12; index += 1) {
      const added = store.add(null, `finance:w${index}`, "S", NOW);
      const layout = store.listLayout(null);
      store.move(null, added.at(-1)!.instanceId, layout[0]!.instanceId, layout[1]!.instanceId, NOW);
    }
    const ids = widgetIds(store);
    expect(ids[0]).toBe(DEFAULT_WIDGET_IDS[0]);
    expect(ids[1]).toBe("finance:w11");
    expect(ids.at(-1)).toBe(DEFAULT_WIDGET_IDS.at(-1));
    // Every placement keeps a position of its own: had the retry failed, two
    // rows would share one and only the instance-id tie-break would order them.
    const positions = store.listAll().map((row) => row.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("refuses to order a placement against itself", () => {
    const { store } = storeFor("a");
    const layout = store.listLayout(null);
    expect(() => store.move(null, layout[0]!.instanceId, layout[0]!.instanceId, null, NOW)).toThrow(
      DashboardWidgetValidationError,
    );
    expect(() => store.move(null, layout[0]!.instanceId, null, layout[0]!.instanceId, NOW)).toThrow(
      DashboardWidgetValidationError,
    );
  });

  it("throws for a neighbour this profile does not have", () => {
    const { store } = storeFor("a");
    const layout = store.listLayout(null);
    expect(() => store.move(null, layout[0]!.instanceId, "nema-ga", null, NOW)).toThrow(
      DashboardWidgetNotFoundError,
    );
  });

  it("throws for an instance this profile does not have", () => {
    const { store } = storeFor("a");
    expect(() => store.move(null, "nema-ga", null, null, NOW)).toThrow(DashboardWidgetNotFoundError);
  });
});

describe("DashboardWidgetStore per-set scoping (DASH-008 / ADR-055)", () => {
  function setFor(profileId: string, name: string): string {
    return new DashboardSetStore(db.raw, profileId).create(name, NOW).id;
  }

  it("answers a named set with the default arrangement while it has no rows — an EMPTY set is the default per set", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    expect(store.listLayout(setId).map((e) => e.widgetId)).toEqual(DEFAULT_WIDGET_IDS);
    expect(rowCount()).toBe(0);
  });

  it("gives the same profile's NULL set and named set different default instance ids", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    const nullIds = new Set(store.listLayout(null).map((e) => e.instanceId));
    for (const entry of store.listLayout(setId)) {
      expect(nullIds.has(entry.instanceId)).toBe(false);
    }
  });

  it("materializes and edits one set without touching the other", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    store.add(setId, "finance:budzet", "M", NOW);
    expect(rowCount()).toBe(DEFAULT_DASHBOARD_LAYOUT.length + 1);
    // The NULL set is still on its (unstored) default.
    expect(store.listLayout(null).map((e) => e.widgetId)).toEqual(DEFAULT_WIDGET_IDS);
    expect(store.listAll().every((row) => row.setId === setId)).toBe(true);

    // And editing the NULL set materializes ITS default without touching the set's rows.
    store.setSize(null, store.listLayout(null)[0]!.instanceId, "L", LATER);
    expect(rowCount()).toBe(DEFAULT_DASHBOARD_LAYOUT.length * 2 + 1);
    expect(store.listLayout(setId)).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length + 1);
  });

  it("cannot reach a placement through the wrong set", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    const placed = store.add(setId, "finance:budzet", "M", NOW).at(-1)!.instanceId;
    expect(() => store.remove(null, placed, LATER)).toThrow(DashboardWidgetNotFoundError);
    expect(() => store.setSize(null, placed, "L", LATER)).toThrow(DashboardWidgetNotFoundError);
    expect(store.listLayout(setId).some((e) => e.instanceId === placed)).toBe(true);
  });

  it("cannot order a placement against a neighbour from another set", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    store.add(setId, "finance:budzet", "M", NOW);
    const inSet = store.listLayout(setId)[0]!.instanceId;
    store.add(null, "finance:racuni", "M", NOW);
    const inNull = store.listLayout(null)[0]!.instanceId;
    expect(() => store.move(setId, inSet, inNull, null, LATER)).toThrow(
      DashboardWidgetNotFoundError,
    );
  });

  it("removing a named set's last widget puts that set's default back — reset stays free per set", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    store.add(setId, "finance:budzet", "M", NOW);
    for (const entry of store.listLayout(setId)) store.remove(setId, entry.instanceId, LATER);
    expect(store.listLayout(setId).map((e) => e.widgetId)).toEqual(DEFAULT_WIDGET_IDS);
  });

  it("refuses a set this profile does not have", () => {
    const first = storeFor("a");
    const second = storeFor("b");
    const foreign = setFor(second.profileId, "Tudja");
    expect(() => first.store.add(foreign, "finance:budzet", "M", NOW)).toThrow(
      DashboardSetNotFoundError,
    );
    expect(() => first.store.add("nema-ga", "finance:budzet", "M", NOW)).toThrow(
      DashboardSetNotFoundError,
    );
    // Reads are gated identically: a layout of a set that is not there is a
    // question about nothing.
    expect(() => first.store.listLayout("nema-ga")).toThrow(DashboardSetNotFoundError);
  });

  it("listAll carries every set's rows with their setId — the exporter reads one profile whole", () => {
    const { store, profileId } = storeFor("a");
    const setId = setFor(profileId, "Fakultet");
    store.add(null, "finance:budzet", "M", NOW);
    store.add(setId, "finance:racuni", "M", NOW);
    const rows = store.listAll();
    expect(rows).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length * 2 + 2);
    expect(new Set(rows.map((row) => row.setId))).toEqual(new Set([null, setId]));
  });
});
