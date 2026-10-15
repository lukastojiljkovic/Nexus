import { describe, expect, it } from "vitest";
import {
  SAFETY_NOTICE,
  SYSTEM_PROMPT_VERSION,
  buildSystemPrompt,
  hasSafetyNotice,
  renderKnowledgeBlock,
  replyLanguageLine,
} from "./prompts.js";
import { countBoundary } from "./fence.js";
import type { KnowledgeHit, ToolSpec } from "./contract.js";
import type { ReplyLanguage } from "./language.js";

const BOUNDARY = "nx-0123456789abcdef";

const SR_LATIN: ReplyLanguage = { language: "sr", script: "latin" };
const SR_CYRILLIC: ReplyLanguage = { language: "sr", script: "cyrillic" };
const EN: ReplyLanguage = { language: "en", script: "latin" };

/** The fixed parts of a prompt every test here does not care about. */
const prompt = (options: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): string =>
  buildSystemPrompt({
    reply: SR_LATIN,
    passages: false,
    tools: [],
    maxSteps: 0,
    today: "2026-10-15",
    ...options,
  });

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
  it("states the version, the decided reply language, and every rule", () => {
    const built = prompt({ reply: SR_LATIN, tools: [TOOL, WRITE_TOOL], maxSteps: 5 });
    expect(built).toContain(SYSTEM_PROMPT_VERSION);
    expect(built).toContain("The user wrote in Serbian (Latin script)");
    expect(built).toContain("[1]");
    expect(built).toContain("BEGIN UNTRUSTED DATA");
    // The page draws the safety notice; the prompt only tells the model not to.
    expect(built).not.toContain(SAFETY_NOTICE.sr);
    expect(built).not.toContain(SAFETY_NOTICE.en);
    expect(built).toContain("The app shows its safety notice under such an answer: do not write one.");
    expect(built).toContain("at most 5 rounds");
    expect(built).toContain("Never invent a fact, a number");
  });

  it("keeps a duty the old prompt carried: the refusal, the citation and the safety habits", () => {
    const built = prompt({ reply: EN, tools: [TOOL], maxSteps: 5 });
    expect(built).toContain("Never repeat a refused call");
    expect(built).toContain("a refusal is a normal result, not an error");
    expect(built).toContain("the tool asks the user for permission");
    expect(built).toContain("Never invent a citation");
    expect(built).toContain("the app shows the user every citation you send");
    expect(built).toContain("calling 112 is the first step");
  });

  it("states the decided language and script as a fact, not as a rule to follow", () => {
    expect(prompt({ reply: EN })).toContain(
      "- The user wrote in English. Answer in English, even when the passages or the tool results are in Serbian.",
    );
    expect(prompt({ reply: SR_LATIN })).toContain(
      "- The user wrote in Serbian (Latin script). Answer in Serbian, in the Latin script with full diacritics, even when a passage is in Cyrillic.",
    );
    expect(prompt({ reply: SR_CYRILLIC })).toContain(
      "- The user wrote in Serbian (Cyrillic script). Answer in Serbian, in the Cyrillic script.",
    );
    expect(prompt({ reply: SR_LATIN })).not.toContain("Answer in the language the user writes in");
  });

  it("chooses the grounding line from what retrieval returned", () => {
    expect(prompt({ passages: true })).toContain(
      "- Answer from the numbered passages and cite them. If they do not answer the question, say so in one sentence, then follow the next rule.",
    );
    expect(prompt({ passages: true })).not.toContain("No passage from the user's library");
    expect(prompt({ passages: false })).toContain(
      "- No passage from the user's library matches this question.",
    );
    expect(prompt({ passages: false })).not.toContain("Answer from the numbered passages");
    // The general-knowledge rule follows either line, and it is the one that
    // stops a small model refusing a capital city.
    expect(prompt({ passages: false })).toContain("say once that it is general knowledge");
    expect(prompt({ passages: false })).toContain("Never give a number or a date from memory");
    expect(prompt({ passages: true })).toContain("For health, medicine, law, money and safety");
  });

  it("keeps the fixed text small enough for the window it shares with the conversation", () => {
    // A policy guard, not a measurement: the prompt is short, imperative prose
    // for a 2-5B model, and this is the ceiling the size may not drift past
    // unnoticed. The old ceiling was 2700 beside a prompt of 2522 characters;
    // the grounding rule this brief fixes is 420 characters longer than the
    // refusal it replaces, so the ceiling moves with it. The longest of the four
    // variants is 2809 since the safety notice left the prompt for the page. The
    // four are checked because the language line and the grounding line are
    // both chosen per turn.
    expect(prompt({ reply: SR_LATIN, passages: true, maxSteps: 6 }).length).toBeLessThan(3000);
    expect(prompt({ reply: SR_CYRILLIC, passages: true, maxSteps: 6 }).length).toBeLessThan(3000);
    expect(prompt({ reply: SR_LATIN, passages: false, maxSteps: 6 }).length).toBeLessThan(3000);
    expect(prompt({ reply: EN, passages: false, maxSteps: 6 }).length).toBeLessThan(3000);
  });

  it("gives the model today's date with its weekday", () => {
    expect(prompt({ today: "2026-10-14", maxSteps: 2 })).toContain("Today is Wednesday, 2026-10-14.");
  });

  it("names the offered tools, grouped by what they do to the app", () => {
    const built = prompt({ reply: EN, tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(built).toContain("You reach the app only through the tools offered with this message.");
    expect(built).toContain("- Tools that ask the user first: tasks.create");
    expect(built).toContain("- Tools that only read: tasks.list");
  });

  it("does not repeat a tool's description, which the runtime documents itself", () => {
    const built = prompt({ tools: [TOOL, WRITE_TOOL], maxSteps: 3 });
    expect(built).not.toContain("Lists the tasks.");
    expect(built).not.toContain("Lista zadataka.");
    expect(built).not.toContain("Pravi zadatak.");
  });

  it("leaves out a group with no tools in it", () => {
    const built = prompt({ reply: EN, tools: [WRITE_TOOL], maxSteps: 3 });
    expect(built).toContain("- Tools that ask the user first: tasks.create");
    expect(built).not.toContain("- Tools that only read");
    expect(built).not.toContain("- Tools that move the app's view");
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
    const built = prompt({ reply: EN, today: "2026-10-14", tools: [navigate, network], maxSteps: 3 });
    expect(built).toContain("- Tools that ask the user first: web.search");
    expect(built).toContain("- Tools that move the app's view: app.open");
  });

  it("says web search is unavailable unless a network tool is offered", () => {
    const network: ToolSpec = {
      name: "web.search",
      description: { sr: "Traži na vebu.", en: "Searches the web." },
      parameters: { type: "object" },
      effect: "network",
    };
    const line = "- No web tool is offered this turn.";
    expect(prompt({ reply: EN, tools: [TOOL], maxSteps: 3 })).toContain(line);
    expect(prompt({ reply: EN, maxSteps: 3 })).toContain(line);
    expect(prompt({ reply: EN, tools: [TOOL, network], maxSteps: 3 })).not.toContain(line);
  });

  it("says so when the turn carries no tools", () => {
    expect(prompt({ reply: EN, maxSteps: 2 })).toContain("No tools are available this turn");
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

  it("is followed by the decided language, outside the fence, because the model weighs the last thing it read most", () => {
    const block = renderKnowledgeBlock([HIT], BOUNDARY, EN);
    expect(block).not.toBeNull();
    const body = block ?? "";
    // The line is the LAST thing in the block, and the passages above it are
    // exactly what it is written to outweigh. It is after the closing marker:
    // inside the fence it would be data, which the prompt says is never obeyed.
    expect(body.indexOf("The user wrote in English")).toBeGreaterThan(body.indexOf("END UNTRUSTED DATA"));
    expect(body.trimEnd().endsWith(replyLanguageLine(EN))).toBe(true);
  });

  it("carries no closing line when the caller decided no language", () => {
    expect(renderKnowledgeBlock([HIT], BOUNDARY)).not.toContain("The user wrote in");
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

describe("replyLanguageLine", () => {
  it("names the language and the script for each of the three answers", () => {
    expect(replyLanguageLine(EN)).toContain("Answer in English");
    expect(replyLanguageLine(SR_LATIN)).toContain("Latin script with full diacritics");
    expect(replyLanguageLine(SR_CYRILLIC)).toContain("Cyrillic script");
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
