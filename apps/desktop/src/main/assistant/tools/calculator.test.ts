import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CalculatorStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { calculatorTools } from "./calculator.js";

/**
 * The CALCULATOR tools over a real database.
 *
 * `calculate` and `remember` evaluate through the module's own engine, so these
 * tests pin what the engine's answer becomes in a tool result: the refusals by
 * name, the settings the user chose, and the history row a confirmed write
 * leaves behind. The arithmetic itself is the engine's and is tested there.
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

function tool(name = "calculator.history"): Tool {
  const found = calculatorTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  }).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
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

describe("calculator.calculate", () => {
  it("answers the engine's result for the expression as written", async () => {
    const result = await tool("calculator.calculate").run({ expression: "2+2*2" }, context("en"));
    expect(result).toEqual({ ok: true, content: "2+2*2 = 6" });
  });

  it("writes the result in the user's locale, with the exact value beside it", async () => {
    const result = await tool("calculator.calculate").run({ expression: "sin(30)" }, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: "sin(30) = 0,5\nTačna vrednost: 0.49999999999999994",
    });
  });

  it("computes in the angle mode the user has chosen", async () => {
    store().saveSettings({ angleMode: "rad", precision: "float" }, NOW_ISO);
    const result = await tool("calculator.calculate").run({ expression: "sin(30)" }, context("en"));
    expect(result.content).toMatch(/^sin\(30\) = -0\.98803/);
  });

  it("refuses a disabled function by name", async () => {
    const result = await tool("calculator.calculate").run(
      { expression: 'evaluate("2+2")' },
      context("en"),
    );
    expect(result).toEqual({
      ok: false,
      content: "Failed: The function “evaluate” is not allowed in the calculator.",
    });
  });

  it("refuses an unknown name by name", async () => {
    const result = await tool("calculator.calculate").run({ expression: "foo + 1" }, context("sr"));
    expect(result).toEqual({ ok: false, content: "Neuspešno: Nepoznato ime u izrazu: „foo“." });
  });

  it("refuses an expression that is not written correctly", async () => {
    const result = await tool("calculator.calculate").run({ expression: "2+" }, context("en"));
    expect(result).toEqual({
      ok: false,
      content: "Failed: The expression is not written correctly.",
    });
  });

  it("refuses a call without an expression", async () => {
    const result = await tool("calculator.calculate").run({}, context("en"));
    expect(result.ok).toBe(false);
  });
});

describe("calculator.remember", () => {
  it("asks first, then saves the row the page would save", async () => {
    const asked: string[] = [];
    const result = await tool("calculator.remember").run(
      { expression: "2+2*2" },
      context("en", ({ summary, tool: name, effect }) => {
        asked.push(`${name} ${effect} ${summary}`);
        return Promise.resolve(true);
      }),
    );

    expect(asked).toEqual([
      "calculator.remember write Save “2+2*2” = 6 to the calculator's history?",
    ]);
    expect(result).toEqual({
      ok: true,
      content: "Saved to the calculator's history: 2+2*2 = 6",
      navigateTo: { module: "calculator" },
    });
    const [entry] = store().listHistory();
    expect(entry).toMatchObject({ expression: "2+2*2", result: "6", value: "6", pinned: false });
  });

  it("writes nothing when the user declines", async () => {
    const result = await tool("calculator.remember").run(
      { expression: "2+2*2" },
      context("en", () => Promise.resolve(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listHistory()).toEqual([]);
  });

  it("does not ask about an expression the engine refuses", async () => {
    let asked = false;
    const result = await tool("calculator.remember").run(
      { expression: 'evaluate("2+2")' },
      context("en", () => {
        asked = true;
        return Promise.resolve(true);
      }),
    );
    expect(result.ok).toBe(false);
    expect(asked).toBe(false);
    expect(store().listHistory()).toEqual([]);
  });
});
