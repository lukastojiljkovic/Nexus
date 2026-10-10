import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MiniappsStore,
  MiniappsValidationError,
  NexusDatabase,
  emptyMiniappsData,
  openDatabase,
  type MiniappsData,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-miniapps-"));
  db = openDatabase({ path: join(dir, "miniapps.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(profileId = createProfile()): MiniappsStore {
  return new MiniappsStore(db.raw, profileId);
}

/** A document using every one of the module's six kept things, as the page would hand it over. */
function fullDocument(): MiniappsData {
  return {
    version: 1,
    lastApp: "tally",
    counters: [
      { id: "c1", name: "Voda", value: 3, step: 1, floorZero: true },
      { id: "c2", name: "Sklopovi", value: 40, step: 5, floorZero: false },
    ],
    scoreboard: {
      players: [
        { id: "p1", name: "Ana" },
        { id: "p2", name: "Bojan" },
      ],
      rounds: [{ scores: { p1: 12, p2: 7 } }],
      target: 100,
    },
    typing: {
      layout: "sr-Latn",
      lessonId: "home-index-inner",
      records: [
        { layout: "sr-Latn", lessonId: "home-index-inner", netWpm: 41.5, accuracy: 0.97, atMs: 1_700_000 },
      ],
    },
    cities: ["Europe/Belgrade", "America/New_York"],
    diceHistory: [{ atMs: 1_700_001, label: "2d6+3", result: "11" }],
  };
}

describe("MiniappsStore", () => {
  it("answers the empty document, and no row, for a profile that has kept nothing", () => {
    const miniapps = store();

    expect(miniapps.read()).toEqual(emptyMiniappsData());
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS count FROM miniapps_state")
      .get() as { count: number };
    expect(rows.count).toBe(0);
  });

  it("stores the whole kept document and reads it back unchanged", () => {
    const miniapps = store();
    const written = miniapps.write(fullDocument(), NOW);

    expect(written).toEqual(fullDocument());
    expect(miniapps.read()).toEqual(fullDocument());
  });

  it("replaces one tool's state and leaves the other five exactly as they were", () => {
    const miniapps = store();
    miniapps.write(fullDocument(), NOW);

    miniapps.saveCounters([{ id: "c9", name: "Koraci", value: 1, step: 1, floorZero: true }], LATER);
    miniapps.setLastApp("metronome", LATER);

    const after = miniapps.read();
    expect(after.counters.map((counter) => counter.name)).toEqual(["Koraci"]);
    expect(after.lastApp).toBe("metronome");
    // Everything the two writes did not touch is byte-for-byte what it was.
    expect(after.scoreboard).toEqual(fullDocument().scoreboard);
    expect(after.typing).toEqual(fullDocument().typing);
    expect(after.cities).toEqual(fullDocument().cities);
    expect(after.diceHistory).toEqual(fullDocument().diceHistory);
  });

  it("clears the remembered tile without touching anything else", () => {
    const miniapps = store();
    miniapps.write(fullDocument(), NOW);

    expect(miniapps.setLastApp(null, LATER).lastApp).toBeNull();
    expect(miniapps.read().counters).toEqual(fullDocument().counters);
  });

  it("refuses a document it will not hold, and names what is wrong", () => {
    const miniapps = store();
    const withCounters = (counters: MiniappsData["counters"]): MiniappsData => ({
      ...fullDocument(),
      counters,
    });
    const cases: unknown[] = [
      // A version this build does not know.
      { ...fullDocument(), version: 2 },
      // A counter with no name, and one whose name is past the engine's cap.
      withCounters([{ id: "c1", name: "   ", value: 0, step: 1, floorZero: false }]),
      withCounters([{ id: "c1", name: "x".repeat(61), value: 0, step: 1, floorZero: false }]),
      // A step outside 1..1000, and two counters sharing an id.
      withCounters([{ id: "c1", name: "A", value: 0, step: 0, floorZero: false }]),
      withCounters([
        { id: "c1", name: "A", value: 0, step: 1, floorZero: false },
        { id: "c1", name: "B", value: 0, step: 1, floorZero: false },
      ]),
      // A round that names a player who is not on the board, and one that is
      // missing a score for a player who is.
      {
        ...fullDocument(),
        scoreboard: {
          players: [{ id: "p1", name: "Ana" }],
          rounds: [{ scores: { ghost: 1 } }],
          target: null,
        },
      },
      {
        ...fullDocument(),
        scoreboard: { players: fullDocument().scoreboard.players, rounds: [{ scores: {} }], target: null },
      },
      // A score past the engine's bound.
      {
        ...fullDocument(),
        scoreboard: {
          players: [{ id: "p1", name: "Ana" }],
          rounds: [{ scores: { p1: 100_001 } }],
          target: null,
        },
      },
      // A layout the engine does not have.
      { ...fullDocument(), typing: { layout: "de-DE", lessonId: "home-index-inner", records: [] } },
      // More cities and more history rows than the module keeps.
      { ...fullDocument(), cities: Array.from({ length: 13 }, (_value, index) => `Zone/${index}`) },
      {
        ...fullDocument(),
        diceHistory: Array.from({ length: 51 }, (_value, index) => ({
          atMs: index,
          label: "d6",
          result: "1",
        })),
      },
    ];

    for (const document of cases) {
      expect(() => miniapps.write(document, NOW), JSON.stringify(document).slice(0, 60)).toThrow(
        MiniappsValidationError,
      );
    }
    // Not one of the refusals wrote anything.
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS count FROM miniapps_state")
      .get() as { count: number };
    expect(rows.count).toBe(0);
  });

  it("throws on a stored payload that is not JSON rather than answering a half-read document", () => {
    const profileId = createProfile();
    db.raw
      .prepare("INSERT INTO miniapps_state (profile_id, payload, updated_at) VALUES (?, ?, ?)")
      .run(profileId, "{not json", NOW);

    expect(() => new MiniappsStore(db.raw, profileId).read()).toThrow(MiniappsValidationError);
  });

  it("scopes every read and write to its own profile", () => {
    const mine = store();
    const theirs = store();
    mine.write(fullDocument(), NOW);

    expect(theirs.read()).toEqual(emptyMiniappsData());
  });

  it("replaces the whole document from an archive section", () => {
    const miniapps = store();
    miniapps.write(fullDocument(), NOW);

    const restored = { ...emptyMiniappsData(), cities: ["Europe/Belgrade"] };
    miniapps.replaceFromArchive(restored, LATER);

    expect(miniapps.read()).toEqual(restored);
  });

  it("empties the archived state when the archive says nothing about this module", () => {
    const miniapps = store();
    miniapps.write(fullDocument(), NOW);

    miniapps.replaceFromArchive(undefined, LATER);

    expect(miniapps.read()).toEqual(emptyMiniappsData());
    const rows = db.raw
      .prepare("SELECT COUNT(*) AS count FROM miniapps_state")
      .get() as { count: number };
    expect(rows.count).toBe(0);
  });
});
