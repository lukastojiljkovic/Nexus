import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PIN_NOTE_LENGTH, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The MAPS module through the kit (ADR-090): its ops, the position main keeps
 * in memory, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app — a typo in
 * an op name or a payload the validators refuse is a rejected promise here, not
 * a surprise on the first click.
 *
 * The clock is the harness's, so a stored instant is a number this test chose.
 * Everything else is real: a real encrypted database, the real migrations, the
 * real store.
 */

const TRUSTED = { trusted: true };
const CLOCK = Date.parse("2026-06-01T08:00:00.000Z");

let dir: string;
let db: NexusDatabase;

interface Harness {
  readonly host: ModuleHost;
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => CLOCK,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(CLOCK).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

interface View {
  pins: {
    id: string;
    title: string;
    note: string | null;
    lat: number;
    lon: number;
    color: string;
  }[];
  location: { lat: number; lon: number } | null;
}

/** Beograd, node 60571493 — the coordinates the app's own fixtures use. */
const BEOGRAD = { lat: 44.8178131, lon: 20.4568974 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-maps-module-"));
  db = openDatabase({ path: join(dir, "maps.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the maps handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "maps:list",
      "maps:createPin",
      "maps:updatePin",
      "maps:removePin",
      "maps:setLocation",
      "maps:clearLocation",
    ]);
  });

  it("answers a read with this profile's pins and no position", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await call(host, "maps:createPin", {
      profileId,
      title: "  Vinarija  ",
      note: "  Otvoreno do 18h ",
      ...BEOGRAD,
      color: "suma",
    });
    const view = await call<View>(host, "maps:list", { profileId });

    expect(view.pins).toEqual([
      expect.objectContaining({
        title: "Vinarija",
        note: "Otvoreno do 18h",
        lat: BEOGRAD.lat,
        lon: BEOGRAD.lon,
        color: "suma",
      }),
    ]);
    expect(view.location).toBeNull();
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const create = (over: Record<string, unknown>): Promise<unknown> =>
      call(host, "maps:createPin", {
        profileId,
        title: "Park",
        note: "",
        ...BEOGRAD,
        color: "zad",
        ...over,
      });

    await expect(create({ title: "" })).rejects.toThrow(/must be a non-empty string/);
    await expect(create({ title: "x".repeat(121) })).rejects.toThrow(
      /must not exceed 120 characters/,
    );
    await expect(create({ note: "x".repeat(MAX_PIN_NOTE_LENGTH + 1) })).rejects.toThrow(
      /must not exceed 2000 characters/,
    );
    await expect(create({ lat: 91 })).rejects.toThrow(/between -90 and 90/);
    await expect(create({ lat: Number.NaN })).rejects.toThrow(/must be a finite number/);
    await expect(create({ lon: 181 })).rejects.toThrow(/between -180 and 180/);
    await expect(create({ color: "tirkiz" })).rejects.toThrow(/not a pin colour/);
    await expect(create({ color: 7 })).rejects.toThrow(/must be a string/);
    await expect(create({ profileId: "  padded  " })).rejects.toThrow(/not a well-formed id/);
    // And a field that is not an id at all is refused as an id, not passed on.
    await expect(
      call(host, "maps:updatePin", {
        profileId,
        id: " nope ",
        title: "Park",
        note: "",
        color: "zad",
      }),
    ).rejects.toThrow(/not a well-formed id/);
  });

  it("refuses a message from an untrusted sender before any handler runs", () => {
    const { host } = harness();
    return expect(
      host.dispatch("maps:list", { trusted: false }, { profileId: "x" }),
    ).rejects.toThrow(/did not come from this app/);
  });

  it("edits what a pin says and removes it, scoped to the profile", async () => {
    const { host } = harness();
    const mine = createProfile();
    const theirs = createProfile();
    const created = await call<View>(host, "maps:createPin", {
      profileId: mine,
      title: "Park",
      note: "klupa",
      ...BEOGRAD,
      color: "zad",
    });
    const id = created.pins[0]?.id ?? "";
    const other = await call<View>(host, "maps:createPin", {
      profileId: theirs,
      title: "Park",
      note: "",
      ...BEOGRAD,
      color: "zad",
    });

    const edited = await call<View>(host, "maps:updatePin", {
      profileId: mine,
      id,
      title: "Park kod reke",
      note: "",
      color: "bordo",
    });
    expect(edited.pins[0]).toMatchObject({
      id,
      title: "Park kod reke",
      note: null,
      color: "bordo",
      lat: BEOGRAD.lat,
      lon: BEOGRAD.lon,
    });

    // Another profile's pin is not merely hidden: the store does not find it.
    await expect(
      call(host, "maps:removePin", { profileId: mine, id: other.pins[0]?.id ?? "" }),
    ).rejects.toThrow(/No pin/);
    await expect(
      call(host, "maps:updatePin", {
        profileId: mine,
        id: other.pins[0]?.id ?? "",
        title: "X",
        note: "",
        color: "zad",
      }),
    ).rejects.toThrow(/No pin/);

    const after = await call<View>(host, "maps:removePin", { profileId: mine, id });
    expect(after.pins).toEqual([]);
  });
});

describe("the position main remembers", () => {
  it("answers with the position it was given, and forgets it when asked", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const set = await call<View>(host, "maps:setLocation", { profileId, ...BEOGRAD });
    expect(set.location).toEqual(BEOGRAD);
    expect((await call<View>(host, "maps:list", { profileId })).location).toEqual(BEOGRAD);

    const cleared = await call<View>(host, "maps:clearLocation", { profileId });
    expect(cleared.location).toBeNull();
  });

  it("refuses a coordinate outside the world", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await expect(
      call(host, "maps:setLocation", { profileId, lat: -91, lon: 20 }),
    ).rejects.toThrow(/between -90 and 90/);
    await expect(
      call(host, "maps:setLocation", { profileId, lat: 44, lon: "20" }),
    ).rejects.toThrow(/must be a finite number/);
  });

  it("is a fact about the machine, so a locked session has no position", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "maps:setLocation", { profileId, ...BEOGRAD });

    host.sessionEnd();

    expect((await call<View>(host, "maps:list", { profileId })).location).toBeNull();
  });
});

describe("the maps archive section", () => {
  it("round-trips the pins between two profiles", async () => {
    const { host } = harness();
    const source = createProfile();
    const target = createProfile();
    await call(host, "maps:createPin", {
      profileId: source,
      title: "Vinarija",
      note: "Otvoreno do 18h",
      lat: 44.8,
      lon: 20.4,
      color: "suma",
    });
    await call(host, "maps:createPin", {
      profileId: source,
      title: "Park",
      note: "",
      lat: 45.2,
      lon: 19.8,
      color: "zlato",
    });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("maps");
    host.applyImports([section!], [target]);

    const restored = await call<View>(host, "maps:list", { profileId: target });
    expect(restored.pins.map((pin) => pin.title)).toEqual(["Park", "Vinarija"]);
    expect(restored.pins.find((pin) => pin.title === "Vinarija")).toMatchObject({
      note: "Otvoreno do 18h",
      lat: 44.8,
      lon: 20.4,
      color: "suma",
    });
    expect(restored.pins.find((pin) => pin.title === "Park")?.note).toBeNull();
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "maps:createPin", {
      profileId,
      title: "Park",
      note: "",
      ...BEOGRAD,
      color: "zad",
    });

    // Four shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, a row that is not a pin, a coordinate
    // outside the world, and a colour the store's own CHECK would refuse.
    for (const payload of [
      { version: 99, pins: [] },
      { version: 1, pins: [{ title: "X" }] },
      { version: 1, pins: [{ title: "X", note: "", lat: 91, lon: 20, color: "suma" }] },
      { version: 1, pins: [{ title: "X", note: "", lat: 44, lon: 20, color: "tirkiz" }] },
      { version: 1, pins: {} },
    ]) {
      expect(() => host.applyImports([{ moduleId: "maps", payload }], [profileId])).toThrow();
      const after = await call<View>(host, "maps:list", { profileId });
      expect(after.pins.map((pin) => pin.title)).toEqual(["Park"]);
    }
  });

  it("empties the pins when the section names no Maps entry, and says nothing about the position", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "maps:createPin", {
      profileId,
      title: "Park",
      note: "",
      ...BEOGRAD,
      color: "zad",
    });
    await call(host, "maps:setLocation", { profileId, ...BEOGRAD });

    // An archive with no Maps entry is what a restore of a pre-ADR-099 archive
    // hands over, and a restore replaces the profile whole.
    host.applyImports([], [profileId]);

    const after = await call<View>(host, "maps:list", { profileId });
    expect(after.pins).toEqual([]);
    // The position is not content and is not archived: it is still the fix this
    // machine has.
    expect(after.location).toEqual(BEOGRAD);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
