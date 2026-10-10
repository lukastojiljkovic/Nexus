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
    const prompt = buildSystemPrompt({ locale: "sr", tools: [TOOL, WRITE_TOOL], maxSteps: 5 });
    expect(prompt).toContain(SYSTEM_PROMPT_VERSION);
    expect(prompt).toContain("answer in Serbian (Latin script), which is what the app is showing right now");
    expect(prompt).toContain("Answer in the language the user writes in");
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("BEGIN UNTRUSTED DATA");
    expect(prompt).toContain(SAFETY_NOTICE.sr);
    expect(prompt).toContain(SAFETY_NOTICE.en);
    expect(prompt).toContain("at most 5 rounds");
    expect(prompt).toContain("Never invent a fact, a number");
  });

  it("describes each tool in the turn's language and says which ask first", () => {
    const prompt = buildSystemPrompt({ locale: "en", tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(prompt).toContain("- tasks.list: Lists the tasks.");
    expect(prompt).toContain("- tasks.create (asks the user first): Creates a task.");
    const serbian = buildSystemPrompt({ locale: "sr", tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(serbian).toContain("- tasks.list: Lista zadataka.");
  });

  it("says so when the turn carries no tools", () => {
    expect(buildSystemPrompt({ locale: "en", tools: [], maxSteps: 2 })).toContain(
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
