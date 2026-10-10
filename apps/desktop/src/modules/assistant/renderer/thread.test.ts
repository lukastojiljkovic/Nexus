import { describe, expect, it } from "vitest";
import type { AssistantMessageView } from "../shared/ipc.js";
import { TOOL_LINE_CHARS, citationTarget, firstLine, groupThread } from "./thread.js";

/**
 * THE THREAD'S TWO RULES (ADR-106): how tool activity folds, and where a
 * citation goes. Both are pure, so both are pinned here with the values they
 * produce rather than with "it rendered".
 */

let seq = 0;
function message(partial: Partial<AssistantMessageView> & Pick<AssistantMessageView, "role">): AssistantMessageView {
  seq += 1;
  return {
    id: `m${seq}`,
    text: "",
    citations: [],
    toolCalls: null,
    toolCallId: null,
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
      message({ role: "tool", text: "3 otvorena zadatka.", toolCallId: "call_1" }),
      message({
        role: "assistant",
        toolCalls: [{ id: "call_2", name: "tasks.create", arguments: {} }],
      }),
      message({ role: "tool", text: "Napravljen zadatak.", toolCallId: "call_2" }),
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
    ]);
  });

  it("names a result by the call it answers, and answers null when the call is gone", () => {
    const items = groupThread([
      message({
        role: "assistant",
        toolCalls: [{ id: "call_9", name: "app.open", arguments: {} }],
      }),
      message({ role: "tool", text: "Otvoreno.", toolCallId: "call_9" }),
      message({ role: "tool", text: "Bez poziva.", toolCallId: "call_404" }),
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
      message({ role: "tool", text: "rezultat", toolCallId: "c" }),
      message({ role: "user", text: "i sada?" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["tools", "message"]);
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
