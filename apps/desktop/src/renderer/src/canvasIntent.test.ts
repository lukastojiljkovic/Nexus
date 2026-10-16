import { describe, expect, it } from "vitest";
import { canvasRefText, parseCanvasSketch } from "@nexus/core";
import { canvasIntentOf } from "./canvasIntent.js";

const BOARD = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const NOTE = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6c";

describe("canvasIntentOf", () => {
  it("asks for nothing when the location names no board", () => {
    expect(canvasIntentOf({})).toBeNull();
    expect(canvasIntentOf({ item: "" })).toBeNull();
  });

  it("reveals a board for a location that names only the item", () => {
    expect(canvasIntentOf({ item: BOARD })).toEqual({ kind: "reveal", boardId: BOARD });
  });

  it("carries a valid sketch, parsed again on this side of the event", () => {
    const sketch = { nodes: [{ id: "a", label: "A" }], edges: [] };
    expect(canvasIntentOf({ item: BOARD, action: { name: "sketch", payload: sketch } })).toEqual({
      kind: "sketch",
      boardId: BOARD,
      sketch: parseCanvasSketch(sketch),
    });
  });

  it("opens the board but draws nothing for a sketch that does not validate", () => {
    const broken = { nodes: [{ id: "a", label: "A", shape: "hexagon" }] };
    expect(canvasIntentOf({ item: BOARD, action: { name: "sketch", payload: broken } })).toEqual({
      kind: "reveal",
      boardId: BOARD,
    });
  });

  it("carries a card reference the grammar admits, and nothing else", () => {
    const ref = canvasRefText({ kind: "note", id: NOTE });
    expect(canvasIntentOf({ item: BOARD, action: { name: "place-card", payload: { ref } } })).toEqual({
      kind: "card",
      boardId: BOARD,
      ref: { kind: "note", id: NOTE },
    });
    expect(
      canvasIntentOf({ item: BOARD, action: { name: "place-card", payload: { ref: "https://example.com" } } }),
    ).toEqual({ kind: "reveal", boardId: BOARD });
  });

  it("ignores an action it does not know and still opens the board", () => {
    expect(canvasIntentOf({ item: BOARD, action: { name: "set-preference", payload: {} } })).toEqual({
      kind: "reveal",
      boardId: BOARD,
    });
  });
});
