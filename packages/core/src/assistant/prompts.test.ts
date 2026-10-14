import { describe, expect, it } from "vitest";
import {
  SAFETY_NOTICE,
  SYSTEM_PROMPT_VERSION,
  buildSystemPrompt,
  hasSafetyNotice,
  renderKnowledgeBlock,
} from "./prompts.js";
import { countBoundary } from "./fence.js";
import type { KnowledgeHit, ToolSpec } from "./contract.js";

const BOUNDARY = "nx-0123456789abcdef";

const TOOL: ToolSpec = {
  name: "tasks.list",
  description: { sr: "Lista zadataka.", en: "Lists the tasks." },
  parameters: { type: "object" },
  effect: "read",
};

const WRITE_TOOL: ToolSpec = {
  name: "tasks.create",
  description: { sr: "Pravi zadatak.", en: "Creates a task." },
  parameters: { type: "object" },
  effect: "write",
};

const HIT: KnowledgeHit = {
  citation: { kind: "pack", id: "izbor-hrane", title: "Izbor hrane", locator: "voda", packId: "survival" },
  text: "Vodu trazi nizvodno.",
  score: 0.9,
};

describe("SYSTEM_PROMPT_VERSION", () => {
  it("names the prompt so a score can say which text produced it", () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^assistant-\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("buildSystemPrompt", () => {
  it("states the version, the fallback language for the current locale, and every rule", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "sr", tools: [TOOL, WRITE_TOOL], maxSteps: 5 });
    expect(prompt).toContain(SYSTEM_PROMPT_VERSION);
    expect(prompt).toContain("answer in Serbian (Latin script), the language the app shows right now");
    expect(prompt).toContain("Answer in the language the user writes in");
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("BEGIN UNTRUSTED DATA");
    expect(prompt).toContain(SAFETY_NOTICE.sr);
    expect(prompt).toContain(SAFETY_NOTICE.en);
    expect(prompt).toContain("at most 5 rounds");
    expect(prompt).toContain("Never invent a fact, a number");
  });

  it("keeps a duty the old prompt carried: the refusal, the citation and the safety habits", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "en", tools: [TOOL], maxSteps: 5 });
    expect(prompt).toContain("Never repeat a refused call");
    expect(prompt).toContain("a refusal is a normal result, not an error");
    expect(prompt).toContain("the tool asks the user for permission");
    expect(prompt).toContain("Never invent a citation");
    expect(prompt).toContain("the app shows the user every citation you send");
    expect(prompt).toContain("the knowledge does not cover it, and stop there");
    expect(prompt).toContain("do not add the notice");
    expect(prompt).toContain("calling 112 is the first step");
  });

  it("keeps the fixed text small enough for the window it shares with the conversation", () => {
    // A policy guard, not a measurement: the prompt is short, imperative prose
    // for a 2-5B model, and this is the ceiling the size may not drift past
    // unnoticed. The measured length on 2026-10-15 was 2522 characters with no
    // tools; the number here is deliberately a little above it.
    const prompt = buildSystemPrompt({ locale: "sr", tools: [], maxSteps: 6, today: "2026-10-15" });
    expect(prompt.length).toBeLessThan(2700);
  });

  it("gives the model today's date with its weekday", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "sr", tools: [], maxSteps: 2 });
    expect(prompt).toContain("Today is Wednesday, 2026-10-14.");
  });

  it("names the offered tools, grouped by what they do to the app", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "en", tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(prompt).toContain("You reach the app only through the tools offered with this message.");
    expect(prompt).toContain("- Tools that ask the user first: tasks.create");
    expect(prompt).toContain("- Tools that only read: tasks.list");
  });

  it("does not repeat a tool's description, which the runtime documents itself", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "sr", tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(prompt).not.toContain("Lists the tasks.");
    expect(prompt).not.toContain("Lista zadataka.");
    expect(prompt).not.toContain("Pravi zadatak.");
  });

  it("leaves out a group with no tools in it", () => {
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "en", tools: [WRITE_TOOL], maxSteps: 3 });
    expect(prompt).toContain("- Tools that ask the user first: tasks.create");
    expect(prompt).not.toContain("- Tools that only read");
    expect(prompt).not.toContain("- Tools that move the app's view");
  });

  it("puts a tool that moves the page in its own group, and a network tool with the writes", () => {
    const navigate: ToolSpec = {
      name: "app.open",
      description: { sr: "Otvara stranicu.", en: "Opens a page." },
      parameters: { type: "object" },
      effect: "navigate",
    };
    const network: ToolSpec = {
      name: "web.search",
      description: { sr: "Traži na vebu.", en: "Searches the web." },
      parameters: { type: "object" },
      effect: "network",
    };
    const prompt = buildSystemPrompt({ today: "2026-10-14", locale: "en", tools: [navigate, network], maxSteps: 3 });
    expect(prompt).toContain("- Tools that ask the user first: web.search");
    expect(prompt).toContain("- Tools that move the app's view: app.open");
  });

  it("says so when the turn carries no tools", () => {
    expect(buildSystemPrompt({ today: "2026-10-14", locale: "en", tools: [], maxSteps: 2 })).toContain(
      "No tools are available this turn",
    );
  });
});

describe("renderKnowledgeBlock", () => {
  it("is null when there are no hits, which is an answer and not an empty block", () => {
    expect(renderKnowledgeBlock([], BOUNDARY)).toBeNull();
  });

  it("numbers the passages, names where each came from, and fences the whole thing", () => {
    const block = renderKnowledgeBlock([HIT], BOUNDARY);
    expect(block).not.toBeNull();
    expect(block).toContain("[1] Izbor hrane - voda (pack, survival)");
    expect(block).toContain("Vodu trazi nizvodno.");
    expect(countBoundary(block ?? "", BOUNDARY)).toBe(2);
  });

  it("marks a passage from a safety pack", () => {
    const safety: KnowledgeHit = {
      citation: { kind: "pack", id: "p", title: "Prva pomoc", safety: true },
      text: "Pozovi 112.",
      score: 0.8,
    };
    expect(renderKnowledgeBlock([safety], BOUNDARY)).toContain("(pack, SAFETY PACK)");
  });
});

describe("hasSafetyNotice", () => {
  it("is the flag a page checks before it draws the notice", () => {
    expect(hasSafetyNotice([])).toBe(false);
    expect(hasSafetyNotice([{ kind: "note", id: "n1", title: "Beleška" }])).toBe(false);
    expect(hasSafetyNotice([{ kind: "pack", id: "p1", title: "Prva pomoć", safety: true }])).toBe(true);
    expect(
      hasSafetyNotice([
        { kind: "note", id: "n1", title: "Beleška" },
        { kind: "pack", id: "p1", title: "Prva pomoć", safety: true },
      ]),
    ).toBe(true);
  });
});
