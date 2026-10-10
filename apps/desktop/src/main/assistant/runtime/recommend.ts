/**
 * THREE PICKS PER MACHINE, AND THE ARITHMETIC BEHIND EACH ONE.
 *
 * The rule the brief fixes, in one sentence: *the weights plus the KV cache at
 * a useful context must fit in VRAM for a full offload, or in a stated share of
 * free RAM for a CPU run.* Everything here is that sentence made executable, and
 * the two numbers it needs are stated constants:
 *
 *   - **`CHAT_CONTEXT_TOKENS` = 8192.** The context is the second half of the
 *     fit, and at 262 144 tokens (what the Qwen3.5 family is trained for) the
 *     KV cache alone is several times the weights — a catalogue that quoted a
 *     model's TRAINED context and sized for it would recommend models nobody
 *     can run. The runtime therefore loads 8192 and the stored estimates are
 *     made at 8192 (`scripts/assistant-catalogue.mjs --fit` writes that same
 *     number into every entry, and `catalogue.test.ts` holds the two together).
 *   - **`CPU_RAM_SHARE` = 0.6 and `VRAM_FIT_SHARE` = 0.9.** A model that uses
 *     everything free will thrash the moment anything else runs. Sixty percent
 *     of free RAM leaves the OS, the app and its encrypted database their room;
 *     ninety percent of free VRAM is a round number above the 8 % padding
 *     `getLlama` itself applies (`LlamaOptions.vramPadding`), so a pick that
 *     fits here also fits the library's own `gpuLayers: "auto"` placement.
 *
 * TWO ORDERING DECISIONS THAT THE ARITHMETIC DOES NOT MAKE FOR YOU.
 *
 *   1. **A full offload wins over a bigger model on the CPU.** The picks are
 *      drawn from the models that fit in VRAM whenever ANY of them does, and
 *      only fall back to the CPU pool when none does. A model that has to run
 *      on the CPU is an order of magnitude slower per token, so "the biggest
 *      model that fits somewhere" would hand the user the slowest assistant on
 *      the machine that could have run a faster one.
 *   2. **Within the pool, size orders the tiers.** Every chat entry is a
 *      four-bit quantisation, so file size IS capacity: `speed` is the smallest
 *      that fits, `intelligence` the largest, `balance` the middle of what is
 *      left. No family is favoured — the rule is the machine's, not a
 *      maintainer's taste — and when only one model fits, all three tiers name
 *      it with the reason each tier means.
 *
 * NO PICK IS AN ANSWER TOO. When nothing fits, this returns an empty list and
 * `noRecommendation` carries the sentence that says so — "there is not enough
 * memory for any model, and here is the number" — because recommending a model
 * that will thrash is worse than recommending none. The two cases an empty list
 * can mean (nothing fits, and the list itself is unreadable) are told apart
 * there, so a screen never has to guess which one it is looking at.
 */

import type { AssistantText, HardwareProfile, ModelEntry, ModelRecommendation, ModelTier } from "@nexus/core";
import { fitOf } from "./catalogue.js";

/** The context every stored estimate is made at, and the context the runtime loads. */
export const CHAT_CONTEXT_TOKENS = 8192;

/** How much of the free VRAM a pick may need. See the header for the reason it is not 1. */
export const VRAM_FIT_SHARE = 0.9;

/** How much of the free RAM a CPU run may need. */
export const CPU_RAM_SHARE = 0.6;

/** Bytes in a gibibyte, for the copy only. The estimate itself is in bytes. */
const GIB = 1024 * 1024 * 1024;

/**
 * One pick per tier, most capable first, or an empty list when nothing fits.
 *
 * The signature is the contract's (`readonly ModelEntry[]`), so an entry whose
 * fit is unknown — a search result, an imported file — is skipped rather than
 * assumed to fit: `catalogue.ts` is the only place that knows the shape of the
 * stored estimates, and it answers `null` for anything else.
 */
export function recommend(
  hardware: HardwareProfile,
  catalogue: readonly ModelEntry[],
): readonly ModelRecommendation[] {
  const candidates = catalogue.flatMap((entry) => {
    const fit = fitOf(entry);
    if (fit === null || !entry.capabilities.includes("chat")) return [];
    const gpu = fitsOnCard(hardware, fit);
    const cpu = fitsInMemory(hardware, fit);
    if (!gpu && !cpu) return [];
    return [{ entry, fit, onCard: gpu }];
  });
  if (candidates.length === 0) return [];

  const pool = candidates.some((candidate) => candidate.onCard)
    ? candidates.filter((candidate) => candidate.onCard)
    : candidates;
  const ordered = [...pool].sort((left, right) => {
    if (left.entry.sizeBytes !== right.entry.sizeBytes) return left.entry.sizeBytes - right.entry.sizeBytes;
    // A stable tie-break, so two entries of the same size always order the same
    // way and a user does not see the picks swap between two openings.
    return left.entry.id < right.entry.id ? -1 : 1;
  });

  const smallest = ordered[0] as (typeof ordered)[number];
  const largest = ordered[ordered.length - 1] as (typeof ordered)[number];
  const middle = ordered[Math.floor((ordered.length - 1) / 2)] as (typeof ordered)[number];

  return [
    recommendation("intelligence", largest),
    recommendation("balance", middle),
    recommendation("speed", smallest),
  ];
}

/**
 * Why there is no pick, or `null` when there is one.
 *
 * Two sentences, because an empty list has two causes and only one of them is
 * about memory: a list with no entries this build can size (an unreadable or
 * empty catalogue, or one whose every entry needs more than this machine has)
 * is not the same thing as a machine that is too small, and saying "buy more
 * RAM" to a user whose catalogue failed to load would be a wrong answer.
 */
export function noRecommendation(
  hardware: HardwareProfile,
  catalogue: readonly ModelEntry[],
): AssistantText | null {
  if (recommend(hardware, catalogue).length > 0) return null;

  const sized = catalogue.flatMap((entry) => {
    const fit = fitOf(entry);
    return fit === null || !entry.capabilities.includes("chat") ? [] : [{ entry, fit }];
  });
  if (sized.length === 0) {
    return {
      sr: "Ponuda modela trenutno nije dostupna.",
      en: "The model list is not available right now.",
    };
  }

  const smallest = sized.reduce((left, right) =>
    left.fit.cpuRamBytes <= right.fit.cpuRamBytes ? left : right,
  );
  const needed = gbText(smallest.fit.cpuRamBytes, "sr");
  const neededEn = gbText(smallest.fit.cpuRamBytes, "en");
  const free = gbText(hardware.freeRamBytes, "sr");
  const freeEn = gbText(hardware.freeRamBytes, "en");
  const share = String(Math.round(CPU_RAM_SHARE * 100));
  return {
    sr:
      "Nema dovoljno memorije ni za jedan model iz ponude. Najmanji traži " +
      `${needed} GB, a slobodno je ${free} GB — za model sme da se koristi ${share}% slobodne memorije. ` +
      "Zatvori druge programe ili dodaj memoriju.",
    en:
      "There is not enough memory for any model on the list. The smallest needs " +
      `${neededEn} GB and ${freeEn} GB is free — a model may use ${share}% of the free memory. ` +
      "Close other programs or add memory.",
  };
}

interface Candidate {
  readonly entry: ModelEntry;
  readonly fit: { readonly vramBytes: number; readonly hostRamBytes: number; readonly cpuRamBytes: number };
  readonly onCard: boolean;
}

/** Weights on the card plus the context, and the host side the same run needs. */
function fitsOnCard(
  hardware: HardwareProfile,
  fit: { readonly vramBytes: number; readonly hostRamBytes: number },
): boolean {
  const vram = hardware.gpus.reduce((most, gpu) => Math.max(most, gpu.vramBytes), 0);
  return fit.vramBytes <= vram * VRAM_FIT_SHARE && fit.hostRamBytes <= hardware.freeRamBytes * CPU_RAM_SHARE;
}

/** The whole model and its context in RAM. */
function fitsInMemory(hardware: HardwareProfile, fit: { readonly cpuRamBytes: number }): boolean {
  return fit.cpuRamBytes <= hardware.freeRamBytes * CPU_RAM_SHARE;
}

/**
 * The sentence a tier carries, in both languages.
 *
 * The memory phrase is built per language rather than assembled from a number
 * and a noun, because the two languages put the words in different orders: "u
 * 6,7 GB slobodne VRAM" and "in 6.7 GB of free VRAM" share no fragment long
 * enough to be worth sharing.
 */
function recommendation(tier: ModelTier, candidate: Candidate): ModelRecommendation {
  const bytes = candidate.onCard ? candidate.fit.vramBytes : candidate.fit.cpuRamBytes;
  const memory = {
    sr: candidate.onCard
      ? `${gbText(bytes, "sr")} GB slobodne VRAM`
      : `${gbText(bytes, "sr")} GB slobodne radne memorije`,
    en: candidate.onCard
      ? `${gbText(bytes, "en")} GB of free VRAM`
      : `${gbText(bytes, "en")} GB of free memory`,
  };
  return { tier, model: candidate.entry, reason: reasonFor(tier, memory, candidate.onCard) };
}

function reasonFor(
  tier: ModelTier,
  memory: AssistantText,
  onCard: boolean,
): AssistantText {
  // The GPU/CPU half is appended once rather than repeated in every sentence.
  const where = {
    sr: onCard ? " Radi u celosti na grafičkoj kartici." : " Radi na procesoru, bez pomoći grafičke kartice.",
    en: onCard ? " It runs entirely on the graphics card." : " It runs on the processor, with no help from a graphics card.",
  };
  switch (tier) {
    case "speed":
      return {
        sr: `Najmanji model koji staje u ${memory.sr}. Najbrže odgovara i najmanje memorije zauzima.${where.sr}`,
        en: `The smallest model that fits in ${memory.en}. It answers fastest and uses the least memory.${where.en}`,
      };
    case "balance":
      return {
        sr: `Sredina ponude koja staje u ${memory.sr}: dovoljno sposobno za svakodnevne zadatke, a i dalje brzo.${where.sr}`,
        en: `The middle of what fits in ${memory.en}: capable enough for everyday work and still fast.${where.en}`,
      };
    default:
      return {
        sr: `Najsposobniji model koji staje u ${memory.sr}. Najbolji za složene zadatke i najsporiji od tri ponude.${where.sr}`,
        en: `The most capable model that fits in ${memory.en}. Best for hard tasks and the slowest of the three.${where.en}`,
      };
  }
}

/**
 * A size in gigabytes as a reader's own locale writes numbers.
 *
 * `sr-Latn` because this is the app's Serbian: plain `"sr"` would render a
 * decimal point as a comma only by luck of the default calendar, and the
 * collator rule in `CLAUDE.md` exists for exactly this shape of mistake.
 */
function gbText(bytes: number, locale: "sr" | "en"): string {
  const format = new Intl.NumberFormat(locale === "sr" ? "sr-Latn" : "en", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return format.format(bytes / GIB);
}
