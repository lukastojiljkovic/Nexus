/**
 * WHAT THIS MACHINE HAS, AS node-llama-cpp ITSELF SEES IT.
 *
 * The model chooser has one job before it can say anything: know how much the
 * machine can hold. Every number below comes from llama.cpp's own detection
 * rather than from a system API, and that is deliberate — the question is not
 * "how much RAM does Windows report" but "how much will llama.cpp be able to
 * use", and only the library knows what it will count (its `.cpuMathCores`, the
 * GPU type it can actually LOAD, the VRAM its own addon reports).
 *
 * **The reading is taken once per session** (`createHardwareCache`) and reused:
 * a reading costs a native load, and every surface that wants to show a pick
 * wants the same reading. A user who upgrades their GPU gets the new answer on
 * the next launch, which is also when llama.cpp would next pick a backend.
 *
 * TWO CONSEQUENCES OF THE LIBRARY'S SHAPE ARE VISIBLE HERE, AND NEITHER IS A
 * GUESS:
 *
 *   - **VRAM is one aggregate figure and a list of names.** `getVramState()`
 *     answers `{total, used, free, unifiedSize}` for the whole system, and
 *     `getGpuDeviceNames()` answers names with no sizes. On this maintainer's
 *     laptop that total is 23.6 GiB, of which 15.8 GiB is `unifiedSize` — the
 *     Intel iGPU's slice of system RAM, which is not memory a model can be
 *     loaded into. `dedicated = total - unifiedSize` is therefore what the card
 *     owns, and the free figure subtracts the bytes already in use, which the
 *     reading charges wholly to the dedicated card — conservative in the
 *     direction that refuses a model rather than one that thrashes.
 *   - **One entry, the card llama.cpp offloads to.** The per-device split is not
 *     knowable, so the attributed figure goes to the first name in the list —
 *     the one llama.cpp enumerates first, and the one `gpuLayers: "auto"`
 *     fills. A second real GPU is therefore under-reported, which is a
 *     limitation rather than a claim: `HardwareProfile.gpus` says what this
 *     build can establish.
 */

import type { GpuInfo, HardwareProfile } from "@nexus/core";

/** The backends llama.cpp can be built with, as the app records them. */
export type GpuBackend = GpuInfo["backend"];

/** What one probe of this machine answered. Plain data, so a test can state a machine. */
export interface HardwareReading {
  readonly totalRamBytes: number;
  readonly freeRamBytes: number;
  /** `llama.cpuMathCores`: the cores llama.cpp will actually use for math. */
  readonly cpuThreads: number;
  /** The backend the library LOADED, which is the only proof that one works. */
  readonly backend: GpuBackend;
  readonly deviceNames: readonly string[];
  readonly vramBytes: number;
  readonly unifiedVramBytes: number;
  readonly usedVramBytes: number;
}

/**
 * The profile the rest of the runtime reads, from one reading.
 *
 * `gpus` is never empty: a machine with no usable GPU gets one entry that says
 * so (`backend: "cpu"`, no VRAM), because "no GPU" is a fact a chooser has to be
 * able to see and an empty list is a fact it has to remember to check.
 */
export function hardwareFromReading(reading: HardwareReading): HardwareProfile {
  const dedicated = Math.max(0, reading.vramBytes - reading.unifiedVramBytes);
  const freeVram = Math.max(0, dedicated - reading.usedVramBytes);
  const gpus: GpuInfo[] =
    reading.backend === "cpu" || freeVram === 0
      ? [{ name: reading.deviceNames[0] ?? "CPU", vramBytes: 0, backend: "cpu" }]
      : [{ name: reading.deviceNames[0] ?? reading.backend, vramBytes: freeVram, backend: reading.backend }];

  return {
    totalRamBytes: reading.totalRamBytes,
    freeRamBytes: reading.freeRamBytes,
    cpuThreads: reading.cpuThreads,
    gpus,
  };
}

/**
 * One reading, cached for the life of the process. A failed reading is not cached.
 *
 * `read` is whoever can produce a profile — in the app that is the utility
 * process, because the detection loads the native addon and main never does
 * (ADR-096), and in a test it is a fixture.
 */
export function createHardwareCache(read: () => Promise<HardwareProfile>): () => Promise<HardwareProfile> {
  let pending: Promise<HardwareProfile> | null = null;
  return async () => {
    pending ??= read().catch((error: unknown) => {
        // A reading that failed is not a reading. Forgetting it means the next
        // caller tries again rather than receiving a cached failure for the
        // rest of the session.
        pending = null;
        throw error;
      });
    return await pending;
  };
}
