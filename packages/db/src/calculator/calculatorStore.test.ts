import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalculatorSession } from "@nexus/core";
import type { CalculatorSettings } from "../index.js";
import {
  MAX_CALCULATOR_VALUE_LENGTH,
  MAX_EXPRESSION_LENGTH,
  createCalculatorEngine,
} from "@nexus/core";
import {
  CALC_HISTORY_UNPINNED_LIMIT,
  CalcHistoryNotFoundError,
  CalculatorStore,
  CalculatorValidationError,
  DEFAULT_CALCULATOR_SETTINGS,
  MAX_CALC_HISTORY_RESULT_LENGTH,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-10-09T08:00:00.000Z";
const LATER = "2026-10-09T09:30:00.000Z";

const SETTINGS: CalculatorSettings = { angleMode: "rad", precision: "bignumber" };

const SESSION: CalculatorSession = {
  version: 1,
  variables: { x: "5" },
  functions: { f: { params: ["x"], body: "x ^ 2 + 1" } },
  ans: "10",
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-calc-"));
  db = openDatabase({ path: join(dir, "calculator.db") });
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

function store(profileId = createProfile()): CalculatorStore {
  return new CalculatorStore(db.raw, profileId);
}

/**
 * A distinct moment per row. The store orders by `created_at`, and rows written
 * inside one millisecond would otherwise be ordered by an id whose tail is
 * random — a test that depends on that is a test that fails on Tuesdays.
 */
function at(secondsAfterNow: number): string {
  return new Date(Date.parse(NOW) + secondsAfterNow * 1000).toISOString();
}

describe("CalculatorStore history", () => {
  it("stores an entry and hands it back with its bookkeeping filled in", () => {
    const profileId = createProfile();
    const calculator = new CalculatorStore(db.raw, profileId);
    const entry = calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);

    expect(entry).toMatchObject({
      profileId,
      expression: "1 + 1",
      result: "2",
      value: "2",
      pinned: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(entry.id).toHaveLength(36);
    expect(calculator.listHistory()).toEqual([entry]);
  });

  it("trims outer whitespace, which no expression treats as meaningful", () => {
    const calculator = store();
    const entry = calculator.addEntry({ expression: "  2 * 3  ", result: " 6 ", value: "6" }, NOW);
    expect(entry.expression).toBe("2 * 3");
    expect(entry.result).toBe("6");
  });

  it("reads newest first, and honours a limit", () => {
    const calculator = store();
    const first = calculator.addEntry({ expression: "1", result: "1", value: "1" }, NOW);
    const second = calculator.addEntry({ expression: "2", result: "2", value: "2" }, LATER);

    expect(calculator.listHistory().map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(calculator.listHistory({ limit: 1 }).map((entry) => entry.id)).toEqual([second.id]);
  });

  it("refuses an expression or a result the column could not hold", () => {
    const calculator = store();
    const bad = [
      { expression: "", result: "2", value: "2" },
      { expression: "   ", result: "2", value: "2" },
      { expression: "1".repeat(MAX_EXPRESSION_LENGTH + 1), result: "2", value: "2" },
      { expression: "1", result: "", value: "1" },
      { expression: "1", result: "2".repeat(MAX_CALC_HISTORY_RESULT_LENGTH + 1), value: "2" },
      { expression: "1", result: "2", value: "2".repeat(MAX_CALCULATOR_VALUE_LENGTH + 1) },
    ];
    for (const input of bad) {
      expect(() => calculator.addEntry(input, NOW)).toThrow(CalculatorValidationError);
    }
    expect(() => calculator.listHistory({ limit: 0 })).toThrow(CalculatorValidationError);
    expect(() => calculator.addEntry({ expression: "1", result: "1", value: "1" }, "not a date")).toThrow(
      CalculatorValidationError,
    );
    expect(calculator.listHistory()).toEqual([]);
  });

  it("keeps only the newest unpinned entries, and evicts in the same write", () => {
    const calculator = store();
    for (let index = 0; index <= CALC_HISTORY_UNPINNED_LIMIT; index += 1) {
      calculator.addEntry({ expression: `1 + ${index}`, result: String(index + 1), value: String(index + 1) }, at(index));
    }
    const history = calculator.listHistory();
    expect(history).toHaveLength(CALC_HISTORY_UNPINNED_LIMIT);
    // The FIRST row written is the one that went; the newest is still here.
    expect(history.some((entry) => entry.expression === "1 + 0")).toBe(false);
    expect(history[0]?.expression).toBe(`1 + ${CALC_HISTORY_UNPINNED_LIMIT}`);
  });

  it("never evicts a pinned entry, however many unpinned ones arrive", () => {
    const calculator = store();
    const pinned = calculator.addEntry({ expression: "42", result: "42", value: "42" }, NOW);
    calculator.setPinned(pinned.id, true, NOW);
    for (let index = 0; index <= CALC_HISTORY_UNPINNED_LIMIT + 5; index += 1) {
      calculator.addEntry({ expression: `1 + ${index}`, result: String(index + 1), value: String(index + 1) }, LATER);
    }
    const history = calculator.listHistory();
    expect(history.map((entry) => entry.id)).toContain(pinned.id);
    expect(history.filter((entry) => !entry.pinned)).toHaveLength(CALC_HISTORY_UNPINNED_LIMIT);
  });

  it("pins, unpins, and refuses an id it does not have", () => {
    const calculator = store();
    const entry = calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);

    expect(calculator.setPinned(entry.id, true, LATER)).toMatchObject({
      pinned: true,
      updatedAt: LATER,
    });
    expect(calculator.setPinned(entry.id, false, LATER).pinned).toBe(false);
    expect(() => calculator.setPinned(uuidv7(), true, LATER)).toThrow(CalcHistoryNotFoundError);
  });

  it("removes one entry, and treats removing one that is gone as done", () => {
    const calculator = store();
    const entry = calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);
    calculator.removeEntry(entry.id);
    expect(calculator.listHistory()).toEqual([]);
    expect(() => calculator.removeEntry(entry.id)).not.toThrow();
  });

  it("clears the history, optionally keeping what is pinned, and counts what went", () => {
    const calculator = store();
    const kept = calculator.addEntry({ expression: "42", result: "42", value: "42" }, NOW);
    calculator.setPinned(kept.id, true, NOW);
    calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);
    calculator.addEntry({ expression: "2 + 2", result: "4", value: "4" }, NOW);

    expect(calculator.clearHistory({ keepPinned: true })).toBe(2);
    expect(calculator.listHistory().map((entry) => entry.id)).toEqual([kept.id]);
    expect(calculator.clearHistory()).toBe(1);
    expect(calculator.listHistory()).toEqual([]);
  });

  it("scopes every read and write to its own profile", () => {
    const mine = store();
    const theirs = store();
    const entry = mine.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);

    expect(theirs.listHistory()).toEqual([]);
    expect(() => theirs.setPinned(entry.id, true, NOW)).toThrow(CalcHistoryNotFoundError);
    expect(theirs.clearHistory()).toBe(0);
    theirs.removeEntry(entry.id);
    expect(mine.listHistory()).toHaveLength(1);
  });
});

describe("CalculatorStore session", () => {
  it("answers an empty session for a profile that never saved one", () => {
    expect(store().getSession()).toEqual({
      version: 1,
      variables: {},
      functions: {},
      ans: null,
    });
  });

  it("saves a session and reads it back whole", () => {
    const calculator = store();
    expect(calculator.saveSession(SESSION, NOW)).toEqual(SESSION);
    expect(calculator.getSession()).toEqual(SESSION);
  });

  it("refuses a session the engine could not have produced", () => {
    const calculator = store();
    const bad = [
      { ...SESSION, version: 2 },
      { ...SESSION, variables: { x: 5 } },
      { ...SESSION, functions: { f: { params: [], body: "x" } } },
      "not a session",
      null,
    ];
    for (const value of bad) {
      expect(() => calculator.saveSession(value as CalculatorSession, NOW)).toThrow(
        CalculatorValidationError,
      );
    }
    expect(() => calculator.saveSession(SESSION, "yesterday")).toThrow(CalculatorValidationError);
    expect(calculator.getSession()).toEqual({ version: 1, variables: {}, functions: {}, ans: null });
  });

  it("throws on a column that no longer parses, and a clear is the way out", () => {
    // Corruption is reported rather than read as an empty session: silently
    // discarding somebody's variables is the worse of the two failures.
    const profileId = createProfile();
    db.raw
      .prepare(
        "INSERT INTO calc_sessions (profile_id, session, updated_at) VALUES (?, ?, ?)",
      )
      .run(profileId, "{not json", NOW);
    const calculator = new CalculatorStore(db.raw, profileId);

    expect(() => calculator.getSession()).toThrow(CalculatorValidationError);
    calculator.clearSession();
    expect(calculator.getSession()).toEqual({ version: 1, variables: {}, functions: {}, ans: null });
  });
});

describe("CalculatorStore settings", () => {
  it("answers the engine's own defaults for a profile that never set one", () => {
    // The expected value is DERIVED from the engine's constants rather than typed
    // twice: `DEFAULT_CALCULATOR_SETTINGS` is what `settings()` promises, and the
    // literal beside it says which two values the engine actually opens on
    // (`engine.ts`: DEG, and the float mode a calculator shows a price in).
    expect(store().settings()).toEqual(DEFAULT_CALCULATOR_SETTINGS);
    expect(DEFAULT_CALCULATOR_SETTINGS).toEqual({ angleMode: "deg", precision: "float" });
  });

  it("saves both preferences, reads them back, and forgets them on a clear", () => {
    const calculator = store();
    expect(calculator.saveSettings(SETTINGS, NOW)).toEqual(SETTINGS);
    expect(calculator.settings()).toEqual(SETTINGS);
    calculator.clearSettings();
    expect(calculator.settings()).toEqual(DEFAULT_CALCULATOR_SETTINGS);
  });

  it("refuses a mode the engine does not have, writing nothing", () => {
    const calculator = store();
    const bad = [
      { angleMode: "turn", precision: "float" },
      { angleMode: "deg", precision: "double" },
      { angleMode: "deg" },
      { angleMode: 90, precision: "float" },
      "not settings",
      null,
    ];
    for (const value of bad) {
      expect(() => calculator.saveSettings(value as CalculatorSettings, NOW)).toThrow(
        CalculatorValidationError,
      );
    }
    expect(() => calculator.saveSettings(SETTINGS, "yesterday")).toThrow(CalculatorValidationError);
    expect(calculator.settings()).toEqual(DEFAULT_CALCULATOR_SETTINGS);
  });

  it("scopes the row to its own profile", () => {
    const mine = store();
    const theirs = store();
    mine.saveSettings(SETTINGS, NOW);
    expect(theirs.settings()).toEqual(DEFAULT_CALCULATOR_SETTINGS);
  });

  it("travels in the export, and a file whose settings are not one is refused whole", () => {
    const calculator = store();
    calculator.saveSettings(SETTINGS, NOW);
    expect(calculator.exportData().settings).toEqual(SETTINGS);

    expect(() =>
      calculator.importData(
        { version: 1, history: [], session: SESSION, settings: { angleMode: "turn" } },
        NOW,
      ),
    ).toThrow(CalculatorValidationError);
    // Refused BEFORE anything was written, so the profile still has its own row.
    expect(calculator.settings()).toEqual(SETTINGS);
  });
});

describe("CalculatorStore export and import", () => {
  it("round-trips the history, the session and the settings through JSON", () => {
    const calculator = store();
    const pinned = calculator.addEntry({ expression: "42", result: "42", value: "42" }, NOW);
    calculator.setPinned(pinned.id, true, LATER);
    calculator.addEntry({ expression: "2 + 2", result: "4", value: "4" }, LATER);
    calculator.saveSession(SESSION, NOW);
    calculator.saveSettings(SETTINGS, NOW);

    const exported = calculator.exportData();
    expect(exported.version).toBe(1);
    // Oldest first, which is the order an archive reads and replays.
    expect(exported.history.map((entry) => entry.expression)).toEqual(["42", "2 + 2"]);
    expect(exported.session).toEqual(SESSION);
    expect(exported.settings).toEqual(SETTINGS);

    const target = store();
    // The value goes back in the way an archive would hand it over: through
    // JSON, and with main's own clock beside it.
    target.importData(JSON.parse(JSON.stringify(exported)), LATER);
    expect(target.exportData()).toEqual(exported);
    expect(target.getSession()).toEqual(SESSION);
  });

  it("replaces whatever the profile had, in one transaction", () => {
    const calculator = store();
    calculator.addEntry({ expression: "staro", result: "1", value: "1" }, NOW);
    calculator.saveSession(SESSION, NOW);

    calculator.importData({ version: 1, history: [], session: { version: 1, variables: {}, functions: {}, ans: null }, settings: SETTINGS }, NOW);
    expect(calculator.listHistory()).toEqual([]);
    expect(calculator.getSession()).toEqual({ version: 1, variables: {}, functions: {}, ans: null });
  });

  it("refuses an unknown version before it writes anything", () => {
    const calculator = store();
    const existing = calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);
    expect(() => calculator.importData({ version: 2, history: [], session: SESSION, settings: SETTINGS }, NOW)).toThrow(
      CalculatorValidationError,
    );
    expect(calculator.listHistory()).toEqual([existing]);
  });

  it("refuses a whole value with one bad row, and leaves the profile untouched", () => {
    const calculator = store();
    const existing = calculator.addEntry({ expression: "1 + 1", result: "2", value: "2" }, NOW);
    const history = [
      { expression: "3 + 3", result: "6", value: "6", pinned: false, createdAt: NOW, updatedAt: NOW },
      { expression: "", result: "6", value: "6", pinned: false, createdAt: NOW, updatedAt: NOW },
    ];
    expect(() => calculator.importData({ version: 1, history, session: SESSION, settings: SETTINGS }, NOW)).toThrow(
      CalculatorValidationError,
    );
    expect(calculator.listHistory()).toEqual([existing]);
    expect(calculator.getSession().ans).toBeNull();
  });

  it("refuses a value whose session is not one, and a history that is not a list", () => {
    const calculator = store();
    expect(() =>
      calculator.importData(
        { version: 1, history: [], session: { version: 1, variables: { x: 1 } }, settings: SETTINGS },
        NOW,
      ),
    ).toThrow(CalculatorValidationError);
    expect(() =>
      calculator.importData({ version: 1, history: "none", session: SESSION, settings: SETTINGS }, NOW),
    ).toThrow(CalculatorValidationError);
    expect(() => calculator.importData(null, NOW)).toThrow(CalculatorValidationError);
  });

  it("keeps the store's own cap after an import, so a hand-written file cannot fill the table", () => {
    const calculator = store();
    const history = Array.from({ length: CALC_HISTORY_UNPINNED_LIMIT + 10 }, (_, index) => ({
      expression: `1 + ${index}`,
      result: String(index + 1),
      value: String(index + 1),
      pinned: false,
      createdAt: at(index),
      updatedAt: at(index),
    }));
    calculator.importData({ version: 1, history, session: SESSION, settings: SETTINGS }, NOW);

    const stored = calculator.listHistory();
    expect(stored).toHaveLength(CALC_HISTORY_UNPINNED_LIMIT);
    expect(stored.some((entry) => entry.expression === "1 + 0")).toBe(false);
  });

  it("keeps the engine's own lexical value beside the display string, through JSON", () => {
    // The ENGINE is the oracle here, not a hand-written pair: what is asserted
    // is that the store hands back the very two texts the engine produced, so a
    // `#3` reuse substitutes the number the row is showing rather than a rounded
    // copy of it. `1000 / 3` is the case that makes the difference visible - the
    // decimal expansion does not terminate, and the display rounds it to fifteen
    // significant digits while `value` keeps mathjs's own reprisal.
    const outcome = createCalculatorEngine("float").evaluate("1000 / 3");
    if (!outcome.ok) throw new Error("the engine refused 1000 / 3");
    expect(outcome.value).not.toBe(outcome.display);

    const source = store();
    source.addEntry(
      { expression: "1000 / 3", result: outcome.display, value: outcome.value },
      NOW,
    );

    const target = store();
    target.importData(JSON.parse(JSON.stringify(source.exportData())), LATER);
    const [row] = target.listHistory();
    expect(row?.result).toBe(outcome.display);
    expect(row?.value).toBe(outcome.value);
    // Two texts, and the locale's separator is what tells them apart: the reader's
    // form uses the Serbian decimal comma, the value uses mathjs's own point.
    expect(row?.value).toContain(".");
    expect(row?.value).not.toContain(",");
  });

  it("brings a pinned entry from an archive across as pinned", () => {
    const calculator = store();
    calculator.importData({
      version: 1,
      history: [{ expression: "42", result: "42", value: "42", pinned: true, createdAt: NOW, updatedAt: LATER }],
      session: SESSION,
      settings: SETTINGS,
    }, NOW);
    expect(calculator.listHistory()).toEqual([
      expect.objectContaining({ expression: "42", pinned: true, createdAt: NOW, updatedAt: LATER }),
    ]);
  });
});
