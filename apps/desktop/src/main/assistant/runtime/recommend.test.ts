import type { HardwareProfile, ModelEntry } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { bundledCatalogue } from "./catalogue.js";
import { CHAT_CONTEXT_TOKENS, CPU_RAM_SHARE, VRAM_FIT_SHARE, noRecommendation, recommend } from "./recommend.js";

const GIB = 1024 * 1024 * 1024;

const catalogue = bundledCatalogue();

/** A machine with no usable GPU: the profile the chooser must still answer for. */
function cpuOnly(totalGib: number, freeGib: number, cpuThreads: number): HardwareProfile {
  return {
    totalRamBytes: totalGib * GIB,
    freeRamBytes: freeGib * GIB,
    cpuThreads,
    gpus: [{ name: "CPU", vramBytes: 0, backend: "cpu" }],
  };
}

function withGpu(
  totalGib: number,
  freeGib: number,
  cpuThreads: number,
  name: string,
  freeVramGib: number,
  backend: "cuda" | "vulkan",
): HardwareProfile {
  return {
    totalRamBytes: totalGib * GIB,
    freeRamBytes: freeGib * GIB,
    cpuThreads,
    gpus: [{ name, vramBytes: freeVramGib * GIB, backend }],
  };
}

/**
 * A hand-built chat entry with a measured fit, and a card's count when one is
 * given.
 *
 * For the cases about ORDER rather than about the catalogue: both extra fields
 * are read off whatever entry the chooser is handed (`fitOf` and
 * `activeParametersOf` in `catalogue.ts`), so a fixture exercises the same code
 * the real list does — and a fixture with no count is the state a search result
 * or an imported file is in.
 */
function measuredEntry(id: string, sizeBytes: number, activeParameters?: number): ModelEntry {
  return {
    id,
    origin: "file",
    title: id,
    family: id,
    repo: "",
    file: `${id}-Q4_K_M.gguf`,
    sha256: "d".repeat(64),
    sizeBytes,
    quantization: "Q4_K_M",
    contextTokens: 8192,
    capabilities: ["chat"],
    languages: [],
    licence: { name: "Apache-2.0", url: "https://example.org/licence" },
    fit: { contextTokens: 8192, vramBytes: sizeBytes + 1024, hostRamBytes: 0, cpuRamBytes: sizeBytes + 2048 },
    ...(activeParameters === undefined ? {} : { activeParameters }),
  } as ModelEntry;
}

/**
 * THE MAINTAINER'S LAPTOP, measured rather than assumed.
 *
 * `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv` on
 * 2026-10-10: `NVIDIA GeForce RTX 4070 Laptop GPU, 8188 MiB, 617.42`.
 * `Math.round(os.totalmem())`: 33 963 352 064 bytes (31.6 GiB) — the brief
 * guessed 16 GB for this machine and it has twice that.
 * `os.cpus().length` is 16 and `llama.cpuMathCores` is 10 (the cores llama.cpp
 * counts as useful for math).
 *
 * The VRAM figures are node-llama-cpp's own (`llama.getVramState()`), read
 * through the probe at the same moment: total 25 315 758 080, of which
 * 16 981 676 032 is `unifiedSize` — the Intel iGPU's slice of system RAM, which
 * is not memory a model can be loaded into — and 1 610 612 736 in use. So the
 * dedicated card owns 8 334 082 048 bytes and 6 723 469 312 of those are free,
 * which is the number the chooser spends. The backend is `vulkan`: CUDA is
 * installed and FAILED its own load test on this machine
 * (`getLlamaGpuTypes("supported")` answers `["vulkan", false]`).
 */
const LAPTOP: HardwareProfile = {
  totalRamBytes: 33_963_352_064,
  freeRamBytes: 15_940_681_728,
  cpuThreads: 10,
  gpus: [
    {
      name: "NVIDIA GeForce RTX 4070 Laptop GPU",
      vramBytes: 6_723_469_312,
      backend: "vulkan",
    },
  ],
};

/**
 * THE FOUR PROFILES, WITH THE PICKS THEY PRODUCE.
 *
 * Every pick below is arithmetic on the catalogue's own stored fits, and the
 * rule is stated in `recommend.ts`: a model fits the card when
 * `vramBytes ≤ 0.9 × free VRAM` and `hostRamBytes ≤ 0.6 × free RAM`, or the
 * machine when `cpuRamBytes ≤ 0.6 × free RAM`; the picks come from the card's
 * pool whenever anything is in it, and are the smallest, the middle and the
 * largest of that pool by the active-parameter count the model's card states,
 * with file size as the tie-break (ADR-113).
 *
 * They are pinned exactly, which means a catalogue refresh that changes a fit
 * legitimately fails this test: that failure IS the review, because the numbers
 * decide which model a user is offered and nobody reads a fit table by eye.
 */
describe("recommend", () => {
  it("8 GB of RAM, no GPU: the one model that fits, named at all three tiers", () => {
    // 6 GiB free × 0.6 = 3.6 GiB of budget. Qwen3.5-4B needs 3.33 GiB of RAM —
    // the only chat entry that fits; Gemma 4 E2B needs 3.68 GiB and does not,
    // and neither does anything bigger.
    const picks = recommend(cpuOnly(8, 6, 4), catalogue);
    expect(picks.map((pick) => pick.tier)).toEqual(["intelligence", "balance", "speed"]);
    expect(picks.map((pick) => pick.model.id)).toEqual([
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-4b-q4-k-m",
    ]);
    // The reason says where it runs and what it needs, in both languages.
    expect(picks[0]?.reason.sr).toContain("procesoru");
    expect(picks[0]?.reason.en).toContain("processor");
    expect(picks[0]?.reason.sr).toContain("3,3");
    expect(picks[0]?.reason.en).toContain("3.3");
  });

  it("this laptop, measured: three picks, all of them fully offloaded", () => {
    const picks = recommend(LAPTOP, catalogue);
    expect(picks.map((pick) => pick.model.id)).toEqual([
      "gemma-4-e4b-it-q4-0", // 4.5 B active, the most of the three that fit 0.9 × 6.26 GiB
      "qwen3.5-4b-q4-k-m", // 4 B, the middle of the three
      "gemma-4-e2b-it-q4-0", // 2.3 B effective, the fewest — and 3.68 GiB of VRAM
    ]);
    for (const pick of picks) expect(pick.reason.sr).toContain("grafičkoj kartici");
    // Three entries fit the card: Gemma 4 E2B (3.68 GiB), Qwen3.5 4B (3.33 GiB)
    // and Gemma 4 E4B (5.48 GiB). The 9B is 6.08 GiB and misses the
    // 0.9 × 6.26 = 5.63 GiB budget, so it is not in the pool at all — the pool
    // is the card's whenever anything is in it. The reason the budget exists is
    // that the free figure is a snapshot.
    expect(picks.map((pick) => pick.model.id)).not.toContain("qwen3.5-9b-q4-k-m");
  });

  it("32 GB with a 12 GB GPU: the biggest model that fits the card wins", () => {
    // 12 GiB of VRAM × 0.9 = 10.8 GiB, and 20 GiB of RAM × 0.6 = 12 GiB.
    // Qwen3.5-27B needs 16.74 GiB either way and is the one chat entry that
    // misses both, so six are in the pool.
    const picks = recommend(withGpu(32, 20, 16, "12 GB GPU", 12, "cuda"), catalogue);
    expect(picks.map((pick) => pick.model.id)).toEqual([
      "slava-qwen3-14b-serbian-q4-k-m", // 14.8 B: fits 9.94 GiB, and it is the most that does
      "gemma-4-e4b-it-q4-0", // the middle of the six that fit: 4.5 B
      "gemma-4-e2b-it-q4-0", // 2.3 B effective, the fewest
    ]);
  });

  it("64 GB without a GPU: the 27B is recommended, on the processor", () => {
    // 48 GiB × 0.6 = 28.8 GiB of budget, which only a CPU run can reach. Every
    // chat entry fits it, so the pool is all seven and the picks are the ends and
    // the middle of their active counts: 2.3, 4, 4.5, 9, 11.95, 14.8, 27 B.
    const picks = recommend(cpuOnly(64, 48, 16), catalogue);
    expect(picks.map((pick) => pick.model.id)).toEqual([
      "qwen3.5-27b-q4-k-m",
      "qwen3.5-9b-q4-k-m",
      "gemma-4-e2b-it-q4-0",
    ]);
    expect(picks[0]?.reason.en).toContain("processor");
  });

  it("prefers a full offload over a bigger model that would run on the processor", () => {
    // 4 GiB of free VRAM × 0.9 = 3.6 GiB fits Qwen3.5-4B (3.33 GiB) and nothing
    // else: Gemma 4 E2B needs 3.68 GiB and misses it, which is why the 4B is the
    // only entry in the pool and all three tiers name it.
    //
    // 16 GiB of RAM × 0.6 = 9.6 GiB would ALSO fit Gemma 4 E2B (3.68 GiB),
    // Qwen3.5-9B (6.08 GiB), Gemma 4 E4B (5.48 GiB) and Gemma 4 12B (7.68 GiB)
    // on the processor. The card's pool wins, so a model that would run slowly is
    // not offered while a fully offloaded one exists — which is the rule this
    // case exists to pin.
    const picks = recommend(withGpu(16, 16, 8, "4 GB GPU", 4, "vulkan"), catalogue);
    expect(picks.map((pick) => pick.model.id)).toEqual([
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-4b-q4-k-m",
    ]);
    expect(picks.map((pick) => pick.model.id)).not.toContain("qwen3.5-9b-q4-k-m");
  });

  it("says so, in both languages, when nothing fits", () => {
    const tiny = cpuOnly(4, 2, 2);
    expect(recommend(tiny, catalogue)).toEqual([]);
    const reason = noRecommendation(tiny, catalogue);
    expect(reason?.sr).toContain("Nema dovoljno memorije");
    expect(reason?.en).toContain("not enough memory");
    // The numbers in the sentence are the machine's and the smallest model's.
    expect(reason?.sr).toContain("3,3");
    expect(reason?.en).toContain("3.3");
  });

  it("tells an unreadable catalogue apart from a machine that is too small", () => {
    const reason = noRecommendation(cpuOnly(64, 48, 16), []);
    expect(reason?.sr).toBe("Ponuda modela trenutno nije dostupna.");
    expect(reason?.en).toBe("The model list is not available right now.");
    expect(noRecommendation(LAPTOP, catalogue)).toBeNull();
  });

  it("skips an entry whose fit nobody measured, rather than assuming it fits", () => {
    const withoutFit: ModelEntry = {
      id: "search-result",
      origin: "huggingface",
      title: "Some model",
      family: "someone/repo",
      repo: "someone/repo",
      file: "model-Q4_K_M.gguf",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      quantization: "Q4_K_M",
      contextTokens: 0,
      capabilities: ["chat"],
      languages: [],
      licence: { name: "apache-2.0", url: "https://huggingface.co/someone/repo" },
    };
    const picks = recommend(cpuOnly(64, 48, 16), [withoutFit]);
    expect(picks).toEqual([]);
    // ...and its absence is not reported as a memory problem.
    expect(noRecommendation(cpuOnly(64, 48, 16), [withoutFit])?.en).toContain("not available");
  });

  it("skips an entry whose active-parameter count this build does not have", () => {
    // The catalogue's own reader refuses an entry without a count, so this is a
    // shape only a hand-built list can have — and a list of one is not a machine
    // with too little memory, it is a list with nothing to rank.
    expect(recommend(cpuOnly(64, 48, 16), [measuredEntry("countless", 1024)])).toEqual([]);
  });

  it("ranks a bigger file with fewer parameters below a dense entry's smaller one", () => {
    // The rule ADR-113 replaced: a file's size is not what a token costs. Gemma
    // 4's E-models carry per-layer embedding tables, so the entry with the bigger
    // file here is the one the machine should offer as `speed`.
    const withTables = measuredEntry("gemma-like", 3_349_516_256, 2_300_000_000);
    const dense = measuredEntry("dense-like", 2_740_937_888, 4_000_000_000);
    const picks = recommend(cpuOnly(64, 48, 16), [withTables, dense]);
    expect(picks.map((pick) => [pick.tier, pick.model.id])).toEqual([
      ["intelligence", "dense-like"],
      // Two entries, and the middle of the list is `ordered[floor((2 − 1) / 2)]`:
      // the lower one, the existing rule for an even count.
      ["balance", "gemma-like"],
      ["speed", "gemma-like"],
    ]);
  });

  it("states the context the estimates are made at", () => {
    expect(CHAT_CONTEXT_TOKENS).toBe(8192);
    // Every entry's stored fit was measured at exactly that context, which is
    // what makes "the weights plus the KV cache" mean one thing in both files.
    for (const entry of catalogue) {
      if (entry.capabilities.includes("chat")) {
        expect((entry as { fit?: { contextTokens: number } }).fit?.contextTokens, entry.id).toBe(CHAT_CONTEXT_TOKENS);
      }
    }
    expect(VRAM_FIT_SHARE).toBe(0.9);
    expect(CPU_RAM_SHARE).toBe(0.6);
  });
});
