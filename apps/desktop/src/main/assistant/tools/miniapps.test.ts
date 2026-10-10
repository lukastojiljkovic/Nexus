import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MiniappsStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { miniappsTools } from "./miniapps.js";

/**
 * The MINI-APPS tool over a real database.
 *
 * What this suite pins is the answer: the user's own names come back as typed,
 * the totals and the standings are the engines' own arithmetic (3 + 12 = 15;
 * Ana's 6 + 6 = 12 against Marko's 2 + 6 = 8), a city is a zone with the local
 * time it is there now, and the typing line is the run with the highest net
 * speed.
 *
 * The instant is UTC so the two clock readings are the same on any machine: 07:00
 * UTC is 09:00 in Belgrade (UTC+2 on 10 October) and 03:00 in New York (UTC-4).
 */

const NOW_MS = Date.UTC(2026, 9, 10, 7, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
/** Noon UTC, so the record's own local day is 10 October in every zone the tests run in. */
const RECORD_AT_MS = Date.UTC(2026, 9, 10, 12, 0, 0);

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-miniapps-"));
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

function store(): MiniappsStore {
  return new MiniappsStore(db.raw, profileId);
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
  const found = miniappsTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  }).find((entry) => entry.name === "miniapps.kept");
  if (found === undefined) throw new Error('Test setup: no tool "miniapps.kept".');
  return found;
}

function seed(): void {
  store().saveCounters(
    [
      { id: "kafa", name: "Kafa", value: 3, step: 1, floorZero: true },
      { id: "voda", name: "Voda", value: 12, step: 1, floorZero: false },
    ],
    NOW_ISO,
  );
  store().saveScoreboard(
    {
      players: [
        { id: "ana", name: "Ana" },
        { id: "marko", name: "Marko" },
      ],
      rounds: [
        { scores: { ana: 6, marko: 2 } },
        { scores: { ana: 6, marko: 6 } },
      ],
      target: null,
    },
    NOW_ISO,
  );
  store().saveCities(["Europe/Belgrade", "America/New_York"], NOW_ISO);
  store().saveTyping(
    {
      layout: "sr-Latn",
      lessonId: "home-index-inner",
      records: [
        { layout: "sr-Latn", lessonId: "home-index-inner", netWpm: 38, accuracy: 0.94, atMs: RECORD_AT_MS },
        { layout: "sr-Latn", lessonId: "home-index-inner", netWpm: 42, accuracy: 0.971, atMs: RECORD_AT_MS },
      ],
    },
    NOW_ISO,
  );
}

describe("miniapps.kept", () => {
  it("reads the counters, the standings, the cities and the best typing run", async () => {
    seed();
    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Mini aplikacije — šta pamte:",
        "- Brojači: Kafa 3, Voda 12 (ukupno 15)",
        "- Semafor: Ana (ukupno 12, mesto 1); Marko (ukupno 8, mesto 2) — kola: 2",
        "- Svetski sat: Europe/Belgrade 09:00, America/New_York 03:00",
        "- Kucanje: sr-Latn — reči u minuti: 42, tačnost: 97,1% (najbolje 10. oktobar 2026)",
      ].join("\n"),
    });
  });

  it("answers in English with the same facts", async () => {
    seed();
    const result = await tool().run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Mini apps — what they keep:",
        "- Counters: Kafa 3, Voda 12 (total 15)",
        "- Scoreboard: Ana (total 12, rank 1); Marko (total 8, rank 2) — rounds: 2",
        "- World clock: Europe/Belgrade 09:00, America/New_York 03:00",
        "- Typing: sr-Latn — words a minute: 42, accuracy: 97.1% (best on 10 October 2026)",
      ].join("\n"),
    });
  });

  it("says a fresh profile has kept nothing, and shows only the parts that exist", async () => {
    const empty = await tool().run({}, context("en"));
    expect(empty).toEqual({ ok: true, content: "The mini apps keep nothing yet." });

    store().saveCounters([{ id: "seme", name: "Seme", value: 4, step: 2, floorZero: false }], NOW_ISO);
    const onePart = await tool().run({}, context("en"));
    expect(onePart.content).toBe(
      ["Mini apps — what they keep:", "- Counters: Seme 4 (total 4)"].join("\n"),
    );
  });

  it("marks a tie in the standings instead of ranking two players apart", async () => {
    store().saveScoreboard(
      {
        players: [
          { id: "ana", name: "Ana" },
          { id: "marko", name: "Marko" },
        ],
        rounds: [{ scores: { ana: 5, marko: 5 } }],
        target: 10,
      },
      NOW_ISO,
    );
    const result = await tool().run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Mini apps — what they keep:",
        "- Scoreboard: Ana (total 5, rank 1, tied); Marko (total 5, rank 1, tied) — rounds: 1",
      ].join("\n"),
    });
  });

  it("prints a zone the runtime does not know on its own, rather than dropping the city", async () => {
    store().saveCities(["Europe/Belgrade", "Nasa/Zona"], NOW_ISO);
    const result = await tool().run({}, context("sr"));
    expect(result.content).toBe("Mini aplikacije — šta pamte:\n- Svetski sat: Europe/Belgrade 09:00, Nasa/Zona");
  });
});
