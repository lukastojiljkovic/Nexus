import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CalculatorStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { calculatorTools } from "./calculator.js";

/**
 * The CALCULATOR tool over a real database.
 *
 * It reads history and computes nothing — the engine is the module's, and it is
 * the only place in this application an expression is evaluated — so what this
 * suite pins is that both halves of a row come back as they were stored, with
 * the pinned flag beside them.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-calculator-"));
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

function store(): CalculatorStore {
  return new CalculatorStore(db.raw, profileId);
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
  const found = calculatorTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === "calculator.history",
  );
  if (found === undefined) throw new Error('Test setup: no tool "calculator.history".');
  return found;
}

/** One evaluation, as the module's own worker would have stored it. */
function seed(expression: string, result: string, value: string, at: string): string {
  return store().addEntry({ expression, result, value }, at).id;
}

describe("calculator.history", () => {
  it("reads the expressions and the results the engine produced, newest first", async () => {
    seed("2+2", "4", "4", NOW_ISO);
    seed("120/4", "30", "30", new Date(NOW_MS + 60_000).toISOString());

    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Poslednji rezultati (2):",
        "- 120/4 = 30",
        "- 2+2 = 4",
      ].join("\n"),
    });
  });

  it("marks a pinned entry, and filters by what the user typed", async () => {
    const pinned = seed("100*1,18", "118", "118", NOW_ISO);
    store().setPinned(pinned, true, NOW_ISO);
    // A minute later, so "newest first" is a fact about the rows rather than
    // about which of two identical instants SQLite returned first.
    seed("5+5", "10", "10", new Date(NOW_MS + 60_000).toISOString());

    const all = await tool().run({}, context("en"));
    expect(all.content).toBe(
      ["Recent results (2):", "- 5+5 = 10", "- 100*1,18 = 118, pinned"].join("\n"),
    );

    const filtered = await tool().run({ query: "100" }, context("en"));
    expect(filtered.content).toBe(["Recent results (1):", "- 100*1,18 = 118, pinned"].join("\n"));
  });

  it("says the history is empty rather than answering with nothing", async () => {
    const result = await tool().run({}, context("sr"));
    expect(result).toEqual({ ok: true, content: "Istorija kalkulatora je prazna." });
  });
});
