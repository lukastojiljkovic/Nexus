import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { capture } from "./index.js";

/**
 * The sweep's one irreducible operation, and the one that can fail for reasons
 * that have nothing to do with the app.
 *
 * `capturePage()` asks Chromium's compositor for a bitmap and the compositor is
 * entitled to answer with nothing — `VizSentEmptyBitmap` as a rejection, or a
 * zero-sized image as a success. Both were fatal to a run that had already
 * taken 2 200 frames, and neither is reproducible on demand, which is why this
 * suite fakes the window rather than opening one: the retry is a rule, and a
 * rule can be stated.
 *
 * The fake is honest about how little `capture` touches — a `capturePage` that
 * answers something with `isEmpty()` and `toPNG()` is the entire contract.
 */

interface FakeImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

const PIXEL = Buffer.from("PNG-BYTES");

const good: FakeImage = { isEmpty: () => false, toPNG: () => PIXEL };
const blank: FakeImage = {
  isEmpty: () => true,
  toPNG: () => Buffer.alloc(0),
};

/** A window whose compositor answers the given script, one entry per attempt. */
function windowAnswering(script: readonly (FakeImage | Error)[]): {
  win: BrowserWindow;
  attempts: () => number;
} {
  let attempt = 0;
  const win = {
    webContents: {
      capturePage: async (): Promise<FakeImage> => {
        const answer = script[attempt] ?? script[script.length - 1];
        attempt += 1;
        if (answer instanceof Error) throw answer;
        return answer ?? good;
      },
    },
  } as unknown as BrowserWindow;
  return { win, attempts: () => attempt };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-shots-capture-"));
  file = join(dir, "frame.png");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("capture", () => {
  it("writes the frame and asks once when the first answer is a frame", async () => {
    const { win, attempts } = windowAnswering([good]);
    await capture(win, file);
    expect(readFileSync(file)).toEqual(PIXEL);
    expect(attempts()).toBe(1);
  });

  it("retries the rejection that ended a 2 200-frame run", async () => {
    const { win, attempts } = windowAnswering([new Error("VizSentEmptyBitmap"), good]);
    await capture(win, file);
    expect(readFileSync(file)).toEqual(PIXEL);
    expect(attempts()).toBe(2);
  });

  /**
   * The half that does not throw. An empty image is a successful call, so
   * nothing in the language marks it — without this branch the sweep would
   * write a zero-byte PNG, report the frame as taken, and the reader would meet
   * a page that apparently rendered nothing.
   */
  it("treats an empty image as a failed attempt rather than as a frame", async () => {
    const { win, attempts } = windowAnswering([blank, good]);
    await capture(win, file);
    expect(readFileSync(file)).toEqual(PIXEL);
    expect(attempts()).toBe(2);
  });

  it("gives up after four attempts and says which failure it gave up on", async () => {
    const { win, attempts } = windowAnswering([new Error("VizSentEmptyBitmap")]);
    await expect(capture(win, file)).rejects.toThrow("VizSentEmptyBitmap");
    expect(attempts()).toBe(4);
  });

  /** A run of empties ends with a message naming the file, not an empty string. */
  it("names the frame it could not take when every answer is empty", async () => {
    const { win } = windowAnswering([blank]);
    await expect(capture(win, file)).rejects.toThrow(file);
  });
});
