import { describe, expect, it } from "vitest";

import { createHardwareCache, hardwareFromReading, type HardwareReading } from "./hardware.js";

/**
 * The one arithmetic step between what llama.cpp reports and what the chooser
 * spends, on the maintainer's own machine and on a machine with no usable GPU.
 *
 * The laptop's reading is the measured one (2026-10-10, `llama.getVramState()`):
 * `total` sums the dedicated card and the Intel iGPU's slice of system RAM, which
 * is why `unifiedSize` is subtracted before `used` is, and why the answer is
 * 6 723 469 312 bytes of usable VRAM rather than the 23.6 GiB a naive reading of
 * `total - used` would give.
 */
describe("hardwareFromReading", () => {
  it("attributes the dedicated VRAM to the card llama.cpp offloads to", () => {
    const reading: HardwareReading = {
      totalRamBytes: 33_963_352_064,
      freeRamBytes: 15_940_681_728,
      cpuThreads: 10,
      backend: "vulkan",
      deviceNames: ["NVIDIA GeForce RTX 4070 Laptop GPU", "Intel(R) UHD Graphics"],
      vramBytes: 25_315_758_080,
      unifiedVramBytes: 16_981_676_032,
      usedVramBytes: 1_610_612_736,
    };
    const profile = hardwareFromReading(reading);
    expect(profile).toEqual({
      totalRamBytes: 33_963_352_064,
      freeRamBytes: 15_940_681_728,
      cpuThreads: 10,
      gpus: [
        {
          name: "NVIDIA GeForce RTX 4070 Laptop GPU",
          vramBytes: 6_723_469_312, // 25 315 758 080 − 16 981 676 032 − 1 610 612 736
          backend: "vulkan",
        },
      ],
    });
  });

  it("says 'no GPU' with one entry rather than an empty list", () => {
    const reading: HardwareReading = {
      totalRamBytes: 8 * 1024 * 1024 * 1024,
      freeRamBytes: 5 * 1024 * 1024 * 1024,
      cpuThreads: 4,
      backend: "cpu",
      deviceNames: [],
      vramBytes: 0,
      unifiedVramBytes: 0,
      usedVramBytes: 0,
    };
    expect(hardwareFromReading(reading).gpus).toEqual([
      { name: "CPU", vramBytes: 0, backend: "cpu" },
    ]);
  });

  it("treats a card with nothing free as a CPU-only machine", () => {
    const reading: HardwareReading = {
      totalRamBytes: 32 * 1024 * 1024 * 1024,
      freeRamBytes: 16 * 1024 * 1024 * 1024,
      cpuThreads: 12,
      backend: "cuda",
      deviceNames: ["Some card"],
      vramBytes: 1_000_000_000,
      unifiedVramBytes: 1_000_000_000,
      usedVramBytes: 0,
    };
    expect(hardwareFromReading(reading).gpus).toEqual([
      { name: "Some card", vramBytes: 0, backend: "cpu" },
    ]);
  });

  it("never answers a negative size, whatever the reading claims", () => {
    const reading: HardwareReading = {
      totalRamBytes: 16 * 1024 * 1024 * 1024,
      freeRamBytes: 8 * 1024 * 1024 * 1024,
      cpuThreads: 8,
      backend: "vulkan",
      deviceNames: ["Odd card"],
      vramBytes: 4_000_000_000,
      unifiedVramBytes: 1_000_000_000,
      usedVramBytes: 9_000_000_000,
    };
    const gpu = hardwareFromReading(reading).gpus[0];
    expect(gpu?.vramBytes).toBe(0);
    expect(gpu?.backend).toBe("cpu");
  });
});

describe("createHardwareCache", () => {
  it("reads once per session and forgets a failed reading", async () => {
    let reads = 0;
    const profile = {
      totalRamBytes: 1,
      freeRamBytes: 1,
      cpuThreads: 1,
      gpus: [{ name: "CPU", vramBytes: 0, backend: "cpu" as const }],
    };
    const cache = createHardwareCache(() => {
      reads += 1;
      return Promise.resolve(profile);
    });
    expect(await cache()).toEqual(profile);
    expect(await cache()).toEqual(profile);
    expect(reads).toBe(1);

    let attempts = 0;
    const flaky = createHardwareCache(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("the addon would not load")) : Promise.resolve(profile);
    });
    await expect(flaky()).rejects.toThrow(/addon would not load/);
    // A reading that failed is not a reading: the next caller tries again rather
    // than receiving a cached failure for the rest of the session.
    expect(await flaky()).toEqual(profile);
    expect(attempts).toBe(2);
  });
});
