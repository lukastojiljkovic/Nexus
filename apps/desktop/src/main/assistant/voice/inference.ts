/**
 * The two models, run.
 *
 * This is the only file in the app that touches the ONNX runtime, and it is
 * loaded in the voice worker's process rather than in main (see
 * `docs/architecture/adr/105-voice.md`). It holds no policy: which pack to use,
 * when to load it and what to do about a refusal are the service's decisions,
 * and a folder arrives here only after main resolved it from an installed,
 * signature-verified pack.
 *
 * OFFLINE, AND NOT BY CONVENTION. `allowRemoteModels` is set to `false` on
 * every load, so the library's own resolver refuses to fetch a missing file and
 * says so by name. Setting it once at import time would have been enough until
 * the day somebody put a `pipeline()` call before this module's import in a
 * file this one is bundled into, which is why it is a function called by each
 * loader rather than a module-level side effect.
 *
 * WHY `dtype: "q8"`. The pack builder ships the `_quantized` ONNX files
 * (~77 MB for Whisper base against ~286 MB for the fp32 pair), and a
 * weight-only 8-bit model is the size at which a voice pack is something a user
 * downloads over a phone in a few minutes. `q8` is the dtype whose file suffix
 * is exactly `_quantized` (`utils/dtypes.js`), so the dtype a loader asks for
 * and the files the manifest lists are two statements of one fact.
 */

import { env, LogLevel, pipeline } from "@huggingface/transformers";
import type { AutomaticSpeechRecognitionPipeline, TextToAudioPipeline } from "@huggingface/transformers";

import { voicePackDirectoryProblem } from "./packs.js";
import type { TranscriptionLanguage } from "./protocol.js";
import { resamplePcm, VOICE_SAMPLE_RATE } from "./resample.js";

/** Whisper reads 30-second windows; the overlap is a sixth of it, as upstream's own examples use. */
const WINDOW_SECONDS = 30;
const WINDOW_STRIDE_SECONDS = 5;

/** Audio the runtime will accept, whatever the runtime's own limits are. */
export interface Transcriber {
  transcribe(pcm: Float32Array, sampleRate: number, language: TranscriptionLanguage): Promise<string>;
}

export interface Synthesizer {
  speak(text: string): Promise<{ readonly pcm: Float32Array; readonly sampleRate: number }>;
}

/** The environment every load runs under: local files only, and no cache directory of our own. */
function useLocalModelsOnly(): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Neither cache is used or wanted: the model files are already in the pack,
  // and a cache directory would be a second copy of a signed file on disk.
  env.useFSCache = false;
  env.useBrowserCache = false;
  // The library's own progress logging goes to the worker's stdout, which this
  // app does not read. A load that fails reaches main as a `failed` reply with
  // a message, which is where it can be shown to somebody.
  env.logLevel = LogLevel.ERROR;
}

/** The folder, guarded, as an absolute path. */
function checkedDirectory(directory: string): string {
  const problem = voicePackDirectoryProblem(directory);
  if (problem !== null) throw new Error(`voice: ${problem}`);
  return directory;
}

/**
 * Whisper, from an installed pack folder.
 *
 * The audio is resampled to 16 kHz here rather than by the caller, because that
 * is the rate this model is defined at (`preprocessor_config.json`) and a
 * caller that got it wrong would otherwise get a confident transcript of a
 * slowed-down voice.
 */
export async function loadTranscriber(directory: string): Promise<Transcriber> {
  useLocalModelsOnly();
  const folder = checkedDirectory(directory);
  const recognizer: AutomaticSpeechRecognitionPipeline = await pipeline("automatic-speech-recognition", folder, {
    dtype: "q8",
  });
  return {
    async transcribe(pcm, sampleRate, language) {
      const audio = resamplePcm(pcm, sampleRate, VOICE_SAMPLE_RATE);
      const output = await recognizer(audio, {
        task: "transcribe",
        chunk_length_s: WINDOW_SECONDS,
        stride_length_s: WINDOW_STRIDE_SECONDS,
        // The library maps `sr` to Whisper's "serbian" token itself
        // (`models/whisper/common_whisper.js`); `auto` omits the option, which
        // is what makes the model detect the language.
        ...(language === "auto" ? {} : { language }),
      });
      return Array.isArray(output) ? (output[0]?.text ?? "") : output.text;
    },
  };
}

/**
 * A VITS voice, from an installed pack folder.
 *
 * The returned rate comes from the model rather than from the pack descriptor,
 * so a pack that declared the wrong rate can still not make the app play its
 * audio at the wrong speed.
 */
export async function loadSynthesizer(directory: string): Promise<Synthesizer> {
  useLocalModelsOnly();
  const folder = checkedDirectory(directory);
  const talker: TextToAudioPipeline = await pipeline("text-to-audio", folder, { dtype: "q8" });
  return {
    async speak(text) {
      const audio = await talker(text);
      // `RawAudio.audio` is an array when several chunks were generated; one
      // sentence is one chunk, and `.data` is the getter that concatenates.
      const single = Array.isArray(audio) ? audio[0] : audio;
      if (single === undefined) return { pcm: new Float32Array(0), sampleRate: VOICE_SAMPLE_RATE };
      return { pcm: single.data, sampleRate: single.sampling_rate };
    },
  };
}
