import { describe, expect, it } from "vitest";
import {
  CORE_TOOLS,
  MAX_TOOLS_PER_TURN,
  chooseTools,
  toolSpecCharacters,
  toolSpecTokens,
  type ToolChoiceInput,
} from "./toolChoice.js";
import type { JsonSchema, ToolSpec } from "./contract.js";

/**
 * The chooser: what fits, what is scored, and what order the answer keeps.
 *
 * The fixtures are small on purpose - a reader can redo every budget below by
 * hand - except the property test at the end, whose whole point is that no
 * hand-picked budget finds a hole in the walk.
 */

const EMPTY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

const spec = (
  name: string,
  sr: string,
  en: string,
  parameters: JsonSchema = EMPTY_SCHEMA,
): ToolSpec => ({ name, description: { sr, en }, parameters, effect: "read" });

const appSearch = spec(
  "app.search",
  "Pokreće globalnu pretragu aplikacije.",
  "Runs the app's global search.",
);
const appOpen = spec(
  "app.open",
  "Otvara stranicu u aplikaciji.",
  "Opens a page in the app.",
);
const tasksList = spec(
  "tasks.list",
  "Izlistava otvorene zadatke sa rokovima i listama.",
  "Lists the open tasks with their due dates and lists.",
);
const tasksCreate = spec(
  "tasks.create",
  "Dodaje novi zadatak sa naslovom i rokom.",
  "Creates a new task from a title.",
);
const notesAppend = spec(
  "notes.append",
  "Dodaje tekst na kraj beleške.",
  "Appends text to the end of a note.",
);
const notesList = spec(
  "notes.list",
  "Izlistava beleške po datumu.",
  "Lists the notes by date.",
);
const calendarEvents = spec(
  "calendar.events",
  "Izlistava događaje iz kalendara.",
  "Lists the events from the calendar.",
);

/** The five tools most statements below are about, in registry order. */
const SMALL: readonly ToolSpec[] = [appSearch, appOpen, tasksList, tasksCreate, notesAppend];

const cost = (tools: readonly ToolSpec[]): number => tools.reduce((sum, tool) => sum + toolSpecTokens(tool), 0);
const names = (chosen: readonly ToolSpec[]): readonly string[] => chosen.map((tool) => tool.name);

const choice = (input: Partial<ToolChoiceInput> & { readonly tools: readonly ToolSpec[] }): ToolChoiceInput => ({
  query: "",
  earlier: [],
  recent: [],
  budgetTokens: 10_000,
  ...input,
});

describe("toolSpecTokens", () => {
  it("counts the name, the English description and the schema, plus the template's allowance", () => {
    const characters = toolSpecCharacters(tasksList);
    expect(characters).toBe(
      "tasks.list".length + tasksList.description.en.length + JSON.stringify(tasksList.parameters).length,
    );
    // 2.1 characters per token - the lower, conservative JSON ratio - and 16
    // tokens of per-function scaffolding: ceil(characters / 2.1) + 16.
    expect(toolSpecTokens(tasksList)).toBe(Math.ceil(characters / 2.1) + 16);
  });
});

describe("chooseTools", () => {
  it("hands a set that is small enough and cheap enough on whole, in its own order", () => {
    expect(chooseTools(choice({ tools: SMALL }))).toBe(SMALL);
  });

  it("returns the answer in registry order, not in the walk's order", () => {
    const against: readonly ToolSpec[] = [appSearch, appOpen, tasksList, tasksCreate];
    // One token under the whole set, so the fast path cannot apply and the walk
    // is what decided - and the walk visits tasks.create (the scored tool)
    // before the two core tools that sit earlier in the registry.
    const chosen = chooseTools(
      choice({ tools: against, query: "Dodaj zadatak za sutra", budgetTokens: cost(against) - 1 }),
    );
    const indices = names(chosen).map((name) => against.findIndex((tool) => tool.name === name));
    expect(indices).toEqual([...indices].sort((left, right) => left - right));
    expect(names(chosen)[0]).toBe("app.search");
    expect(names(chosen)).toContain("tasks.create");
  });

  it("scores Serbian inflection: 'zadatak' answers to a tool that says 'zadatke'", () => {
    // "zadatak" is not "zadatke", and the two share "zadat" - five characters,
    // above the four-character floor - which is the whole of the stemming here.
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "Dodaj zadatak za sutra", budgetTokens: toolSpecTokens(tasksCreate) }),
    );
    expect(names(chosen)).toEqual(["tasks.create"]);
  });

  it("scores English plurals: 'what tasks are due' picks the tool that says 'due dates'", () => {
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "what tasks are due", budgetTokens: toolSpecTokens(tasksList) }),
    );
    expect(names(chosen)).toEqual(["tasks.list"]);
  });

  it("keeps the tool of the last turn for a follow-up that names no subject", () => {
    const chosen = chooseTools(
      choice({
        tools: SMALL,
        query: "i jos jedan",
        recent: ["notes.append"],
        budgetTokens: toolSpecTokens(notesAppend),
      }),
    );
    expect(names(chosen)).toEqual(["notes.append"]);
  });

  it("reads the newest of the earlier messages, and stops after two", () => {
    // notes.list is first in the registry, so it would win the tie if the third
    // message - the one that names "beleške" - were read at all.
    const registry: readonly ToolSpec[] = [notesList, notesAppend, calendarEvents, tasksList, appSearch, appOpen];
    const chosen = chooseTools(
      choice({
        tools: registry,
        query: "i to sada",
        earlier: ["koliko zadataka imam", "koliko događaj imam", "koliko beleška imam"],
        budgetTokens: toolSpecTokens(calendarEvents),
      }),
    );
    expect(names(chosen)).toEqual(["calendar.events"]);
  });

  it("offers the core tools when nothing scores and the budget allows", () => {
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "zdravo", budgetTokens: toolSpecTokens(appSearch) + toolSpecTokens(appOpen) }),
    );
    expect(names(chosen)).toEqual([...CORE_TOOLS]);
  });

  it("stays the same for the same input, which is what keeps a prompt prefix stable", () => {
    const input = choice({ tools: SMALL, query: "Sta imam za zadatak", budgetTokens: 150 });
    expect(names(chooseTools(input))).toEqual(names(chooseTools(input)));
  });
});

describe("the budget and the cap, over many budgets", () => {
  /** Twenty tools whose schemas differ in size, so a budget lands somewhere among them. */
  const MANY: readonly ToolSpec[] = Array.from({ length: 20 }, (_unused, index) =>
    spec(
      `area${String(index)}.verb${String(index)}`,
      `Alatka broj ${String(index)}.`,
      `Tool number ${String(index)} that does one thing.`,
      {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200, description: "x".repeat(index * 3) },
        },
        required: ["query"],
        additionalProperties: false,
      },
    ),
  );
  const total = cost(MANY);

  /** A plain LCG: the budgets are many and varied, and the same ones on every run. */
  function pseudoRandomBudgets(count: number): readonly number[] {
    let state = 0x2f6e2b1;
    const out: number[] = [];
    for (let index = 0; index < count; index += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      out.push(state % (total + 64));
    }
    return out;
  }

  const budgets = [
    0, 1, 16, 17, total,
    ...Array.from({ length: Math.ceil((total + 64) / 13) }, (_unused, index) => index * 13),
    ...pseudoRandomBudgets(200),
  ];

  it("never costs more than the budget, never offers more than the cap, and keeps registry order", () => {
    for (const budgetTokens of budgets) {
      const chosen = chooseTools(choice({ tools: MANY, query: "tool number one", budgetTokens }));
      const indices = chosen.map((tool) => MANY.indexOf(tool));
      expect(cost(chosen), `budget ${String(budgetTokens)}`).toBeLessThanOrEqual(budgetTokens);
      expect(chosen.length, `budget ${String(budgetTokens)}`).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
      expect(indices, `budget ${String(budgetTokens)}`).toEqual([...indices].sort((left, right) => left - right));
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it("takes the cap, not one more, when the budget would allow everything", () => {
    expect(chooseTools(choice({ tools: MANY, query: "tool number one", budgetTokens: total }))).toHaveLength(
      MAX_TOOLS_PER_TURN,
    );
  });
});
