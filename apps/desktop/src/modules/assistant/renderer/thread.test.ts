import { afterEach, describe, expect, it } from "vitest";
import type { AgentErrorCode, Citation } from "@nexus/core";
import { applyLocale } from "../../../renderer/src/strings.js";
import type { AssistantMessageView, AssistantSummaryView } from "../shared/ipc.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";
import {
  CITATION_LOCATOR_SEPARATOR,
  TOOL_LINE_CHARS,
  canCompact,
  citationTarget,
  firstLine,
  groupThread,
  numberedCitations,
  summaryBoundary,
  toolLineView,
  turnEndError,
  turnErrorSentence,
  type ThreadToolLine,
} from "./thread.js";

/**
 * THE THREAD'S RULES (ADR-106): how tool activity folds, what one line of it
 * claims happened, and where a citation goes. All pure, so all pinned here with
 * the values they produce rather than with "it rendered".
 */

// `toolLineView` reads the module's live copy, so the cases below switch it and
// put it back - the pantry page's rule, for the same reason.
afterEach(() => {
  applyLocale("sr");
});

let seq = 0;
function message(partial: Partial<AssistantMessageView> & Pick<AssistantMessageView, "role">): AssistantMessageView {
  seq += 1;
  return {
    id: `m${seq}`,
    text: "",
    citations: [],
    toolCalls: null,
    toolCallId: null,
    ok: null,
    safety: false,
    createdAt: "2026-06-01T08:00:00.000Z",
    ...partial,
  };
}

describe("groupThread", () => {
  it("folds a run of tool activity into one item, and starts a new run after an answer", () => {
    const items = groupThread([
      message({ role: "user", text: "Napravi zadatak da platim račun." }),
      message({
        role: "assistant",
        text: "Gledam tvoje zadatke.",
      }),
      message({
        role: "assistant",
        toolCalls: [{ id: "call_1", name: "tasks.list", arguments: {} }],
      }),
      message({ role: "tool", text: "3 otvorena zadatka.", toolCallId: "call_1", ok: true }),
      message({
        role: "assistant",
        toolCalls: [{ id: "call_2", name: "tasks.create", arguments: {} }],
      }),
      message({ role: "tool", text: "Napravljen zadatak.", toolCallId: "call_2", ok: true }),
      message({
        role: "assistant",
        toolCalls: [{ id: "call_3", name: "tasks.complete", arguments: {} }],
      }),
      message({
        role: "tool",
        text: "Neuspešno: nema aktivnog zadatka sa tim id-jem.",
        toolCallId: "call_3",
        ok: false,
      }),
      message({ role: "assistant", text: "Zapisao sam „Plati račun“." }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["message", "message", "tools", "message"]);
    const tools = items[2];
    if (tools?.kind !== "tools") throw new Error("expected the run of tool activity here");
    // One line per CALL, and one per RESULT, the results named from the calls
    // above them - the reason the run maps call ids to names instead of printing
    // an anonymous row.
    expect(tools.lines.map(({ name, ok, text }) => ({ name, ok, text }))).toEqual([
      { name: "tasks.list", ok: null, text: "" },
      { name: "tasks.list", ok: true, text: "3 otvorena zadatka." },
      { name: "tasks.create", ok: null, text: "" },
      { name: "tasks.create", ok: true, text: "Napravljen zadatak." },
      { name: "tasks.complete", ok: null, text: "" },
      {
        name: "tasks.complete",
        ok: false,
        text: "Neuspešno: nema aktivnog zadatka sa tim id-jem.",
      },
    ]);
  });

  it("names a result by the call it answers, and answers null when the call is gone", () => {
    const items = groupThread([
      message({
        role: "assistant",
        toolCalls: [{ id: "call_9", name: "app.open", arguments: {} }],
      }),
      message({ role: "tool", text: "Otvoreno.", toolCallId: "call_9", ok: true }),
      message({ role: "tool", text: "Bez poziva.", toolCallId: "call_404", ok: true }),
    ]);
    expect(items).toHaveLength(1);
    const [tools] = items;
    if (tools?.kind !== "tools") throw new Error("expected one tools item");
    expect(tools.lines.map(({ id, name, ok, text }) => ({ id, name, ok, text }))).toEqual([
      { id: "call_9", name: "app.open", ok: null, text: "" },
      { id: expect.any(String), name: "app.open", ok: true, text: "Otvoreno." },
      { id: expect.any(String), name: null, ok: true, text: "Bez poziva." },
    ]);
  });

  it("draws a message with only tool calls as tool activity and nothing else", () => {
    const items = groupThread([
      message({ role: "assistant", toolCalls: [{ id: "c", name: "notes.read", arguments: {} }] }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["tools"]);
  });

  it("keeps a user message out of a tool run and flushes what came before it", () => {
    const items = groupThread([
      message({ role: "tool", text: "rezultat", toolCallId: "c", ok: false }),
      message({ role: "user", text: "i sada?" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["tools", "message"]);
  });
});

describe("toolLineView", () => {
  const line = (partial: Partial<ThreadToolLine> & Pick<ThreadToolLine, "id">): ThreadToolLine => ({
    name: null,
    ok: null,
    text: "",
    ...partial,
  });

  it("reads a call with no result yet as the tool running", () => {
    expect(toolLineView(line({ id: "c1", name: "tasks.create", ok: null }))).toEqual({
      label: "Dodavanje zadatka",
      state: "running",
      detail: "",
    });
  });

  it("reads a result that was done as done, and keeps what the tool answered", () => {
    expect(
      toolLineView(
        line({ id: "c1", name: "tasks.create", ok: true, text: "Napravljen zadatak." }),
      ),
    ).toEqual({ label: "Dodavanje zadatka", state: "done", detail: "Napravljen zadatak." });
  });

  it("reads a result that did nothing as failed, with the tool's own words beside it", () => {
    expect(
      toolLineView(
        line({ id: "c1", name: "tasks.list", ok: false, text: "Neuspešno: nema zadataka." }),
      ),
    ).toEqual({
      label: "Čitanje zadataka",
      state: "failed",
      detail: "Neuspešno: nema zadataka.",
    });
  });

  it("draws a name the map does not know as it stands, and a nameless result as a tool", () => {
    // Both are a tool this build cannot name: a name from another build, and a
    // result whose call the thread no longer holds.
    expect(toolLineView(line({ id: "c1", name: "ghost.tool", ok: true })).label).toBe("ghost.tool");
    expect(toolLineView(line({ id: "c2", ok: true, text: "Nešto." })).label).toBe("Alatka");
  });

  it("reads only the map's own labels, so a name like `constructor` is drawn as it stands", () => {
    expect(toolLineView(line({ id: "c1", name: "constructor", ok: false })).label).toBe("constructor");
    expect(toolLineView(line({ id: "c2", name: "__proto__", ok: false })).label).toBe("__proto__");
  });

  it("says the same thing in English", () => {
    applyLocale("en");
    expect(
      toolLineView(line({ id: "c1", name: "tasks.create", ok: false, text: "Failed: no title." })),
    ).toEqual({ label: "Add a task", state: "failed", detail: "Failed: no title." });
  });
});

describe("citationTarget", () => {
  const manual = {
    kind: "app-manual" as const,
    id: "sr/podesavanja",
    title: "Podešavanja",
    location: { module: "settings", settings: "modules" },
  };

  it("opens a place in the app when the citation names one", () => {
    expect(citationTarget(manual)).toEqual({
      kind: "app",
      location: { module: "settings", settings: "modules" },
    });
  });

  it("opens an https address through the external-link rule when there is no place", () => {
    // A web result's id IS its address (`web/citation.ts`), and so is a
    // Wikipedia citation's.
    expect(
      citationTarget({
        kind: "wiki",
        id: "https://sr.wikipedia.org/wiki/Voda",
        title: "Voda",
        locator: "https://sr.wikipedia.org/wiki/Voda",
      }),
    ).toEqual({ kind: "web", url: "https://sr.wikipedia.org/wiki/Voda" });
  });

  it("answers none for a source with neither a place nor an address, and refuses a non-https one", () => {
    expect(citationTarget({ kind: "note", id: "note-1", title: "Beleška" })).toEqual({
      kind: "none",
    });
    // A `file:` address is exactly what the external-link rule exists to refuse,
    // so a citation carrying one is text and never a link.
    expect(
      citationTarget({ kind: "file", id: "file:///C:/secret.txt", title: "Tajna" }),
    ).toEqual({ kind: "none" });
    expect(citationTarget({ kind: "pack", id: "http://example.test/x", title: "X" })).toEqual({
      kind: "none",
    });
  });

  it("prefers the app over the address when a citation carries both", () => {
    expect(
      citationTarget({
        kind: "pack",
        id: "https://example.test/article",
        title: "Članak",
        location: { module: "reader" },
      }),
    ).toEqual({ kind: "app", location: { module: "reader" } });
  });

  it("strips an action from a citation's place: a citation is a link, not an instruction", () => {
    // A citation is replayed from a stored thread, so a place that acted when it
    // was clicked would be a command wearing a link's shape. Nothing writes an
    // action into a citation; this is the guard that keeps one from acting.
    expect(
      citationTarget({
        kind: "wiki",
        id: "lib/A",
        title: "Nikola Tesla",
        location: { module: "canvas", item: "board-1", action: { name: "sketch" } },
      }),
    ).toEqual({ kind: "app", location: { module: "canvas", item: "board-1" } });
    // A place with nothing to strip is handed on as it arrived.
    const place = { module: "wiki", item: "lib/A" };
    expect(citationTarget({ kind: "wiki", id: "lib/A", title: "T", location: place })).toEqual({
      kind: "app",
      location: place,
    });
  });
});

describe("firstLine", () => {
  it("takes the first line and trims it", () => {
    expect(firstLine("  Napravljen zadatak.\n  Detalji  ")).toBe("Napravljen zadatak.");
  });

  it("marks a line longer than the row shows", () => {
    const long = "x".repeat(TOOL_LINE_CHARS + 10);
    const cut = firstLine(long);
    expect(cut.length).toBe(TOOL_LINE_CHARS + 1);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("numberedCitations", () => {
  it("numbers the sources in the list's own order, which is the order the answer cites them in", () => {
    const citations: Citation[] = [
      { kind: "wiki", id: "a", title: "Nikola Tesla" },
      { kind: "note", id: "b", title: "Beleška", locator: "Rani život" },
    ];
    expect(numberedCitations(citations).map(({ number, label }) => ({ number, label }))).toEqual([
      { number: 1, label: "Nikola Tesla" },
      { number: 2, label: `Beleška${CITATION_LOCATOR_SEPARATOR}Rani život` },
    ]);
  });

  it("separates the title from the locator with the one character the page always used", () => {
    expect(CITATION_LOCATOR_SEPARATOR).toBe(" \u2014 ");
    expect(numberedCitations([{ kind: "task", id: "t", title: "Kupi vodu" }])[0]?.label).toBe(
      "Kupi vodu",
    );
  });

  it("is empty for an answer with no sources", () => {
    expect(numberedCitations([])).toEqual([]);
  });
});

/**
 * EVERY CODE THE LOOP CAN EMIT HAS A SENTENCE, IN BOTH LANGUAGES.
 *
 * The list is a `Record<AgentErrorCode, true>` rather than an array, so a code
 * added to the contract and forgotten here is a COMPILE error in this file - and
 * the copy tables are keyed by the same codes, so one without a sentence fails
 * `thread.ts` first. That is the point of testing it at all: a turn that dies of
 * a full context and says nothing is a screen nobody can act on.
 */
const EVERY_CODE: Readonly<Record<AgentErrorCode, true>> = {
  "no-model": true,
  "model-failed": true,
  "tool-failed": true,
  "step-limit": true,
  "context-full": true,
  aborted: true,
};

describe("what a failed turn says", () => {
  it("has one sentence for every code the loop can emit, in both languages", () => {
    const codes = Object.keys(EVERY_CODE) as AgentErrorCode[];
    expect(Object.keys(sr.thread.errors).sort()).toEqual([...codes].sort());
    expect(Object.keys(en.thread.errors).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      expect(sr.thread.errors[code].trim().length, `sr: ${code}`).toBeGreaterThan(0);
      expect(en.thread.errors[code].trim().length, `en: ${code}`).toBeGreaterThan(0);
      // Two languages, not one sentence pasted twice.
      expect(sr.thread.errors[code]).not.toBe(en.thread.errors[code]);
    }
  });

  it("answers each code with its own sentence, drawn in the active language", () => {
    applyLocale("sr");
    for (const code of Object.keys(EVERY_CODE) as AgentErrorCode[]) {
      expect(turnErrorSentence(code)).toBe(sr.thread.errors[code]);
    }
    applyLocale("en");
    for (const code of Object.keys(EVERY_CODE) as AgentErrorCode[]) {
      expect(turnErrorSentence(code), code).toBe(en.thread.errors[code]);
    }
    // The user's own Stop keeps the sentence the page has always drawn for it.
    expect(turnErrorSentence("aborted")).toBe("Stopped.");
  });

  // The defect: the page set the sentence as the event arrived and then read the
  // thread again at the turn's end, which cleared it, so a turn cut short by a
  // full context ended with no answer and no word of why.
  it("is what a finished turn leaves under the thread: its last error, or nothing", () => {
    applyLocale("en");
    expect(turnEndError([{ type: "token", text: "Hi" }, { type: "done", stopReason: "end" }])).toBeNull();
    expect(
      turnEndError([
        { type: "compaction", status: "running" },
        { type: "compaction", status: "done" },
        { type: "error", code: "context-full" },
        { type: "done", stopReason: "end" },
      ]),
    ).toBe(en.thread.errors["context-full"]);
    expect(
      turnEndError([
        { type: "error", code: "tool-failed" },
        { type: "error", code: "step-limit" },
        { type: "done", stopReason: "length" },
      ]),
    ).toBe(en.thread.errors["step-limit"]);
  });
});

/** A thread of `turns` exchanges, each a user message and an answer, numbered from 1. */
function turns(count: number): AssistantMessageView[] {
  return Array.from({ length: count }, (_, index) => [
    message({ id: `u${index + 1}`, role: "user", text: `Pitanje ${index + 1}` }),
    message({ id: `a${index + 1}`, role: "assistant", text: `Odgovor ${index + 1}` }),
  ]).flat();
}

const summaryThrough = (through: number): AssistantSummaryView => ({ text: "Sažetak.", through });

describe("canCompact", () => {
  it("needs more user turns than the loop keeps whole when there is no summary", () => {
    expect(canCompact(turns(2), null)).toBe(false);
    expect(canCompact(turns(3), null)).toBe(true);
  });

  it("counts only the user turns after the summary's cut", () => {
    // Three turns, the first summarized: exactly two remain after the cut, which is not more than the loop keeps.
    expect(canCompact(turns(3), summaryThrough(2))).toBe(false);
    // Four turns, the first summarized: three remain after the cut.
    expect(canCompact(turns(4), summaryThrough(2))).toBe(true);
  });

  it("is false when the cut lies past the last message", () => {
    expect(canCompact(turns(3), summaryThrough(99))).toBe(false);
  });
});

describe("summaryBoundary", () => {
  it("answers null when there is no summary", () => {
    expect(summaryBoundary(turns(3), null)).toBeNull();
  });

  it("answers the id of the message at the cut", () => {
    expect(summaryBoundary(turns(3), summaryThrough(2))).toBe("u2");
  });

  it("answers null when the cut is past the last message", () => {
    expect(summaryBoundary(turns(1), summaryThrough(2))).toBeNull();
    expect(summaryBoundary(turns(1), summaryThrough(3))).toBeNull();
  });
});
