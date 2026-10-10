/**
 * The voice worker: everything expensive, in a process of its own.
 *
 * This file is the module a `utilityProcess` runs. It owns three facts and
 * nothing else: the model currently loaded, the folder it came from, and the
 * queue of requests waiting for it.
 *
 * WHY ONE MODEL AT A TIME. A transcription and a synthesis may be asked for in
 * either order and there is no reason to keep both resident: the largest voice
 * pack is a quarter of a gigabyte, `utilityProcess` memory is not free, and a
 * user who is dictating is not listening. Swapping is one load, and loads are
 * what the `load` request exists to let the page pay for early.
 *
 * WHY THE QUEUE IS SERIAL. `onnxruntime` sessions are run one at a time by this
 * module because the interesting failure of concurrency here is not a crash: it
 * is that two transcriptions of two different folders interleave, and the
 * second one's model gets swapped out from under the first. Requests are
 * answered in the order they arrive, and a caller that wants them in parallel
 * can open a second worker.
 */

import { loadSynthesizer, loadTranscriber, type Synthesizer, type Transcriber } from "./inference.js";
import type { VoiceKind } from "./packs.js";
import { replyId, requestProblem, type VoiceReply, type VoiceRequest } from "./protocol.js";

/** What is resident: one model, and where it came from. */
interface Loaded {
  readonly directory: string;
  readonly kind: VoiceKind;
  readonly model: Transcriber | Synthesizer;
}

let loaded: Loaded | null = null;

function send(reply: VoiceReply): void {
  process.parentPort.postMessage(reply);
}

/** The model for `directory`, loaded or reloaded as needed. */
async function resident(directory: string, kind: VoiceKind): Promise<Transcriber | Synthesizer> {
  if (loaded !== null && loaded.directory === directory && loaded.kind === kind) return loaded.model;
  const model = kind === "stt" ? await loadTranscriber(directory) : await loadSynthesizer(directory);
  loaded = { directory, kind, model };
  return model;
}

async function handle(request: VoiceRequest): Promise<void> {
  switch (request.type) {
    case "load": {
      await resident(request.directory, request.kind);
      send({ id: request.id, type: "ready" });
      return;
    }
    case "transcribe": {
      const model = await resident(request.directory, "stt");
      if (!("transcribe" in model)) throw new Error("voice: the resident model is not a transcriber.");
      const text = await model.transcribe(request.pcm, request.sampleRate, request.language);
      send({ id: request.id, type: "transcript", text });
      return;
    }
    case "speak": {
      const model = await resident(request.directory, "tts");
      if (!("speak" in model)) throw new Error("voice: the resident model is not a synthesizer.");
      const audio = await model.speak(request.text);
      send({ id: request.id, type: "audio", pcm: audio.pcm, sampleRate: audio.sampleRate });
      return;
    }
    case "dispose": {
      loaded = null;
      send({ id: request.id, type: "disposed" });
      return;
    }
  }
}

/** The failure code a request type maps to when the work itself throws. */
function codeFor(type: VoiceRequest["type"]): "load-failed" | "transcribe-failed" | "speak-failed" {
  if (type === "transcribe") return "transcribe-failed";
  if (type === "speak") return "speak-failed";
  return "load-failed";
}

async function run(request: unknown): Promise<void> {
  const id = replyId(request);
  const problem = requestProblem(request);
  if (problem !== null) {
    // A request with no usable id cannot be answered at all; there is no
    // channel to answer it on, and inventing one would be worse than dropping
    // it, because it would then be indistinguishable from a reply to `id: 0`.
    if (id !== null) send({ id, type: "failed", code: "bad-request", message: problem });
    return;
  }
  const valid = request as VoiceRequest;
  try {
    await handle(valid);
  } catch (error) {
    send({
      id: valid.id,
      type: "failed",
      code: codeFor(valid.type),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

let queue: Promise<void> = Promise.resolve();

/** The worker's own entry point. */
export function startVoiceWorker(): void {
  process.parentPort.on("message", (event) => {
    const request: unknown = (event as { data: unknown }).data;
    queue = queue.then(() => run(request));
  });
}
