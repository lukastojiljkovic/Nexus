import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasAutosave, type SceneObservation } from "./canvasAutosave.js";

/**
 * The canvas autosave, without the canvas.
 *
 * The defect this module exists to make impossible: `CanvasPage` flushed a
 * pending save from an unmount cleanup by READING THE EDITOR — and Excalidraw's
 * own `componentWillUnmount` had already run by then, replacing its scene with a
 * new empty one. So opening a board and leaving the page within the autosave
 * delay wrote an empty scene over the stored drawing. Here there is no editor to
 * read: a write carries the scene the change callback SAW, and nothing else.
 */

interface Scene {
  readonly label: string;
}

function observed(boardId: string, version: number, label = `v${String(version)}`): SceneObservation<Scene> {
  return { boardId, version, scene: { label } };
}

describe("CanvasAutosave", () => {
  let writes: { boardId: string; label: string; version: number }[];
  let results: boolean[];
  let autosave: CanvasAutosave<Scene>;

  beforeEach(() => {
    vi.useFakeTimers();
    writes = [];
    results = [];
    autosave = new CanvasAutosave<Scene>(async (observation) => {
      writes.push({
        boardId: observation.boardId,
        label: observation.scene.label,
        version: observation.version,
      });
      return results.shift() ?? true;
    }, 800);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing for a board that was opened and closed", async () => {
    // The first thing the editor reports is the board as it was loaded.
    autosave.observe(observed("a", 14));
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes).toEqual([]);
  });

  it("writes an edit once, after the delay, and not before", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15));
    autosave.observe(observed("a", 16));
    await vi.advanceTimersByTimeAsync(799);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ boardId: "a", label: "v16", version: 16 }]);
  });

  it("writes the scene it SAW when the page is left mid-delay — the defect", async () => {
    autosave.observe(observed("a", 14, "the loaded drawing"));
    autosave.observe(observed("a", 15, "the drawing, edited"));
    // The editor is gone by now; the autosave never asked it for anything.
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes).toEqual([{ boardId: "a", label: "the drawing, edited", version: 15 }]);
  });

  it("does not rewrite a scene whose version has not moved", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15));
    await vi.advanceTimersByTimeAsync(800);
    // A pan, a zoom or a selection: the callback fires, the version does not move.
    autosave.observe(observed("a", 15));
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes.map((write) => write.version)).toEqual([15]);
  });

  it("files the edit under the board it was made on, across a switch", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15, "edit on a"));
    autosave.flush(); // the click that switches boards
    autosave.observe(observed("b", 7, "b as loaded"));
    await vi.runAllTimersAsync();
    expect(writes).toEqual([{ boardId: "a", label: "edit on a", version: 15 }]);
  });

  it("settles the previous board itself when the next one reports, even unflushed", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15, "edit on a"));
    // Nobody flushed. The next board's first report is still not an edit to
    // `b` — and it is what writes `a`'s owed edit.
    autosave.observe(observed("b", 0, "b before its data arrived"));
    await vi.runAllTimersAsync();
    expect(writes).toEqual([{ boardId: "a", label: "edit on a", version: 15 }]);
  });

  it("treats the next board's first report as its baseline, not as an edit", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("b", 7));
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes).toEqual([]);
  });

  it("keeps a failed write owed, so the next flush sends it", async () => {
    results.push(false);
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15));
    await vi.advanceTimersByTimeAsync(800);
    expect(writes.map((write) => write.version)).toEqual([15]);
    // Nothing new was drawn, but the drawing on screen is still not on disk.
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes.map((write) => write.version)).toEqual([15, 15]);
  });

  it("does not send the same edit twice while the first write is still in flight", async () => {
    autosave.observe(observed("a", 14));
    autosave.observe(observed("a", 15));
    // The timer fires and its write is on the wire; the page is left before it lands.
    vi.advanceTimersByTime(800);
    autosave.flush();
    await vi.runAllTimersAsync();
    expect(writes.map((write) => write.version)).toEqual([15]);
  });
});
