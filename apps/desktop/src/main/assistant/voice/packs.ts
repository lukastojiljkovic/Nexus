/**
 * What a voice model pack says about itself, and which one a request gets.
 *
 * A voice model arrives the way every other model does — as a signed `model`
 * pack (`ADR-091`), a folder of files with a manifest the release key signed —
 * and the manifest deliberately carries no field for what the model IS. It
 * carries a title, a description, a licence and a file list, because those are
 * the things the packs card draws and the things a copy verifies; a model's
 * kind, engine, languages and output rate are facts about the model, and a
 * field for them in the manifest would be a second place to state them.
 *
 * So the pack carries `voice.json`, written by OUR builder and listed in the
 * signed manifest like any other content file, which means it is hashed,
 * signed and copied by exactly the code that already does that for everything
 * else. It is the pack's own claim about its model, and it is checked against
 * the model's own `config.json` at BUILD time (`engineMatchesConfig`), so a
 * pack whose two halves disagree never reaches a release.
 *
 * The distinction the service actually needs is two-valued: a pack transcribes
 * audio or it synthesizes it. Everything else here exists so that a request
 * can be REFUSED rather than approximated — a Serbian answer is not read aloud
 * by an English voice, because an English voice reads Serbian orthography
 * through English phonemes and the result is not Serbian.
 */

import type { AssistantLocale } from "@nexus/core";

/** What a voice pack does. */
export type VoiceKind = "stt" | "tts";

/** Which model family the pack holds. Fixed to one kind each, and checked below. */
export type VoiceEngine = "whisper" | "vits";

/** The engine a kind is built out of. Whisper transcribes; VITS synthesizes. */
export const ENGINE_KINDS: Readonly<Record<VoiceEngine, VoiceKind>> = { whisper: "stt", vits: "tts" };

/** Where the pack's own description lives, beside the model files it describes. */
export const VOICE_DESCRIPTOR_FILE = "voice.json";

/** The only format this build reads. A future one is a deliberate edit here. */
export const VOICE_DESCRIPTOR_FORMAT = 1;

/** Sample rates a descriptor may declare. */
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 48_000;

/** One pack's declaration about the model it holds. */
export interface VoiceDescriptor {
  readonly kind: VoiceKind;
  readonly engine: VoiceEngine;
  /** The languages the model handles; a request in another is refused. */
  readonly languages: readonly AssistantLocale[];
  /** The rate the model's own audio is at: 16 000 for all of these. */
  readonly sampleRate: number;
  /** Where the weights came from, so the pack can be rebuilt and the notice written. */
  readonly upstream: { readonly repo: string; readonly revision: string };
}

/** An installed voice pack: what main read off disk, in the shape the service takes. */
export interface VoicePack {
  readonly id: string;
  readonly version: string;
  /** The folder holding the model files, as an absolute path. */
  readonly directory: string;
  readonly descriptor: VoiceDescriptor;
}

const DESCRIPTOR_KEYS = ["format", "kind", "engine", "languages", "sampleRate", "upstream"] as const;
const UPSTREAM_KEYS = ["repo", "revision"] as const;
const LOCALES: readonly AssistantLocale[] = ["sr", "en"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Why `value` is not a voice descriptor, or `null` when it is.
 *
 * A message rather than a boolean, because each rule then has its own test and
 * a builder that gets one wrong is told which. An unknown field is refused as
 * well as a missing one, for `ADR-091`'s reason: a typo and a newer format are
 * both worse read past than refused.
 */
export function voiceDescriptorProblem(value: unknown): string | null {
  if (!isRecord(value)) return "voice.json must be a JSON object.";
  for (const key of DESCRIPTOR_KEYS) {
    if (!Object.hasOwn(value, key)) return `voice.json is missing "${key}".`;
  }
  for (const key of Object.keys(value)) {
    if (!(DESCRIPTOR_KEYS as readonly string[]).includes(key)) {
      return `voice.json has an unknown field "${key}".`;
    }
  }
  if (value["format"] !== VOICE_DESCRIPTOR_FORMAT) {
    return `voice.json: this build reads format ${String(VOICE_DESCRIPTOR_FORMAT)} only.`;
  }

  const kind = value["kind"];
  if (kind !== "stt" && kind !== "tts") return '"kind" must be "stt" or "tts".';
  const engine = value["engine"];
  if (engine !== "whisper" && engine !== "vits") return '"engine" must be "whisper" or "vits".';
  if (ENGINE_KINDS[engine] !== kind) {
    return `"engine" "${engine}" is never a "${kind}" pack.`;
  }

  const languages = value["languages"];
  if (!Array.isArray(languages) || languages.length === 0) {
    return '"languages" must be a non-empty array.';
  }
  const seen = new Set<string>();
  for (const language of languages) {
    if (!LOCALES.includes(language as AssistantLocale)) {
      return `"languages" contains ${JSON.stringify(language)}, which is not a language the assistant speaks.`;
    }
    if (seen.has(language as string)) return `"languages" lists ${JSON.stringify(language)} twice.`;
    seen.add(language as string);
  }

  const sampleRate = value["sampleRate"];
  if (
    typeof sampleRate !== "number" ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE
  ) {
    return `"sampleRate" must be a whole number between ${String(MIN_SAMPLE_RATE)} and ${String(MAX_SAMPLE_RATE)}.`;
  }

  const upstream = value["upstream"];
  if (!isRecord(upstream)) return '"upstream" must be an object.';
  for (const key of UPSTREAM_KEYS) {
    const field = upstream[key];
    if (typeof field !== "string" || field.trim() === "") {
      return `"upstream.${key}" must be a non-empty string.`;
    }
  }
  for (const key of Object.keys(upstream)) {
    if (!(UPSTREAM_KEYS as readonly string[]).includes(key)) {
      return `"upstream" has an unknown field "${key}".`;
    }
  }
  return null;
}

/** The descriptor, or an error naming the rule the document broke. */
export function parseVoiceDescriptor(value: unknown): VoiceDescriptor {
  const problem = voiceDescriptorProblem(value);
  if (problem !== null) throw new Error(problem);
  const record = value as Record<string, unknown>;
  const upstream = record["upstream"] as Record<string, string>;
  return {
    kind: record["kind"] as VoiceKind,
    engine: record["engine"] as VoiceEngine,
    languages: [...(record["languages"] as AssistantLocale[])],
    sampleRate: record["sampleRate"] as number,
    upstream: { repo: upstream["repo"] as string, revision: upstream["revision"] as string },
  };
}

/**
 * Whether the model's own `config.json` says what the descriptor says.
 *
 * Called by the pack builder with the file it just downloaded, which is the one
 * moment both halves are in hand: `model_type` is what transformers.js uses to
 * pick an architecture, so a pack whose descriptor says `vits` over a Whisper
 * config would load a text-to-speech pipeline over a speech recognition model
 * and fail somewhere with no useful name for what went wrong.
 */
export function engineMatchesConfig(engine: VoiceEngine, modelConfig: unknown): boolean {
  if (!isRecord(modelConfig)) return false;
  const modelType = modelConfig["model_type"];
  return typeof modelType === "string" && modelType.toLowerCase() === engine;
}

/**
 * The voice pack described by a folder, or `null` when the folder is not one.
 *
 * The text is passed in rather than read here so that this stays a pure
 * function; main reads `voice.json` out of the installed pack's folder, which
 * is a filesystem question and not this module's.
 */
export function describeVoicePack(input: {
  readonly id: string;
  readonly version: string;
  readonly directory: string;
  readonly descriptorText: string;
}): VoicePack | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.descriptorText);
  } catch {
    return null;
  }
  if (voiceDescriptorProblem(parsed) !== null) return null;
  return {
    id: input.id,
    version: input.version,
    directory: input.directory,
    descriptor: parseVoiceDescriptor(parsed),
  };
}

/** The packs of one kind, in the order the caller gave them. */
function ofKind(packs: readonly VoicePack[], kind: VoiceKind): readonly VoicePack[] {
  return packs.filter((pack) => pack.descriptor.kind === kind);
}

/**
 * The speech-to-text pack a request for `language` uses, or `null`.
 *
 * `"auto"` takes the caller's first choice, because letting the model detect
 * the language is exactly what the first pack is for. A named language takes
 * the first pack that DECLARES it and never a fallback: an English-only Whisper
 * (`whisper-tiny.en`) asked for Serbian produces confident English words for
 * Serbian speech, which is the worst possible failure — it looks like an
 * answer. No pack declaring it means no transcription, and the caller says so.
 */
export function pickSttPack(packs: readonly VoicePack[], language: AssistantLocale | "auto"): VoicePack | null {
  const candidates = ofKind(packs, "stt");
  if (language === "auto") return candidates[0] ?? null;
  return candidates.find((pack) => pack.descriptor.languages.includes(language)) ?? null;
}

/** The text-to-speech pack for `language`, or `null` when no installed voice speaks it. */
export function pickTtsPack(packs: readonly VoicePack[], language: AssistantLocale): VoicePack | null {
  return (
    ofKind(packs, "tts").find((pack) => pack.descriptor.languages.includes(language)) ?? null
  );
}

/** Whether anything installed can speak `language`; the page uses it to hide a control it cannot honour. */
export function speaksLanguage(packs: readonly VoicePack[], language: AssistantLocale): boolean {
  return pickTtsPack(packs, language) !== null;
}

/**
 * Why a folder may not be handed to the model loader, or `null` when it may.
 *
 * transformers.js decides what a model argument means by its shape: a string in
 * the `owner/name` form is a repository id it would fetch, and anything else is
 * a path on disk. That decision is not a promise the app can rely on, so the
 * rule is stated here instead: **a voice model is only ever loaded from an
 * absolute folder**, which is what an installed pack is, and a repository id or
 * a URL is refused before the library sees it. A relative path is refused too,
 * because the working directory of a utility process is not something this app
 * chooses and a path resolved against it would be a path nobody wrote.
 */
export function voicePackDirectoryProblem(directory: string): string | null {
  if (directory.trim() === "") return "the folder is empty.";
  if (/^(https?|ftp|wss?|file|data):/i.test(directory)) {
    return "the folder is a URL; a voice model is loaded from an installed pack folder.";
  }
  if (/^[A-Za-z]:[\\/]/.test(directory)) return null;
  if (directory.startsWith("/") || directory.startsWith("\\\\")) return null;
  return "the folder is not an absolute path, and could be read as a model id to fetch.";
}
