import { describe, expect, it } from "vitest";
import {
  CORE_TOOLS,
  LOCATION_TOOL_LIMIT,
  MAX_TOOLS_PER_TURN,
  chooseTools,
  earlierUserMessages,
  recentSuccessfulTools,
  toolSpecCharacters,
  toolSpecTokens,
  type ToolChoiceInput,
} from "./toolChoice.js";
import type { ChatMessage, JsonSchema, ToolSpec } from "./contract.js";

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
      `Tool number ${String(index)} that does ${index % 2 === 0 ? "even" : "odd"} things.`,
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
      const chosen = chooseTools(choice({ tools: MANY, query: "tool even", budgetTokens }));
      const indices = chosen.map((tool) => MANY.indexOf(tool));
      expect(cost(chosen), `budget ${String(budgetTokens)}`).toBeLessThanOrEqual(budgetTokens);
      expect(chosen.length, `budget ${String(budgetTokens)}`).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
      expect(indices, `budget ${String(budgetTokens)}`).toEqual([...indices].sort((left, right) => left - right));
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it("takes the cap, not one more, when the budget would allow everything", () => {
    expect(chooseTools(choice({ tools: MANY, query: "tool even", budgetTokens: total }))).toHaveLength(
      MAX_TOOLS_PER_TURN,
    );
  });
});

describe("the open page comes first", () => {
  it("offers the open module's tools before the question's own", () => {
    // Both tools cost one budget share each; tasks.create is what the question
    // names, notes.append is what the page is about.
    const chosen = chooseTools(
      choice({
        tools: SMALL,
        query: "Dodaj zadatak za sutra",
        location: "notes",
        budgetTokens: toolSpecTokens(notesAppend) + toolSpecTokens(tasksCreate),
      }),
    );
    expect(names(chosen)).toContain("notes.append");
    expect(names(chosen)).toContain("tasks.create");
    expect(names(chosen)).not.toContain("app.open");
  });

  it("offers at most LOCATION_TOOL_LIMIT of the open module's tools ahead of the core tools", () => {
    const notes = Array.from({ length: LOCATION_TOOL_LIMIT + 2 }, (_unused, index) =>
      spec(`notes.verb${String(index)}`, `Beleška ${String(index)}.`, `Note verb ${String(index)}.`),
    );
    const tools = [appSearch, appOpen, ...notes];
    // Room for the three first note tools and one more: the fourth tool is the
    // first core tool, not the fourth note, because the page's own tools are
    // capped at three.
    const chosen = chooseTools(
      choice({
        tools,
        query: "",
        location: "notes",
        budgetTokens: cost(notes.slice(0, LOCATION_TOOL_LIMIT)) + toolSpecTokens(appSearch),
      }),
    );
    expect(names(chosen)).toEqual([
      "app.search",
      "notes.verb0",
      "notes.verb1",
      "notes.verb2",
    ]);
  });

  it("adds nothing for a location with no tools", () => {
    const input = choice({ tools: SMALL, query: "zdravo", budgetTokens: 200 });
    expect(names(chooseTools({ ...input, location: "chess" }))).toEqual(names(chooseTools(input)));
  });
});

describe("the Serbian words of the question", () => {
  it("folds Cyrillic to Latin: 'Додај задатак' finds the Latin description", () => {
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "Додај задатак", budgetTokens: toolSpecTokens(tasksCreate) }),
    );
    expect(names(chosen)).toEqual(["tasks.create"]);
  });

  it("folds Cyrillic inflection the same way: 'белешке' finds 'beleške'", () => {
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "белешке", budgetTokens: toolSpecTokens(notesAppend) }),
    );
    expect(names(chosen)).toEqual(["notes.append"]);
  });

  it("folds diacritics: 'beleske' without the carons finds 'beleške'", () => {
    const chosen = chooseTools(
      choice({ tools: SMALL, query: "beleske", budgetTokens: toolSpecTokens(notesAppend) }),
    );
    expect(names(chosen)).toEqual(["notes.append"]);
  });
});

describe("recentSuccessfulTools", () => {
  const call = (id: string, name: string): ChatMessage => ({
    role: "assistant",
    content: "",
    toolCalls: [{ id, name, arguments: {} }],
  });
  const result = (toolCallId: string, ok: boolean): ChatMessage => ({
    role: "tool",
    content: ok ? "Dodato." : "Nije.",
    toolCallId,
    ok,
  });
  const user = (content: string): ChatMessage => ({ role: "user", content });

  it("reads the last two turns, newest call first, and no older one", () => {
    const history: ChatMessage[] = [
      user("prvo"), call("a", "tasks.list"), result("a", true),
      user("drugo"), call("b", "notes.append"), result("b", true), call("c", "tasks.create"), result("c", true),
      user("trece"), call("d", "calendar.events"), result("d", true),
    ];
    expect(recentSuccessfulTools(history)).toEqual(["calendar.events", "tasks.create", "notes.append"]);
  });

  it("leaves out a call whose result did not say ok", () => {
    const history: ChatMessage[] = [
      user("zadatak"), call("a", "tasks.create"), result("a", false),
      user("i jos jedan"), call("b", "notes.append"), result("b", true),
    ];
    expect(recentSuccessfulTools(history)).toEqual(["notes.append"]);
  });

  it("is empty for a history with no calls", () => {
    expect(recentSuccessfulTools([user("zdravo")])).toEqual([]);
  });
});

describe("earlierUserMessages", () => {
  it("returns the user's messages newest first and ignores the rest", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "prvo" },
      { role: "assistant", content: "odgovor" },
      { role: "user", content: "drugo" },
    ];
    expect(earlierUserMessages(history)).toEqual(["drugo", "prvo"]);
  });
});

describe("the meaning score", () => {
  it("is a no-op when there is none: an empty map chooses what no map chooses", () => {
    const input = choice({ tools: SMALL, query: "Sta imam za zadatak", budgetTokens: 150 });
    expect(names(chooseTools({ ...input, meaning: new Map() }))).toEqual(names(chooseTools(input)));
  });

  it("lets a tool the meaning matches outrank a question with no shared word", () => {
    const chosen = chooseTools(
      choice({
        tools: SMALL,
        query: "zdravo",
        meaning: new Map([["notes.append", 1]]),
        budgetTokens: toolSpecTokens(notesAppend),
      }),
    );
    expect(names(chosen)).toEqual(["notes.append"]);
  });

  it("ignores a similarity below the floor, so it cannot drown the lexical answer", () => {
    const chosen = chooseTools(
      choice({
        tools: SMALL,
        query: "zdravo",
        meaning: new Map([["notes.append", 0.2]]),
        budgetTokens: toolSpecTokens(appSearch),
      }),
    );
    expect(names(chosen)).toEqual(["app.search"]);
  });
});

describe("the choice at scale", () => {
  /**
   * Two hundred tools with descriptions and schemas of the length the registry
   * has (about 150 characters each way, three or four properties), so the budget
   * and the cap have to hold on a menu far larger than the one the app ships.
   */
  const LARGE: readonly ToolSpec[] = Array.from({ length: 200 }, (_unused, index) =>
    spec(
      `area${String(index % 25)}.verb${String(index)}`,
      `Izlistava stavku broj ${String(index)} iz oblasti, sa filterom po datumu i nazivu, kada korisnik traži pregled svojih podataka i rezultata tog dana.`,
      `Lists item number ${String(index)} from the area, with a filter by date and by name, when the user asks for an overview of their data and results for that day.`,
      {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200, description: "The title to match, case-insensitive." },
          from: { type: "string", format: "date", description: "The first day to include, YYYY-MM-DD." },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["title"],
        additionalProperties: false,
      },
    ),
  );

  it("holds the cap and the budget on two hundred tools, and chooses in under the bound", () => {
    const budgetTokens = 2_900;
    const started = performance.now();
    const chosen = chooseTools(
      choice({ tools: LARGE, query: "Pokaži mi zadatke za danas", earlier: ["koliko zadataka imam"], budgetTokens }),
    );
    const elapsed = performance.now() - started;
    expect(chosen.length).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
    expect(cost(chosen)).toBeLessThanOrEqual(budgetTokens);
    // Measured on the development machine with `performance.now`; the bound is
    // generous on purpose, so a slow CI runner does not turn it into a flake.
    expect(elapsed).toBeLessThan(200);
  });
});
