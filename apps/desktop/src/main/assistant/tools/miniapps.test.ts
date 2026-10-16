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

function context(
  locale: "sr" | "en",
  confirm: ToolContext["confirm"] = () => Promise.resolve(true),
): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm,
  };
}

function tool(name = "miniapps.kept"): Tool {
  const found = miniappsTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  }).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** A confirmation that gives the answer it is asked, and keeps each summary it was shown. */
function asking(answer: boolean, asked: string[] = []): ToolContext["confirm"] {
  return (request) => {
    asked.push(request.summary);
    return Promise.resolve(answer);
  };
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

describe("miniapps.dates", () => {
  it("counts the days between two dates, in calendar parts as well", async () => {
    const result = await tool("miniapps.dates").run(
      { from: "2026-10-10", to: "2026-12-25" },
      context("en"),
    );
    expect(result).toEqual({
      ok: true,
      content: "Between 2026-10-10 and 2026-12-25: 76 days (0 yr, 2 mo, 15 d).",
    });
  });

  it("answers in Serbian, and uses the singular for one day", async () => {
    const serbian = await tool("miniapps.dates").run(
      { from: "2026-10-10", to: "2026-12-25" },
      context("sr"),
    );
    expect(serbian.content).toBe("Između 2026-10-10 i 2026-12-25: 76 dana (0 god., 2 mes., 15 d).");
    const oneDay = await tool("miniapps.dates").run(
      { from: "2026-10-10", to: "2026-10-11" },
      context("en"),
    );
    expect(oneDay.content).toBe("Between 2026-10-10 and 2026-10-11: 1 day (0 yr, 0 mo, 1 d).");
  });

  it("starts from today when no start date is given", async () => {
    const result = await tool("miniapps.dates").run({ to: "2026-10-20" }, context("en"));
    expect(result.content).toBe("Between 2026-10-10 and 2026-10-20: 10 days (0 yr, 0 mo, 10 d).");
  });

  it("moves a date by a span, clamping a month that is too short", async () => {
    const result = await tool("miniapps.dates").run(
      { from: "2026-01-31", add: { months: 1 } },
      context("en"),
    );
    expect(result).toEqual({ ok: true, content: "2026-01-31 +1 mo = 2026-02-28" });
    const back = await tool("miniapps.dates").run(
      { from: "2026-03-10", add: { weeks: -1, days: 2 } },
      context("en"),
    );
    expect(back.content).toBe("2026-03-10 -1 wk, +2 d = 2026-03-05");
  });

  it("refuses to be given both an end and a span, or neither", async () => {
    const both = await tool("miniapps.dates").run(
      { from: "2026-10-10", to: "2026-10-20", add: { days: 1 } },
      context("en"),
    );
    expect(both.ok).toBe(false);
    const neither = await tool("miniapps.dates").run({ from: "2026-10-10" }, context("en"));
    expect(neither.ok).toBe(false);
  });

  it("refuses a day the calendar does not have, with the schema's message", async () => {
    const result = await tool("miniapps.dates").run(
      { from: "2026-02-30", to: "2026-03-01" },
      context("en"),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"from" must be a calendar day');
  });
});

describe("miniapps.counter", () => {
  it("sets a counter found by its name, and keeps every other part of the document", async () => {
    seed();
    const result = await tool("miniapps.counter").run({ name: "kafa", value: 5 }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "The counter “Kafa” is now at 5.",
      navigateTo: { module: "miniapps", item: "tally" },
    });
    const data = store().read();
    expect(data.counters).toEqual([
      { id: "kafa", name: "Kafa", value: 5, step: 1, floorZero: true },
      { id: "voda", name: "Voda", value: 12, step: 1, floorZero: false },
    ]);
    expect(data.scoreboard.players.map((player) => player.id)).toEqual(["ana", "marko"]);
    expect(data.scoreboard.rounds).toHaveLength(2);
    expect(data.cities).toEqual(["Europe/Belgrade", "America/New_York"]);
    expect(data.typing.records).toHaveLength(2);
  });

  it("asks first, in one line that names the counter and both values", async () => {
    seed();
    const asked: string[] = [];
    await tool("miniapps.counter").run({ name: "Kafa", value: 5 }, context("en", asking(true, asked)));
    expect(asked).toEqual(["Set the counter “Kafa” from 3 to 5?"]);
  });

  it("writes nothing when the user declines", async () => {
    seed();
    const result = await tool("miniapps.counter").run(
      { name: "Kafa", value: 5 },
      context("en", asking(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().read().counters[0]?.value).toBe(3);
  });

  it("refuses a name it does not find, and an ambiguous one with the candidates", async () => {
    seed();
    const missing = await tool("miniapps.counter").run({ name: "Seme", value: 1 }, context("en"));
    expect(missing).toEqual({ ok: false, content: "Failed: There is no counter “Seme”." });

    store().saveCounters(
      [
        { id: "caj", name: "Čaj", value: 1, step: 1, floorZero: false },
        { id: "caj2", name: "Caj", value: 2, step: 1, floorZero: false },
      ],
      NOW_ISO,
    );
    const ambiguous = await tool("miniapps.counter").run({ name: "caj", value: 9 }, context("en"));
    expect(ambiguous).toEqual({
      ok: false,
      content: "Failed: More than one counter has that name: “Čaj”, “Caj”. Name the one you mean.",
    });
  });

  it("answers without asking when the value is already set", async () => {
    seed();
    const asked: string[] = [];
    const result = await tool("miniapps.counter").run(
      { name: "Kafa", value: 3 },
      context("en", asking(true, asked)),
    );
    expect(result).toEqual({ ok: true, content: "The counter “Kafa” is already at 3." });
    expect(asked).toEqual([]);
  });

  it("speaks Serbian in Serbian quotes", async () => {
    seed();
    const result = await tool("miniapps.counter").run({ name: "Voda", value: 13 }, context("sr"));
    expect(result.content).toBe("Brojač „Voda“ je sada na 13.");
  });
});

describe("miniapps.city", () => {
  it("puts a zone on the clock and reveals the clock", async () => {
    seed();
    const result = await tool("miniapps.city").run({ zone: "Asia/Tokyo" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "Asia/Tokyo is on the world clock.",
      navigateTo: { module: "miniapps", item: "worldclock" },
    });
    expect(store().read().cities).toEqual(["Europe/Belgrade", "America/New_York", "Asia/Tokyo"]);
  });

  it("takes a zone off the clock, and keeps the rest of the document", async () => {
    seed();
    const asked: string[] = [];
    const result = await tool("miniapps.city").run(
      { zone: "America/New_York", remove: true },
      context("en", asking(true, asked)),
    );
    expect(result.content).toBe("America/New_York is off the world clock.");
    expect(asked).toEqual(["Take America/New_York off the world clock?"]);
    expect(store().read().cities).toEqual(["Europe/Belgrade"]);
    expect(store().read().counters).toHaveLength(2);
  });

  it("refuses a zone the runtime does not know, and one already on or off the clock", async () => {
    seed();
    const unknown = await tool("miniapps.city").run({ zone: "Mars/Olympus" }, context("en"));
    expect(unknown).toEqual({ ok: false, content: "Failed: Unknown time zone: Mars/Olympus." });
    const listed = await tool("miniapps.city").run({ zone: "Europe/Belgrade" }, context("en"));
    expect(listed.content).toBe("Failed: Europe/Belgrade is already on the world clock.");
    const absent = await tool("miniapps.city").run(
      { zone: "Asia/Tokyo", remove: true },
      context("en"),
    );
    expect(absent.content).toBe("Failed: Asia/Tokyo is not on the world clock.");
  });

  it("writes nothing when the user declines, and refuses a full clock", async () => {
    seed();
    const declined = await tool("miniapps.city").run(
      { zone: "Asia/Tokyo" },
      context("sr", asking(false)),
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(store().read().cities).toHaveLength(2);

    store().saveCities(
      [
        "Europe/Belgrade",
        "Europe/Zagreb",
        "Europe/Sarajevo",
        "Europe/Podgorica",
        "Europe/Ljubljana",
        "Europe/Vienna",
        "Europe/Budapest",
        "Europe/Prague",
        "Europe/Berlin",
        "Europe/Paris",
        "Europe/London",
        "Europe/Rome",
      ],
      NOW_ISO,
    );
    const full = await tool("miniapps.city").run({ zone: "Asia/Tokyo" }, context("en"));
    expect(full.content).toBe("Failed: The world clock holds at most 12 cities.");
  });
});
