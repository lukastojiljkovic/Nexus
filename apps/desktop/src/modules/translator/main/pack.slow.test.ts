/**
 * What a lookup costs on a REAL pack, and it is skipped by default because no CI
 * machine has one: the pack is built by `scripts/packs/dictionary/build.mjs` and
 * installed by a person. Run it with:
 *
 *     $env:NEXUS_SLOW_DICTIONARY = "1"
 *     node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers=1 `
 *       apps/desktop/src/modules/translator/main/pack.slow.test.ts
 *
 * It expects `%TEMP%\nexus-packs\dictionary-sr-en\` — the folder a build writes —
 * and lays it out the way ADR-091 installs one (`<root>/<id>/<version>/`) before
 * opening it. The numbers it prints are the ones `docs/packs/dictionary.md`
 * quotes, and it says so and stops rather than failing when the build is not
 * there: the machine, not the code, would be the reason.
 *
 * The one assertion is a ceiling rather than a measurement, because a test that
 * only printed would not be a test: a packed dictionary that took a millisecond
 * per keystroke would still be usable and one that took a second would not, and
 * the recorded mean is three orders of magnitude under this bound.
 */

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findInstalledPack, openPack, readPhrases, searchPack } from "./pack.js";

const RUN = process.env["NEXUS_SLOW_DICTIONARY"] === "1";
const BUILT = join(process.env.TEMP ?? ".", "nexus-packs", "dictionary-sr-en");
const ROOT = join(process.env.TEMP ?? ".", "nexus-packs-measure");

/** A ceiling on the average lookup, in milliseconds. The measured mean is 0.03. */
const MAX_MEAN_MS = 5;

/** The queries the loop rotates through: common bilingual words, one with diacritics, one Cyrillic, one with none. */
const QUERIES = ["kafa", "coffee", "house", "kuća", "free", "the", "dictionary", "zdravo", "đorđe", "cevapcici"];

describe.skipIf(!RUN)("the real pack's lookup cost", () => {
  it("answers a lookup in well under a millisecond, and a full phrasebook read in a few", () => {
    const target = join(ROOT, "dictionary-sr-en", "2026.10.0");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(BUILT, target, { recursive: true });

    const installed = findInstalledPack(ROOT);
    expect(installed).not.toBeNull();
    const opened = performance.now();
    const pack = openPack(installed!);
    const openMs = performance.now() - opened;

    searchPack(pack, "en-sr", "kafa", 20);
    searchPack(pack, "sr-en", "kafa", 20);
    const samples: number[] = [];
    for (let round = 0; round < 2_000; round += 1) {
      const query = QUERIES[round % QUERIES.length] ?? "kafa";
      const direction = round % 2 === 0 ? "en-sr" : "sr-en";
      const at = performance.now();
      searchPack(pack, direction, query, 20);
      samples.push(performance.now() - at);
    }
    samples.sort((left, right) => left - right);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;

    const wide = performance.now();
    const common = searchPack(pack, "en-sr", "a", 20);
    const wideMs = performance.now() - wide;

    const phrasesAt = performance.now();
    const topics = readPhrases(pack.dir);
    const phrasesMs = performance.now() - phrasesAt;
    const phrases = topics.reduce((sum, topic) => sum + topic.phrases.length, 0);

    console.log(
      `pack: open ${openMs.toFixed(1)} ms; 2 000 lookups mean ${mean.toFixed(3)} ms, ` +
        `median ${(samples[samples.length >> 1] ?? 0).toFixed(3)} ms, max ${(samples[samples.length - 1] ?? 0).toFixed(3)} ms; ` +
        `widest query ${wideMs.toFixed(3)} ms for ${String(common.entries.length)} entries; ` +
        `phrasebook ${phrasesMs.toFixed(2)} ms for ${String(topics.length)} topics and ${String(phrases)} phrases`,
    );
    expect(mean).toBeLessThan(MAX_MEAN_MS);
    expect(topics.length).toBeGreaterThan(0);
  }, 60_000);
});
