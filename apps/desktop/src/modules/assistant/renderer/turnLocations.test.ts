import { describe, expect, it } from "vitest";
import type { AgentErrorCode, AppLocation } from "@nexus/core";
import type { AssistantTurnEventView } from "../shared/ipc.js";
import { manifest } from "../shared/manifest.js";
import { turnLocations } from "./turnLocations.js";

/**
 * WHERE A TURN TAKES THE USER (ADR-117). `Page.tsx` is not rendered here - this
 * package has no DOM library - so the decision it makes at the end of a turn is
 * pinned as the pure function it is: which of a turn's results move the view,
 * in what order, and which turns move it nowhere at all.
 */

function location(module: string, item?: string): AppLocation {
  return item === undefined ? { module } : { module, item };
}

/** One `tool-result` event carrying a result, with a location when one is named. */
function result(location?: AppLocation): AssistantTurnEventView {
  return {
    type: "tool-result",
    callId: "call_1",
    result:
      location === undefined
        ? { ok: true, content: "ok" }
        : { ok: true, content: "ok", navigateTo: location },
  };
}

function error(code: AgentErrorCode): AssistantTurnEventView {
  return { type: "error", code };
}

describe("the places a finished turn opens", () => {
  it("opens what a tool result named, in the order the turn named it", () => {
    // The whole point of the seam: `app.open` answers "Opened module …" and the
    // view has to move for that sentence to be true. Two results are two moves,
    // and the second one is where the user ends up.
    expect(
      turnLocations([
        { type: "token", text: "Gledam…" },
        result(location("tasks", "task-1")),
        { type: "tool-call", call: { id: "call_2", name: "app.open", arguments: {} } },
        result(location("canvas")),
      ]),
    ).toEqual([location("tasks", "task-1"), location("canvas")]);
  });

  it("opens nothing for a result that named no place", () => {
    expect(turnLocations([result()])).toEqual([]);
    expect(turnLocations([])).toEqual([]);
  });

  it("drops a location that names the assistant's own page", () => {
    // Asking to open the assistant is asking for the page the answer is being
    // read on, and following it would unmount the thread for no move at all.
    expect(turnLocations([result(location(manifest.id))])).toEqual([]);
  });

  it("collapses a repeated place that carries no action, and keeps one that does", () => {
    expect(
      turnLocations([result(location("tasks", "task-1")), result(location("tasks", "task-1"))]),
    ).toEqual([location("tasks", "task-1")]);
    // Two actions are two things to apply, even on one page.
    expect(
      turnLocations([
        result({ module: "canvas", action: { name: "sketch", payload: 1 } }),
        result({ module: "canvas", action: { name: "sketch", payload: 2 } }),
      ]),
    ).toHaveLength(2);
    // And a place that changes is not a duplicate: a different item is a
    // different row to reveal.
    expect(
      turnLocations([result(location("tasks", "task-1")), result(location("tasks", "task-2"))]),
    ).toHaveLength(2);
  });

  it("opens nothing when the turn ended in an error", () => {
    // Every code that stops a turn early: the last request of a turn that was
    // cut off is not a place anybody asked to be taken.
    const fatal: readonly AgentErrorCode[] = [
      "no-model",
      "model-failed",
      "step-limit",
      "context-full",
      "aborted",
    ];
    for (const code of fatal) {
      expect(turnLocations([result(location("tasks")), error(code)]), code).toEqual([]);
    }
    // `tool-failed` is the one the loop carries on from, so the place the rest
    // of the turn named is still followed.
    expect(turnLocations([result(location("tasks", "task-1")), error("tool-failed")])).toEqual([
      location("tasks", "task-1"),
    ]);
  });
});
