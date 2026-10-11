/**
 * The real models, once, on a real sentence, by hand.
 *
 * Everything else in this folder is arithmetic on synthetic signals, which is
 * the right way to test a resampler and the wrong way to find out whether the
 * ONNX files this app ships actually load. This file is the one that runs
 * Whisper and a VITS voice for real, and it is skipped unless
 * `NEXUS_VOICE_SMOKE=1` because it needs model packs on disk and a minute of
 * the machine's attention.
 *
 * WHAT IT MEASURES, and why the numbers are worth having: a real-time factor
 * per model (see `metrics.ts`). They are the numbers `ADR-105` quotes when it
 * says which Whisper size this laptop can run and how much slower the Serbian
 * transcription is than the English one. `docs/packs/voice.md` says how to
 * build the packs it needs; it downloads nothing itself, so nothing here can
 * reach the network even by accident.
 *
 *   set NEXUS_VOICE_SMOKE=1
 *   set NEXUS_VOICE_SMOKE_PACKS=%TEMP%\nexus-packs
 *   node node_modules/vitest/vitest.mjs run --configLoader runner \
 *        src/main/assistant/voice/inference.smoke.test.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSynthesizer, loadTranscriber, type Synthesizer, type Transcriber } from "./inference.js";
import { formatRealTimeFactor, realTimeFactor } from "./metrics.js";
import { decodeWav, encodeWav } from "./wav.js";

/** The switch, spelled once. */
const SMOKE = process.env["NEXUS_VOICE_SMOKE"] === "1";
const PACKS_ROOT = process.env["NEXUS_VOICE_SMOKE_PACKS"] ?? join(tmpdir(), "nexus-packs");
/** A folder of Serbian WAVs to read, when the machine has one. */
const SERBIAN_DIR = process.env["NEXUS_VOICE_SMOKE_SR"];

/** The English sentence both halves run on: distinctive words, no names, no digits. */
const SENTENCE = "The helicopter is coming at dawn and the water is clean.";

/** Fraction of the expected words that appear in the transcript, in any order. */
function wordOverlap(actual: string, expected: string): number {
  const words = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word !== "");
  const heard = new Set(words(actual));
  const wanted = words(expected);
  return wanted.filter((word) => heard.has(word)).length / wanted.length;
}

/** Milliseconds a promise took. */
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = Date.now();
  const value = await work();
  return { value, elapsedMs: Date.now() - startedAt };
}

function packDirectory(id: string): string {
  return join(PACKS_ROOT, id);
}

describe.skipIf(!SMOKE)("voice smoke", () => {
  let transcriber: Transcriber | null = null;
  let synthesizer: Synthesizer | null = null;
  let spokenWav: Uint8Array | null = null;

  it("synthesizes an English sentence and reports the real-time factor", async () => {
    const directory = packDirectory("mms-tts-eng");
    expect(existsSync(directory), `build the pack first: ${directory}`).toBe(true);

    const loaded = await timed(() => loadSynthesizer(directory));
    synthesizer = loaded.value;
    const spoken = await timed(() => loaded.value.speak(SENTENCE));

    const audioSeconds = spoken.value.pcm.length / spoken.value.sampleRate;
    const factor = realTimeFactor(spoken.value.pcm.length, spoken.value.sampleRate, spoken.elapsedMs);
    console.log(
      `[voice smoke] tts mms-tts-eng: load ${String(loaded.elapsedMs)} ms, ` +
        `${audioSeconds.toFixed(2)} s of audio in ${String(spoken.elapsedMs)} ms = ${formatRealTimeFactor(factor)}`,
    );

    expect(spoken.value.sampleRate).toBe(16_000);
    expect(spoken.value.pcm.length).toBeGreaterThan(16_000); // more than a second
    // The samples are audio and not a constant: a model that returned silence
    // would still satisfy the two assertions above.
    const peak = spoken.value.pcm.reduce((worst, sample) => Math.max(worst, Math.abs(sample)), 0);
    expect(peak).toBeGreaterThan(0.05);

    // Kept in memory rather than written out: the next test is the only reader,
    // and a probe that leaves a file in %TEMP% is a probe somebody finds later.
    spokenWav = encodeWav(spoken.value.pcm, spoken.value.sampleRate);
  }, 300_000);

  it("transcribes what the voice said, and reports the real-time factor", async () => {
    expect(spokenWav, "the synthesis test has to run first").not.toBeNull();
    const directory = packDirectory("whisper-base");
    expect(existsSync(directory), `build the pack first: ${directory}`).toBe(true);

    const loaded = await timed(() => loadTranscriber(directory));
    transcriber = loaded.value;
    const audio = decodeWav(spokenWav as Uint8Array);
    const heard = await timed(() => loaded.value.transcribe(audio.pcm, audio.sampleRate, "en"));

    const factor = realTimeFactor(audio.pcm.length, audio.sampleRate, heard.elapsedMs);
    console.log(
      `[voice smoke] stt whisper-base (en): load ${String(loaded.elapsedMs)} ms, ` +
        `${(audio.pcm.length / audio.sampleRate).toFixed(2)} s of audio in ${String(heard.elapsedMs)} ms = ` +
        `${formatRealTimeFactor(factor)}`,
    );
    console.log(`[voice smoke] heard: ${JSON.stringify(heard.value)}`);

    expect(wordOverlap(heard.value, SENTENCE)).toBeGreaterThanOrEqual(0.6);
  }, 300_000);

  it("transcribes Serbian recordings, when the machine has any", async () => {
    if (transcriber === null) {
      const loaded = await timed(() => loadTranscriber(packDirectory("whisper-base")));
      transcriber = loaded.value;
    }
    if (SERBIAN_DIR === undefined || !existsSync(SERBIAN_DIR)) {
      console.log("[voice smoke] stt sr: no NEXUS_VOICE_SMOKE_SR folder, skipped");
      return;
    }
    const files = readdirSync(SERBIAN_DIR).filter((name) => name.endsWith(".wav"));
    expect(files.length, `no WAV in ${SERBIAN_DIR}`).toBeGreaterThan(0);

    for (const name of files) {
      const audio = decodeWav(new Uint8Array(readFileSync(join(SERBIAN_DIR, name))));
      const heard = await timed(() => (transcriber as Transcriber).transcribe(audio.pcm, audio.sampleRate, "sr"));
      const factor = realTimeFactor(audio.pcm.length, audio.sampleRate, heard.elapsedMs);
      console.log(
        `[voice smoke] stt whisper-base (sr) ${name}: ${(audio.pcm.length / audio.sampleRate).toFixed(2)} s of audio ` +
          `in ${String(heard.elapsedMs)} ms = ${formatRealTimeFactor(factor)}`,
      );
      console.log(`[voice smoke] heard (sr): ${JSON.stringify(heard.value)}`);
      // A Serbian clip that comes back as an empty string is the failure this
      // test exists to catch: no error, and nothing to show the user.
      expect(heard.value.trim().length).toBeGreaterThan(0);
    }
  }, 300_000);

  it("synthesizes one sentence through a VITS voice in both directions of the service", async () => {
    // The service path itself, on the real pack: `speak` then `transcribe`, the
    // round trip the chat page performs.
    expect(synthesizer).not.toBeNull();
    expect(transcriber).not.toBeNull();
    const audio = await (synthesizer as Synthesizer).speak("Water is the first thing to carry.");
    const heard = await (transcriber as Transcriber).transcribe(audio.pcm, audio.sampleRate, "en");
    console.log(`[voice smoke] round trip heard: ${JSON.stringify(heard)}`);
    expect(wordOverlap(heard, "Water is the first thing to carry.")).toBeGreaterThanOrEqual(0.5);
  }, 300_000);

  it("measures every installed Whisper size on the same audio, so the choice is data", async () => {
    // The pack builder can build three sizes and the service takes whichever the
    // user installed, so which one this laptop should recommend is a measurement
    // rather than a preference. Serbian is the harder half and the language the
    // app defaults to, so the comparison runs there when a recording is
    // available and on the synthesized English sentence when it is not.
    const serbian = SERBIAN_DIR !== undefined && existsSync(SERBIAN_DIR)
      ? readdirSync(SERBIAN_DIR).filter((name) => name.endsWith(".wav"))[0]
      : undefined;
    const audio =
      serbian === undefined
        ? decodeWav(spokenWav as Uint8Array)
        : decodeWav(new Uint8Array(readFileSync(join(SERBIAN_DIR as string, serbian))));
    const language = serbian === undefined ? "en" : "sr";
    const seconds = audio.pcm.length / audio.sampleRate;

    const sizes = readdirSync(PACKS_ROOT)
      // The metadata files `pack-sign.mjs` takes sit in this same folder, so a
      // name filter alone picks up `whisper-base.meta.json`, and the loader then
      // refuses a "pack" that is a file.
      .filter((name) => /^whisper-[a-z]+$/.test(name) && existsSync(join(PACKS_ROOT, name, "config.json")))
      .sort();
    const measured: { size: string; factor: number }[] = [];
    for (const size of sizes) {
      const directory = packDirectory(size);
      if (!existsSync(directory)) continue;
      const loaded = await timed(() => loadTranscriber(directory));
      const heard = await timed(() => loaded.value.transcribe(audio.pcm, audio.sampleRate, language));
      const factor = realTimeFactor(audio.pcm.length, audio.sampleRate, heard.elapsedMs);
      measured.push({ size, factor });
      console.log(
        `[voice smoke] ${size} (${language}): load ${String(loaded.elapsedMs)} ms, ${seconds.toFixed(2)} s of ` +
          `audio in ${String(heard.elapsedMs)} ms = ${formatRealTimeFactor(factor)}`,
      );
      console.log(`[voice smoke] ${size} heard: ${JSON.stringify(heard.value)}`);
      expect(heard.value.trim().length).toBeGreaterThan(0);
    }
    expect(measured.length).toBeGreaterThan(0);

    // A bigger Whisper is a slower Whisper on the same machine; if that were
    // not true here, the recommendation in ADR-105 would be built on nothing.
    const tiny = measured.find((entry) => entry.size === "whisper-tiny");
    const base = measured.find((entry) => entry.size === "whisper-base");
    if (tiny !== undefined && base !== undefined) expect(tiny.factor).toBeGreaterThan(base.factor);
  }, 600_000);
});
