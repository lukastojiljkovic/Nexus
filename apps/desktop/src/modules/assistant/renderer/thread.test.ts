import { afterEach, describe, expect, it } from "vitest";
import type { Citation } from "@nexus/core";
import { applyLocale } from "../../../renderer/src/strings.js";
import type { AssistantMessageView } from "../shared/ipc.js";
import {
  CITATION_LOCATOR_SEPARATOR,
  TOOL_LINE_CHARS,
  citationTarget,
  firstLine,
  groupThread,
  numberedCitations,
  toolLineView,
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
