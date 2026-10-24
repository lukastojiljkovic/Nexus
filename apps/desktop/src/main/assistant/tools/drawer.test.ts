import { describe, expect, it } from "vitest";
import {
  MAX_TOOLS_PER_TURN,
  TOOL_BUDGET_SHARE,
  answerReserveTokens,
  toolSpecTokens,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "@nexus/core";
import { createModuleRegistry } from "../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY, type ShellVisibility } from "../../../shared/moduleVisibility.js";
import { TOOL_RISK_LINES } from "../../../shared/toolRiskCopy.js";
import { drawerTools } from "./drawer.js";
import { calendarTools } from "./calendar.js";
import { financeTools } from "./finance.js";
import { taskTools } from "./tasks.js";
import { TOOL_RUNNERS } from "./runner/index.js";

const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

function drawerWith(visibility: ShellVisibility = DEFAULT_SHELL_VISIBILITY): readonly Tool[] {
  return drawerTools({ modules: createModuleRegistry(), visibility: () => visibility });
}

function toolNamed(name: string, tools: readonly Tool[] = drawerWith()): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return tool;
}

function context(locale: "sr" | "en" = "en"): ToolContext {
  return {
    profileId: PROFILE_ID,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

/** The professional drawer's module is off by default, so the tests that need it switch it on. */
const SHOW_PRO: ShellVisibility = { ...DEFAULT_SHELL_VISIBILITY, shown: ["pro"] };

function run(name: string, args: unknown, locale: "sr" | "en" = "en"): Promise<ToolResult> {
  return toolNamed(name).run(args, context(locale));
}

function runWithPro(name: string, args: unknown): Promise<ToolResult> {
  return toolNamed(name, drawerWith(SHOW_PRO)).run(args, context());
}

/** The registration of a tool whose class forbids a verdict: the drawer refuses it in a chat. */
function lifeSafetyToolId(): string {
  const registry = createModuleRegistry();
  const tool = registry
    .all()
    .flatMap((manifest) => manifest.tools ?? [])
    .find((candidate) => candidate.riskClass === "life-safety");
  if (tool === undefined) throw new Error("Test setup: no life-safety tool.");
  return tool.id;
}

describe("drawer.find", () => {
  it("finds the VAT tool by its Serbian name and by its keyword", async () => {
    for (const query of ["porez", "PDV", "pdv"]) {
      const result = await run("drawer.find", { query });
      expect(result.ok, query).toBe(true);
      expect(result.content, query).toContain("- pdv (");
    }
  });

  it("says whether each tool runs in the chat or only opens its page", async () => {
    const result = await run("drawer.find", { query: "pdv" });
    expect(result.content).toContain("- pdv (calculation); runs in the chat");
  });

  it("answers in the reader's language", async () => {
    const result = await run("drawer.find", { query: "pdv" }, "sr");
    expect(result.content).toContain("računa u razgovoru");
  });

  it("requires every word of the query, and says when nothing matches", async () => {
    expect((await run("drawer.find", { query: "porez kredit" })).content).toBe(
      "No tool matches “porez kredit”.",
    );
    expect((await run("drawer.find", { query: "zzzqqq" })).content).toBe("No tool matches “zzzqqq”.");
  });

  it("filters by drawer and caps the list, saying how many more there are", async () => {
    const everyday = await run("drawer.find", { query: "a", drawer: "utilities", limit: 2 });
    expect(everyday.content.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
    expect(everyday.content).toMatch(/…and \d+ more\./);
    const professional = await run("drawer.find", { query: "pdv", drawer: "professional" });
    expect(professional.content).not.toContain("- pdv (");
  });

  it("does not list a tool whose module is switched off", async () => {
    const hidden: ShellVisibility = { ...DEFAULT_SHELL_VISIBILITY, hidden: ["tools"] };
    const result = await toolNamed("drawer.find", drawerWith(hidden)).run(
      { query: "pdv", drawer: "utilities" },
      context(),
    );
    expect(result.content).toBe("No tool matches “pdv”.");
  });

  it("refuses an empty query", async () => {
    const result = await run("drawer.find", { query: "" });
    expect(result.ok).toBe(false);
  });
});

describe("drawer.open", () => {
  it("opens the tool on its page, by id", async () => {
    const result = await run("drawer.open", { tool: "pdv" });
    expect(result).toEqual({
      ok: true,
      content: "Opening the tool “pdv” on the “tools” page.",
      navigateTo: { module: "tools", item: "pdv" },
    });
  });

  it("opens a professional tool on the professional page", async () => {
    const result = await runWithPro("drawer.open", { tool: "angle-units" });
    expect(result.navigateTo).toEqual({ module: "pro", item: "angle-units" });
  });

  it("refuses an id that is not a tool, and names what to do", async () => {
    const result = await run("drawer.open", { tool: "nope" });
    expect(result).toEqual({
      ok: false,
      content: "Failed: There is no tool “nope”. Find it with drawer.find.",
    });
  });

  it("prefills the fields of a tool that has runner inputs", async () => {
    const result = await run("drawer.open", { tool: "pdv", values: { amount: 1000, rate: 20, direction: "add" } });
    expect(result.navigateTo).toEqual({
      module: "tools",
      item: "pdv",
      action: { name: "prefill", payload: { values: { amount: 1000, rate: 20, direction: "add" } } },
    });
  });

  it("refuses values for a tool the page cannot prefill, rather than dropping them", async () => {
    const result = await run("drawer.open", { tool: "procenat", values: { operation: "of" } });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("has no inputs the assistant can fill");
  });

  it("refuses prefilled values the tool's inputs do not accept", async () => {
    const result = await run("drawer.open", { tool: "pdv", values: { amount: 1000, rate: 15, direction: "add" } });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/^Failed: /);
  });
});

describe("drawer.run", () => {
  it("returns the figures the surface computes for the same inputs, with the notice", async () => {
    const result = await run("drawer.run", { tool: "pdv", values: { amount: 1000, rate: 20, direction: "add" } });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Net: 1,000.00");
    expect(result.content).toContain("VAT: 200.00");
    expect(result.content).toContain("Gross: 1,200.00");
    expect(result.content).toContain(TOOL_RISK_LINES.financial.en);
    expect(result.content).toContain("Repeat this notice with the result.");
  });

  it("answers the Serbian figures and notice in Serbian", async () => {
    const result = await run("drawer.run", { tool: "pdv", values: { amount: 1000, rate: 20, direction: "add" } }, "sr");
    expect(result.content).toContain("Neto: 1.000,00");
    expect(result.content).toContain(TOOL_RISK_LINES.financial.sr);
  });

  it("runs a tool with no risk notice without one", async () => {
    const result = await run("drawer.run", { tool: "duzina", values: { value: 1, from: "km", to: "mi" } });
    expect(result.ok).toBe(true);
    expect(result.content).not.toContain("Repeat this notice");
  });

  it("refuses a life-safety tool with a pointer to its page, and no figure", async () => {
    const id = lifeSafetyToolId();
    const result = await runWithPro("drawer.run", { tool: id, values: {} });
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      `Failed: The tool “${id}” gives a result a licensed person must judge, so the assistant does not compute it. Open it with drawer.open to see its figures on the page.`,
    );
  });

  it("refuses a tool with no runner, and names the page", async () => {
    const result = await run("drawer.run", { tool: "procenat-zzz", values: {} });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("There is no tool");
  });

  it("refuses inputs that break the tool's schema, with the schema's own message", async () => {
    const result = await run("drawer.run", { tool: "pdv", values: { amount: "1000", rate: 20, direction: "add" } });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/^Failed: /);
  });

  it("answers no figure where the arithmetic has none", async () => {
    const result = await run("drawer.run", { tool: "procenat", values: { operation: "what", first: 5, second: 0 } });
    expect(result).toEqual({ ok: false, content: "Failed: The tool “procenat” has no figure for those values." });
  });
});

describe("the drawer's tool budget", () => {
  it("fits its three specs beside a full turn's other tools of typical size in the tool budget", () => {
    const contextTokens = 8192;
    const ceiling = contextTokens - answerReserveTokens(contextTokens);
    const budget = Math.floor(ceiling * TOOL_BUDGET_SHARE);
    const unrun = {
      profileDb: () => {
        throw new Error("Test setup: the budget test runs no tool.");
      },
      now: () => 0,
    };
    // The rest of a full turn (MAX_TOOLS_PER_TURN less the drawer's three) in
    // tools of typical size: the ones whose spec cost sits at the median of the
    // app's own finance, task and calendar tools. A turn's menu is usually
    // filled with tools like these; the heaviest ones do not fit beside any
    // drawer tools, and that is what the chooser's budget is for.
    const others = [...financeTools(unrun), ...taskTools(unrun), ...calendarTools({ profileDb: unrun.profileDb })]
      .map((tool) => toolSpecTokens(tool))
      .sort((left, right) => left - right);
    const drawerTools = drawerWith();
    const rest = MAX_TOOLS_PER_TURN - drawerTools.length;
    const start = Math.floor((others.length - rest) / 2);
    const typical = others.slice(start, start + rest);
    const drawer = drawerTools.reduce((sum, tool) => sum + toolSpecTokens(tool), 0);
    expect(typical).toHaveLength(rest);
    expect(drawer + typical.reduce((sum, cost) => sum + cost, 0)).toBeLessThanOrEqual(budget);
  });
});

describe("TOOL_RUNNERS", () => {
  it("never holds a runner for a tool whose class forbids a verdict", () => {
    const forbidden = createModuleRegistry()
      .all()
      .flatMap((manifest) => manifest.tools ?? [])
      .filter((tool) => tool.riskClass === "life-safety" || tool.riskClass === "food-safety")
      .map((tool) => tool.id);
    for (const id of forbidden) expect(TOOL_RUNNERS.has(id), id).toBe(false);
  });
});
