import { describe, expect, it } from "vitest";

import type { PackDownloadProgress } from "../../shared/ipc.js";
import { transferView } from "./packsProgress.js";

function progress(overrides: Partial<PackDownloadProgress> = {}): PackDownloadProgress {
  return {
    id: "astronomy",
    phase: "download",
    file: "images/sky.webp",
    filesDone: 1,
    filesTotal: 4,
    bytesDone: 500,
    bytesTotal: 1_000,
    ...overrides,
  };
}

describe("pack transfer progress", () => {
  it("uses bytes for the percentage and derives a measured speed", () => {
    const first = transferView(progress(), null, 1_000, false);
    const second = transferView(progress({ bytesDone: 700 }), first.sample, 1_500, false);
    expect(second.percent).toBe(70);
    expect(second.speedBytesPerSecond).toBe(400);
    expect(second.elapsedMs).toBe(500);
  });

  it("clamps malformed totals instead of drawing outside the bar", () => {
    const view = transferView(
      progress({ bytesDone: 2_000, bytesTotal: 1_000 }),
      null,
      1_000,
      false,
    );
    expect(view.percent).toBe(100);
  });

  it("does not count time spent paused, and no speed is claimed while paused", () => {
    const first = transferView(progress(), null, 1_000, false);
    const paused = transferView(progress(), first.sample, 1_500, true);
    const resumed = transferView(progress({ bytesDone: 600 }), paused.sample, 3_000, false);
    const moving = transferView(progress({ bytesDone: 800 }), resumed.sample, 3_500, false);
    expect(resumed.sample.pausedMs).toBe(1_500);
    expect(resumed.speedBytesPerSecond).toBeNull();
    expect(moving.elapsedMs).toBe(1_000);
    expect(moving.speedBytesPerSecond).toBe(400);
  });
});
