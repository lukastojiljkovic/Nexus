/**
 * `createVoiceService` — the assistant's voice, as the module's `register.ts`
 * wires it (`contract.ts`, § voice).
 *
 * The service is the boundary between two worlds that must not know about each
 * other: the module, which asks for a microphone and a speaker in the user's
 * language, and a worker process, which knows only how to run one model over
 * one buffer. Everything that could be a policy question is answered here:
 * which pack a language gets, when a pack is loaded, what happens when none is
 * installed.
 *
 * THREE RULES, and they are the whole of the behaviour.
 *
 *   1. **No pack, no service.** `speechToText()` and `textToSpeech()` answer
 *      `null` when nothing of that kind is installed rather than throwing,
 *      because "the user has not installed a voice" is the ordinary state of a
 *      fresh profile and not a failure. A page draws a „install a voice pack"
 *      button for `null` and an error for everything else.
 *   2. **A language is never approximated.** A request in Serbian is served by
 *      a pack that declares Serbian or refused with `pack-missing`. The whole
 *      point of the descriptor (`packs.ts`) is that an English-only Whisper
 *      asked for Serbian answers with confident English words, which is the one
 *      failure a user cannot see.
 *   3. **Nothing here reaches the network, ever.** Model files come from an
 *      installed pack, the worker refuses a folder that is not absolute, and
 *      transformers.js is told at every load that remote models are off. The
 *      only way audio or a model enters this app is through a signed pack.
 *
 * The pack list is asked for on EVERY call rather than cached for the life of
 * the service: a user who installs a Serbian voice while the chat page is open
 * gets it on their next sentence, and a pack that was removed stops being used.
 * What IS cached is the loaded model, because loading is the expensive part and
 * the only thing that invalidates it is a different folder.
 */

import type { AssistantLocale, SpeechToText, TextToSpeech, VoiceService } from "@nexus/core";

import type { VoiceHost } from "./host.js";
import { pickSttPack, pickTtsPack, type VoiceKind, type VoicePack } from "./packs.js";
import type { VoiceReply } from "./protocol.js";

/**
 * What the module hands the service.
 *
 * `packs` is a function rather than an array for the reason above, and it is
 * the module's job (not this file's) to read `voice.json` out of each installed
 * folder — `describeVoicePack` is the pure half of that and main does the
 * reading. `host` is the worker, and in a test it is a fake.
 */
export interface VoiceServiceDeps {
  /** The installed voice packs, in the order the caller prefers them. */
  packs(): Promise<readonly VoicePack[]>;
  host: VoiceHost;
}

/** Why a voice request did not happen. Machine codes, as everywhere else in this app. */
export type VoiceProblem =
  /** No installed pack serves the language that was asked for. */
  | "pack-missing"
  | "bad-request"
  | "load-failed"
  | "transcribe-failed"
  | "speak-failed"
  | "aborted"
  | "no-worker"
  /** The worker answered with something this request was not waiting for. */
  | "unexpected";

/** A refusal a caller is expected to show: the code names the rule, the message is for a log. */
export class VoiceUnavailableError extends Error {
  constructor(
    readonly problem: VoiceProblem,
    message: string,
  ) {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}

/** The failure a reply carries, as the error a caller receives. */
function failureOf(reply: VoiceReply): VoiceUnavailableError {
  if (reply.type === "failed") return new VoiceUnavailableError(reply.code, reply.message);
  return new VoiceUnavailableError("unexpected", `the voice worker answered with a "${reply.type}".`);
}

function hasKind(packs: readonly VoicePack[], kind: VoiceKind): boolean {
  return packs.some((pack) => pack.descriptor.kind === kind);
}

/**
 * The service the module composes.
 *
 * Returns immediately; nothing is loaded until something is asked for. A page
 * that opens the voice pane therefore pays for nothing, and a user who never
 * speaks into the assistant never starts a worker at all.
 */
export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  let nextRequestId = 1;
  /** The folder of the model the worker currently holds, so a load is not repeated. */
  let loadedDirectory: string | null = null;

  async function resident(pack: VoicePack): Promise<void> {
    if (loadedDirectory === pack.directory) return;
    const reply = await deps.host.run({
      id: nextRequestId,
      type: "load",
      directory: pack.directory,
      kind: pack.descriptor.kind,
    });
    nextRequestId += 1;
    if (reply.type !== "ready") throw failureOf(reply);
    loadedDirectory = pack.directory;
  }

  return {
    async speechToText(): Promise<SpeechToText | null> {
      const packs = await deps.packs();
      if (!hasKind(packs, "stt")) return null;
      return {
        async transcribe(pcm, sampleRate, language, signal) {
          const current = await deps.packs();
          const pack = pickSttPack(current, language);
          if (pack === null) {
            throw new VoiceUnavailableError(
              "pack-missing",
              `no installed speech model transcribes "${language}".`,
            );
          }
          await resident(pack);
          const reply = await deps.host.run(
            { id: nextRequestId, type: "transcribe", directory: pack.directory, pcm, sampleRate, language },
            signal,
          );
          nextRequestId += 1;
          if (reply.type !== "transcript") throw failureOf(reply);
          return reply.text;
        },
      };
    },

    async textToSpeech(): Promise<TextToSpeech | null> {
      const packs = await deps.packs();
      if (!hasKind(packs, "tts")) return null;
      return {
        async speak(text, language: AssistantLocale, signal) {
          const current = await deps.packs();
          const pack = pickTtsPack(current, language);
          if (pack === null) {
            throw new VoiceUnavailableError("pack-missing", `no installed voice speaks "${language}".`);
          }
          await resident(pack);
          const reply = await deps.host.run(
            { id: nextRequestId, type: "speak", directory: pack.directory, text, language },
            signal,
          );
          nextRequestId += 1;
          if (reply.type !== "audio") throw failureOf(reply);
          return { pcm: reply.pcm, sampleRate: reply.sampleRate };
        },
      };
    },
  };
}
