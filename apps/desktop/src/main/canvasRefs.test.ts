import { describe, expect, it } from "vitest";
import { canvasRefText } from "@nexus/core";
import { MAX_CANVAS_REF_BATCH } from "../shared/ipc.js";
import { asCanvasRefs } from "./canvasRefs.js";

const NOTE_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const TASK_ID = "0198a1b2-c3d4-7e5f-9a9b-0c1d2e3f4a5c";

const NOTE_REF = canvasRefText({ kind: "note", id: NOTE_ID });
const TASK_REF = canvasRefText({ kind: "task", id: TASK_ID });

describe("asCanvasRefs", () => {
  it("parses a well-formed batch, in the order it arrived", () => {
    expect(asCanvasRefs([TASK_REF, NOTE_REF], "refs")).toEqual([
      { kind: "task", id: TASK_ID },
      { kind: "note", id: NOTE_ID },
    ]);
  });

  it("accepts an empty batch — a board with no cards is the ordinary case", () => {
    expect(asCanvasRefs([], "refs")).toEqual([]);
  });

  it("accepts exactly the cap and refuses one past it, naming the bound", () => {
    const atCap = Array.from({ length: MAX_CANVAS_REF_BATCH }, () => NOTE_REF);
    expect(asCanvasRefs(atCap, "refs")).toHaveLength(MAX_CANVAS_REF_BATCH);
    expect(() => asCanvasRefs([...atCap, NOTE_REF], "refs")).toThrow(
      new RegExp(`at most ${MAX_CANVAS_REF_BATCH} references`),
    );
  });

  it("refuses a payload that is not an array at all", () => {
    for (const payload of [undefined, null, "nexus://note/x", 7, { 0: NOTE_REF, length: 1 }]) {
      expect(() => asCanvasRefs(payload, "refs")).toThrow(/must be an array/);
    }
  });

  /**
   * The refusal that matters: a malformed entry stops the call rather than
   * resolving to an empty card. A card the store never answered for is a card
   * the editor would fall through on — and Excalidraw's fall-through is a real
   * iframe (see `canvasRef.ts`'s header).
   */
  it("refuses a malformed entry, naming its position and never echoing it", () => {
    const hostile = [
      "javascript:alert(1)",
      `https://note/${NOTE_ID}`,
      "nexus://note/",
      "nexus://board/0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      `nexus://note/${NOTE_ID}/steal`,
      "",
    ];
    for (const entry of hostile) {
      // Asserted as the WHOLE message: it names the position and carries none of
      // the untrusted string, which a substring match could not tell apart.
      expect(() => asCanvasRefs([NOTE_REF, entry], "refs")).toThrowError(
        new Error(`Invalid IPC payload: "refs[1]" is not a Nexus object reference.`),
      );
    }
  });

  it("refuses a non-string entry", () => {
    for (const entry of [null, 7, { kind: "note", id: NOTE_ID }, [NOTE_REF]]) {
      expect(() => asCanvasRefs([entry], "refs")).toThrow(/"refs\[0\]"/);
    }
  });
});
