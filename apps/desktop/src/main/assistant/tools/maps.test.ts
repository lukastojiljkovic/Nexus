import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MapsStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { mapsTools } from "./maps.js";

/**
 * The MAPS tool over a real database: the user's own pins, with the two numbers
 * somebody would type into another device. Coordinates are printed with a fixed
 * number of decimals through `Intl`, so the Serbian answer carries the decimal
 * comma the rest of the interface uses.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-maps-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): MapsStore {
  return new MapsStore(db.raw, profileId);
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function tool(): Tool {
  const found = mapsTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === "maps.pins",
  );
  if (found === undefined) throw new Error('Test setup: no tool "maps.pins".');
  return found;
}

describe("maps.pins", () => {
  it("reads a pin with its point and its note", async () => {
    store().createPin(
      {
        title: "Kuća",
        note: "Kapija sa leve strane",
        lat: 44.81234,
        lon: 20.4321,
        color: "zlato",
      },
      NOW_ISO,
    );

    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: ["Tačke (1):", "- Kuća (44,81234, 20,43210) — Kapija sa leve strane"].join("\n"),
    });
  });

  it("folds the query over the title and the note", async () => {
    store().createPin(
      { title: "Đačko igralište", note: "", lat: 44.8, lon: 20.4, color: "suma" },
      NOW_ISO,
    );
    // „djacko" and not „dacko": the fold turns đ into `dj` (it is a stroked letter,
    // not a decomposable one), which is the same rule the palette searches by.
    const result = await tool().run({ query: "djacko" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: ["Pins (1):", "- Đačko igralište (44.80000, 20.40000)"].join("\n"),
    });
  });

  it("says the map is empty, and says which query matched nothing", async () => {
    const empty = await tool().run({}, context("en"));
    expect(empty).toEqual({ ok: true, content: "There are no pins on the map." });

    store().createPin({ title: "Kuća", note: "", lat: 44.8, lon: 20.4, color: "zlato" }, NOW_ISO);
    const none = await tool().run({ query: "more" }, context("en"));
    expect(none).toEqual({
      ok: true,
      content: "No pin matches the search “more”.",
    });
  });
});
