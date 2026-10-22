/**
 * THE MODEL HOST MAIN ACTUALLY TALKS TO.
 *
 * This file is the whole of `ModelHost` except the two things it must not own:
 * where a worker comes from (`electron.ts` forks one) and what llama.cpp does
 * (`llama.ts`, in the worker). It is written against a `WorkerPort`, so every
 * path through it — a load, a streamed answer, an abort, a refusal — is testable
 * with a fake worker and no native addon, which is the only way this half of the
 * runtime can be tested at all.
 *
 * WHAT IT ADDS ON TOP OF THE WIRE, and each of these is a rule rather than
 * plumbing:
 *
 *   - **The mode gates the search.** `searchHuggingFace` refuses outside
 *     `downloads`, before a URL is built.
 *   - **Images never cross.** A `complete` whose messages carry an image is
 *     refused here, in main, so no user picture is copied into a second process
 *     for a runtime that cannot look at it (ADR-096).
 *   - **A dead worker is one refusal, not a hang.** Every pending request is
 *     rejected when the port reports an exit, so a crashed worker surfaces as an
 *     error a caller can show instead of a promise nobody settles.
 *   - **Removing the loaded model unloads it first.** Deleting a file under a
 *     model llama.cpp has mapped is not a state this app wants to reason about.
 *   - **One chat model and one embedder.** The worker enforces it where it can
 *     (it owns the memory), and the host remembers which ids those are so that a
 *     `remove` and a `loadChat` cannot disagree about it.
 *   - **A model that is already loaded is not loaded again.** `loadChat` runs on
 *     every turn (`register.ts`), and reading sixteen gigabytes from disk and
 *     building a fresh context for a model that is sitting in memory is the cost
 *     this host removes: a load whose request is the one that put the resident
 *     model there is answered from memory, without a message to the worker.
 *   - **Memory is given back when nobody is asking.** Once no request has been
 *     pending for `keepLoadedFor` minutes, the models are unloaded. The host is
 *     the one place that knows a request is pending - a reindex's embed as much
 *     as a turn's answer - so the timer lives here and not in the module.
 */

import type {
  ChatLoadOverrides,
  ChatModel,
  DownloadProgress,
  Embedder,
  HardwareProfile,
  LoadedModelInfo,
  ModelEntry,
  ModelHost,
  ModelRecommendation,
  ResidentModels,
} from "@nexus/core";
import { existsSync } from "node:fs";

import type { NetworkMode } from "../../net/offline.js";
import { bundledCatalogue } from "./catalogue.js";
import { RuntimeError } from "./errors.js";
import { createHardwareCache } from "./hardware.js";
import { searchHuggingFace } from "./huggingface.js";
import {
  importModel,
  installEntry,
  modelFilePath,
  readInstalled,
  removeModel,
  type InstalledModel,
  type ModelsDeps,
} from "./install.js";
import { recommend } from "./recommend.js";
import {
  PROTOCOL_VERSION,
  ProtocolError,
  parseHostEvent,
  type HostEvent,
  type HostFailureCode,
  type HostRequest,
} from "./protocol.js";

/** A worker, as the host sees it. `electron.ts` supplies the real one. */
export interface WorkerPort {
  post(message: HostRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
}

export interface ModelHostDeps {
  readonly userData: string;
  /** The mode this launch may ACT on — `activeNetworkMode` in main, never the stored file. */
  readonly mode: () => NetworkMode;
  /** `isSessionRequestAllowed(<mode>, url)` in main. */
  readonly isAllowedUrl: (url: string) => boolean;
  /** Forks the utility process. Called once, lazily, on the first request. */
  readonly spawnWorker: () => WorkerPort;
  readonly downloadFor: ModelsDeps["downloadFor"];
  /** A JSON GET through the dedicated session, for the Hugging Face search. */
  readonly fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>;
  readonly freeBytes: ModelsDeps["freeBytes"];
  /**
   * The manual GPU-layer override from the assistant's own settings, `"auto"` by
   * default. Read at load time, never cached, so a setting the user changes
   * applies to the next model without a restart.
   */
  readonly gpuLayers?: () => number | "auto";
  readonly now?: () => number;
}

/**
 * The host. Nothing here throws at construction: a machine with no models, no
 * worker and no catalogue is a valid state, and every one of those is discovered
 * by the call that needs it.
 */
export function createModelHost(deps: ModelHostDeps): ModelHost {
  const models: ModelsDeps = {
    userData: deps.userData,
    mode: deps.mode,
    downloadFor: deps.downloadFor,
    freeBytes: deps.freeBytes,
    now: deps.now ?? (() => Date.now()),
  };

  let port: WorkerPort | null = null;
  let nextSeq = 1;
  let nextCall = 1;
  const waiting = new Map<
    number,
    { readonly resolve: (event: HostEvent) => void; readonly reject: (error: RuntimeError) => void }
  >();
  const streaming = new Map<number, (text: string) => void>();
  /**
   * The chat model the worker holds, and the load request that put it there.
   *
   * The request is kept rather than just the id because "the same model" is not
   * enough to answer a load from memory: the entry's context cap, its thought
   * budget, its sampling and the GPU-layer setting all decide what the loaded
   * model IS, and a changed one of those is a different model to run. See
   * `loadChatModel` for why the key is the request rather than a list of fields.
   */
  let loadedChat: { readonly key: string; readonly info: LoadedModelInfo } | null = null;
  let loadedEmbedder: string | null = null;
  /** Milliseconds with nothing pending before the models are unloaded; `0` is never. */
  let idleMs = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function disarmIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  }

  /**
   * Armed whenever the last pending request settles, and checked again when it
   * fires: a load's answer arrives before the load records what it put in
   * memory, so whether anything is resident is the firing's question.
   */
  function armIdle(): void {
    disarmIdle();
    if (idleMs === 0 || waiting.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (waiting.size > 0 || (loadedChat === null && loadedEmbedder === null)) return;
      // A worker that is gone has nothing to unload; the next request forks a new one.
      unloadAll().catch(() => undefined);
    }, idleMs);
    idleTimer.unref?.();
  }

  function ensurePort(): WorkerPort {
    if (port !== null) return port;
    const spawned = deps.spawnWorker();
    spawned.onMessage((message) => {
      receive(message);
    });
    spawned.onExit(() => {
      port = null;
      const error = new RuntimeError("worker", "The model host process stopped.");
      for (const entry of waiting.values()) entry.reject(error);
      waiting.clear();
      streaming.clear();
      loadedChat = null;
      loadedEmbedder = null;
    });
    port = spawned;
    return spawned;
  }

  function receive(message: unknown): void {
    let event: HostEvent;
    try {
      event = parseHostEvent(message);
    } catch (error) {
      if (error instanceof ProtocolError) {
        // A worker main cannot understand is not a worker whose next answer will
        // be better: every pending request is refused rather than left hanging.
        const failure = new RuntimeError("worker", `The model host said something unreadable: ${error.message}`);
        for (const entry of waiting.values()) entry.reject(failure);
        waiting.clear();
        streaming.clear();
        return;
      }
      throw error;
    }
    if (event.kind === "token") {
      streaming.get(event.callId)?.(event.text);
      return;
    }
    if (event.kind === "failed") {
      const failure = new RuntimeError(codeOf(event.code), event.message);
      if (event.callId !== undefined) streaming.delete(event.callId);
      // A failure with a `seq` answers the request that carried it. A failure
      // with only a `callId` is an `abort` that arrived after its call finished —
      // the request it belonged to has already been answered, so there is nothing
      // left to refuse and nothing else is affected.
      const seq = event.seq;
      if (seq === undefined) return;
      const caller = waiting.get(seq);
      if (caller === undefined) return;
      waiting.delete(seq);
      caller.reject(failure);
      return;
    }
    const caller = waiting.get(event.seq);
    if (caller === undefined) return;
    waiting.delete(event.seq);
    caller.resolve(event);
  }

  function send(request: (seq: number) => HostRequest): Promise<HostEvent> {
    const seq = nextSeq;
    nextSeq += 1;
    disarmIdle();
    const promise = new Promise<HostEvent>((resolve, reject) => {
      waiting.set(seq, { resolve, reject });
    });
    try {
      ensurePort().post(request(seq));
    } catch (error) {
      waiting.delete(seq);
      armIdle();
      throw error;
    }
    return promise.finally(armIdle);
  }

  async function hardware(): Promise<HardwareProfile> {
    const event = await send((seq) => ({ v: PROTOCOL_VERSION, kind: "hardware", seq }));
    if (event.kind !== "hardware") throw new RuntimeError("worker", "The model host did not answer with hardware.");
    return event.hardware;
  }

  /** One reading per session: the probe loads the native addon, and nothing here changes. */
  const hardwareOnce = createHardwareCache(hardware);

  async function loadChatModel(
    id: string,
    signal: AbortSignal,
    overrides: ChatLoadOverrides = {},
  ): Promise<ChatModel> {
    const entry = requireInstalled(id);
    const profile = await hardwareOnce();
    // The profile's own choices over the entry's: a context in place of its cap,
    // and each sampling value it names in place of the entry's.
    const { contextTokens: contextCap = entry.contextCap, ...chosen } = overrides;
    const sampling = { ...entry.sampling, ...chosen };
    // The body of the load, built once: it is what is sent, and it is what the
    // resident model is remembered BY. A key that is the request itself cannot
    // drift from the request the way a hand-kept list of fields can: a field
    // added to a load is a field added to its identity, with nothing new to
    // remember and no way to answer from memory with the wrong model.
    const load = {
      id: entry.id,
      modelPath: pathOf(entry),
      contextTokens: entry.contextTokens > 0 ? entry.contextTokens : 0,
      ...(contextCap === undefined ? {} : { contextCap }),
      ...(entry.thoughtTokens === undefined ? {} : { thoughtTokens: entry.thoughtTokens }),
      ...(Object.keys(sampling).length === 0 ? {} : { sampling }),
      gpuLayers: deps.gpuLayers?.() ?? "auto",
      threads: profile.cpuThreads,
      title: entry.title,
      capabilities: entry.capabilities,
    };
    const key = JSON.stringify(load);
    // Read from disk only when this exact request is not what the worker holds;
    // a handle that outlives an unload (idle, or the page's own) calls it again.
    const resident = async (): Promise<LoadedModelInfo> => {
      if (loadedChat !== null && loadedChat.key === key) return loadedChat.info;
      // Whatever was resident is being replaced, or is about to be disposed by a
      // load that then fails. Either way this host must not answer a later load
      // from a request that no longer describes what the worker holds.
      loadedChat = null;
      const event = await send((seq) => ({ v: PROTOCOL_VERSION, kind: "load-chat", seq, ...load }));
      if (event.kind !== "loaded") throw new RuntimeError("worker", "The model host did not answer with a model.");
      loadedChat = { key, info: event.info };
      return event.info;
    };
    if (loadedChat !== null && loadedChat.key === key) {
      if (signal.aborted) {
        // Nothing was read from disk for this call, so there is nothing to give
        // back: the decision is honoured by refusing the load, and the loop that
        // asked for it sees the same signal before its first model call.
        throw new RuntimeError("aborted", "The turn was aborted before the model was used.");
      }
      return chatModelOf(loadedChat.info, key, resident);
    }
    const info = await resident();
    if (signal.aborted) {
      // The load itself is not interruptible — llama.cpp reads and maps gigabytes
      // and offers no cancel for that — so the user's decision is honoured at the
      // first moment it can be: the model is unloaded again and the caller is
      // told the turn was aborted.
      await unloadAll();
      throw new RuntimeError("aborted", "The model load was aborted once it finished.");
    }
    return chatModelOf(info, key, resident);
  }

  function chatModelOf(
    info: LoadedModelInfo,
    key: string,
    resident: () => Promise<LoadedModelInfo>,
  ): ChatModel {
    return {
      info,
      complete: async (request, completeSignal, onToken) => {
        if (request.messages.some((message) => (message.images?.length ?? 0) > 0)) {
          throw new RuntimeError(
            "unsupported-images",
            "This runtime loads no vision model, so an image cannot be part of the conversation.",
          );
        }
        const unstarted = {
          text: "",
          toolCalls: [],
          stopReason: "aborted",
          promptTokens: 0,
          completionTokens: 0,
        } as const;
        if (completeSignal.aborted) return unstarted;
        if (loadedChat?.key !== key) {
          await resident();
          if (completeSignal.aborted) return unstarted;
        }
        const callId = nextCall;
        nextCall += 1;
        streaming.set(callId, onToken);
        let finished = false;
        const stop = (): void => {
          if (finished) return;
          try {
            ensurePort().post({ v: PROTOCOL_VERSION, kind: "abort", callId });
          } catch {
            // The worker is gone; the awaited request has already been rejected
            // by the exit listener, so there is nothing left to abort.
          }
        };
        completeSignal.addEventListener("abort", stop, { once: true });
        try {
          const event = await send((seq) => ({
            v: PROTOCOL_VERSION,
            kind: "complete",
            seq,
            callId,
            messages: request.messages,
            tools: request.tools,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          }));
          if (event.kind !== "result") throw new RuntimeError("worker", "The model host did not answer with a result.");
          return event.result;
        } finally {
          finished = true;
          completeSignal.removeEventListener("abort", stop);
          streaming.delete(callId);
        }
      },
    };
  }

  async function loadEmbeddingModel(id: string, signal: AbortSignal): Promise<Embedder> {
    const entry = requireInstalled(id);
    const profile = await hardwareOnce();
    // The same rule as a chat handle's: the profile keeps this embedder for its
    // session, so a use after an unload reads the model again rather than failing.
    const resident = async (): Promise<number> => {
      const event = await send((seq) => ({
        v: PROTOCOL_VERSION,
        kind: "load-embedder",
        seq,
        id: entry.id,
        modelPath: pathOf(entry),
        contextTokens: entry.contextTokens > 0 ? entry.contextTokens : 0,
        threads: profile.cpuThreads,
      }));
      if (event.kind !== "embedder-ready") {
        throw new RuntimeError("worker", "The model host did not answer with an embedder.");
      }
      loadedEmbedder = entry.id;
      return event.dimensions;
    };
    const dimensions = await resident();
    if (signal.aborted) {
      // The same rule as a chat load: llama.cpp offers no cancel for reading a
      // model, so the user's decision is honoured the moment it can be.
      await unloadAll();
      throw new RuntimeError("aborted", "The embedder load was aborted once it finished.");
    }
    return {
      modelId: entry.id,
      // The model's own vector width, reported by the worker after the load; a
      // stored dimension would be a second opinion about the file's geometry.
      dimensions,
      embed: async (texts, signal) => {
        if (signal.aborted) throw new RuntimeError("aborted", "The embedding was aborted.");
        if (loadedEmbedder !== entry.id) await resident();
        const callId = nextCall;
        nextCall += 1;
        const answered = await send((seq) => ({
          v: PROTOCOL_VERSION,
          kind: "embed",
          seq,
          callId,
          texts,
        }));
        if (answered.kind !== "embedded") throw new RuntimeError("worker", "The model host did not answer with vectors.");
        return answered.vectors.map((vector) => Float32Array.from(vector));
      },
    };
  }

  function requireInstalled(id: string): InstalledModel {
    const entry = readInstalled(deps.userData).find((candidate) => candidate.id === id);
    if (entry === undefined) throw new RuntimeError("not-installed", `No model with the id "${id}" is installed.`);
    // An imported model lives where the user put it; a downloaded one lives in
    // `models/`. Either way a file that is GONE is reported here, before a
    // worker is asked to load something that cannot be loaded.
    const path = pathOf(entry);
    if (!existsSync(path)) throw new RuntimeError("not-installed", `The file of "${id}" is gone (${path}).`);
    return entry;
  }

  function pathOf(entry: InstalledModel): string {
    return entry.path ?? modelFilePath(deps.userData, entry.id, entry.file);
  }

  async function unloadAll(): Promise<void> {
    loadedChat = null;
    loadedEmbedder = null;
    streaming.clear();
    await send((seq) => ({ v: PROTOCOL_VERSION, kind: "unload", seq }));
  }

  return {
    hardware: hardwareOnce,

    async catalogue(): Promise<readonly ModelEntry[]> {
      return bundledCatalogue();
    },

    recommend(
      profile: HardwareProfile,
      catalogue: readonly ModelEntry[],
    ): readonly ModelRecommendation[] {
      return recommend(profile, catalogue);
    },

    async searchHuggingFace(query: string, signal: AbortSignal): Promise<readonly ModelEntry[]> {
      return await searchHuggingFace(
        { mode: deps.mode, isAllowedUrl: deps.isAllowedUrl, httpJson: deps.fetchJson },
        query,
        signal,
      );
    },

    async installed(): Promise<readonly ModelEntry[]> {
      return readInstalled(deps.userData);
    },

    async download(
      entry: ModelEntry,
      onProgress: (progress: DownloadProgress) => void,
      signal: AbortSignal,
    ): Promise<void> {
      await installEntry(models, entry, onProgress, signal);
    },

    async importFile(path: string): Promise<ModelEntry> {
      return await importModel(models, path);
    },

    async remove(id: string): Promise<void> {
      if (loadedChat?.info.id === id || loadedEmbedder === id) await unloadAll();
      removeModel(models, id);
    },

    loadChat: loadChatModel,

    loadEmbedder: loadEmbeddingModel,

    resident(): ResidentModels {
      return { chat: loadedChat?.info.id ?? null, embedder: loadedEmbedder };
    },

    keepLoadedFor(minutes: number): void {
      idleMs = Math.max(0, minutes) * 60_000;
      armIdle();
    },

    unloadAll,
  };
}

/** The engine's failure codes as the runtime's. */
function codeOf(code: HostFailureCode): RuntimeError["code"] {
  switch (code) {
    case "unsupported-images":
      return "unsupported-images";
    case "unknown-call":
    case "refused":
      return "busy";
    case "internal":
      return "worker";
    default:
      return code;
  }
}

