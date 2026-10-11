/**
 * llama.cpp, DRIVEN FROM ONE PLACE, IN THE PROCESS THAT IS ALLOWED TO BLOCK.
 *
 * This module is the only file in the runtime that imports `node-llama-cpp`, and
 * the only place a model is loaded, a token is generated or a vector is
 * computed. It lives in the utility process (`worker.ts` is its caller), so
 * nothing here can block the window: the main process never loads the native
 * addon at all (ADR-096), which is also why a hardware reading is a worker
 * request rather than a main-process call.
 *
 * FIVE DECISIONS THAT ARE MADE HERE AND NOWHERE ELSE:
 *
 *   1. **`build: "never"`, `skipDownload: true`.** Without them node-llama-cpp
 *      will download a llama.cpp release from GitHub, or compile one, when the
 *      prebuilt binary for this machine does not load — which is a network
 *      request and a C++ toolchain in a product that promises neither. The
 *      backend is loaded from the app's own files or the load fails and says so.
 *   2. **The backend is the one that LOADS.** `getLlamaGpuTypes("supported")`
 *      answers what this machine can actually run — measured on the maintainer's
 *      laptop as Vulkan, with the CUDA binaries installed and failing their own
 *      load test — and that answer, not the presence of a driver, decides. A
 *      machine whose CUDA binaries do not load falls back rather than refusing.
 *   3. **One chat model and one embedder, at most.** A second chat model cannot
 *      be useful at once and would double the memory the chooser just spent its
 *      arithmetic on. The embedder is allowed to sit BESIDE a chat model because
 *      the knowledge search needs it while an answer is being written, and it is
 *      640 MB against the smallest chat entry's 1.2 GB. `unloadAll` drops
 *      everything, including the llama instance itself.
 *   4. **Function calling when the template can, the contract's text fallback
 *      when it cannot.** `LlamaChat` (not `LlamaChatSession`) is used precisely
 *      because it does NOT execute a tool: it answers with the calls the model
 *      asked for and lets the agent loop decide. Whether the resolved wrapper
 *      can call functions at all is the library's own test
 *      (`chatWrapper.settings.functions != null`), not a guess at the template.
 *   5. **Embeddings are L2-normalised here.** The contract promises it
 *      ("vectors are L2-normalised"), and llama.cpp's own normalisation is a
 *      build/server setting this runtime does not control.
 *
 * A CALL ID IS MINTED BY MAIN. The protocol's `callId` comes from the host, so
 * the two adapters at the bottom of this file (`chat` and `embedder`, which the
 * in-process smoke test drives) use NEGATIVE ids: main's are always positive, so
 * an adapter can never collide with a turn the app is running.
 */

import type {
  ChatModel,
  CompletionRequest,
  CompletionResult,
  Embedder,
  LoadedModelInfo,
  ModelCapability,
} from "@nexus/core";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ChatWrapper,
  Llama,
  LlamaChat,
  LlamaContext,
  LlamaContextSequence,
  LlamaEmbeddingContext,
  LlamaModel,
} from "node-llama-cpp";

import type { HardwareReading } from "./hardware.js";
import {
  chatHistoryFrom,
  createFenceFilter,
  fallbackToolsBlock,
  functionsFrom,
  stopReasonFrom,
  toolCallsFrom,
} from "./messages.js";
import type { HostFailureCode } from "./protocol.js";

/**
 * The library, loaded through a REAL dynamic `import()`.
 *
 * `node-llama-cpp` is ESM-only, and this file is bundled into the main process's
 * CommonJS output — where a static import becomes `require("node-llama-cpp")`.
 * That happens to work on a Node with `require(esm)` and fails on one without,
 * and which Node an Electron release carries is not a fact this file can assume.
 * Holding the specifier in a variable keeps the bundler from rewriting the
 * expression, so what ships is a native dynamic import, which every Node this
 * app supports has.
 */
let library: Promise<typeof import("node-llama-cpp")> | null = null;

function llamaCpp(): Promise<typeof import("node-llama-cpp")> {
  library ??= import(librarySpecifier()) as Promise<typeof import("node-llama-cpp")>;
  return library;
}

/**
 * Where the library is, as something `import()` can take.
 *
 * In development and under Vitest that is the bare specifier — `out/main` and the
 * test's own module both sit inside `apps/desktop`, so Node resolves
 * `node_modules/node-llama-cpp` the ordinary way. In a packaged app the worker is
 * forked from INSIDE `app.asar` and the package is unpacked BESIDE it
 * (`asarUnpack` in `electron-builder.yml`), so what this asks for is the unpacked
 * path: a real directory, which is what Node's ESM loader needs — it does not read
 * asar archives, and a native addon inside one cannot be loaded at all.
 *
 * The specifier is held in a variable rather than written inline, because a
 * BUNDLER can rewrite a literal `import("node-llama-cpp")` into `require(...)` in
 * a CommonJS output, and `require` of this package fails: measured 2026-10-10,
 * `ERR_REQUIRE_ASYNC_MODULE` — its ESM graph has a top-level await, so not even a
 * Node with `require(esm)` can load it that way.
 */
function librarySpecifier(): string {
  const here = typeof __filename === "string" ? __filename : "";
  const marker = `${sep}app.asar${sep}`;
  const at = here.indexOf(marker);
  if (at === -1) return "node-llama-cpp";
  return pathToFileURL(
    join(here.slice(0, at), "app.asar.unpacked", "node_modules", "node-llama-cpp", "dist", "index.js"),
  ).href;
}

/** Why the engine refused something, as a code the worker turns into a `failed` event. */
export class EngineError extends Error {
  readonly code: HostFailureCode;

  constructor(code: HostFailureCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export interface LoadChatOptions {
  readonly id: string;
  readonly title: string;
  readonly capabilities: readonly ModelCapability[];
  readonly modelPath: string;
  readonly contextTokens: number;
  readonly gpuLayers: number | "auto";
  readonly threads: number;
}

export interface LoadEmbedderOptions {
  readonly id: string;
  readonly modelPath: string;
  readonly contextTokens: number;
  readonly threads: number;
}

export interface EmbedderInfo {
  readonly modelId: string;
  readonly dimensions: number;
}

/** What the engine reports as it works. */
export interface EngineSink {
  /** One visible chunk of an answer, while it is being written. */
  readonly onToken: (callId: number, text: string) => void;
  /** A line for the app's own log. Never shown to a user; never carries model output. */
  readonly log?: (message: string) => void;
}

export interface LlamaEngine {
  /** The machine as llama.cpp sees it. Loads the backend, and keeps it for the next call. */
  hardware(): Promise<HardwareReading>;
  loadChat(options: LoadChatOptions): Promise<LoadedModelInfo>;
  loadEmbedder(options: LoadEmbedderOptions): Promise<EmbedderInfo>;
  /** Writes one answer. `callId` names the call so `abort` can stop it. */
  complete(callId: number, request: CompletionRequest): Promise<CompletionResult>;
  /** Stops the call with that id. Any other id is an `unknown-call`. */
  abort(callId: number): void;
  embed(
    callId: number,
    texts: readonly string[],
  ): Promise<{ readonly dimensions: number; readonly vectors: Float32Array[] }>;
  /** Frees every model, the contexts and the llama instance itself. */
  unloadAll(): Promise<void>;
  /** The loaded chat model, as the agent loop wants it. */
  chat(id: string): ChatModel;
  /** The loaded embedder, as the knowledge base wants it. */
  embedder(id: string): Embedder;
}

interface LoadedChat {
  readonly id: string;
  readonly info: LoadedModelInfo;
  readonly model: LlamaModel;
  readonly context: LlamaContext;
  /**
   * The context's ONE sequence, taken here and kept.
   *
   * `LlamaContext.getSequence()` hands out the next free sequence and a context
   * created without a `sequences` option has exactly one, so a second call throws
   * `No sequences left`. The session keeps the first one — which is also where the
   * token meter lives, and therefore where this runtime's prompt and completion
   * counts come from.
   */
  readonly sequence: LlamaContextSequence;
  readonly chat: LlamaChat;
  readonly wrapper: ChatWrapper;
}

interface LoadedEmbedder {
  readonly id: string;
  readonly model: LlamaModel;
  readonly context: LlamaEmbeddingContext;
  readonly dimensions: number;
}

/** The context the runtime loads a chat model with. `recommend.ts` sizes its estimates at the same one. */
export const LOAD_CONTEXT_TOKENS = 8192;

/**
 * One engine over one llama instance.
 *
 * `complete` and `embed` are the only async work; everything else is bookkeeping.
 * The two are strictly serialised — a generation holds the context sequence, and
 * a second one would corrupt the state rather than merely queue — so a caller
 * that starts two gets an `EngineError` with `refused`, which is the honest
 * answer to a caller's bug rather than a silent interleaving.
 */
export function createLlamaEngine(sink: EngineSink): LlamaEngine {
  let llamaPromise: Promise<Llama> | null = null;
  let loadedChat: LoadedChat | null = null;
  let loadedEmbedder: LoadedEmbedder | null = null;
  let runningCall: number | null = null;
  let controller: AbortController | null = null;
  let adapterCalls = 0;

  async function llama(): Promise<Llama> {
    llamaPromise ??= createLlama(sink);
    return await llamaPromise;
  }

  function adaptersNextCallId(): number {
    adapterCalls -= 1;
    return adapterCalls;
  }

  async function disposeChat(): Promise<void> {
    const loaded = loadedChat;
    loadedChat = null;
    if (loaded === null) return;
    try {
      loaded.chat.dispose();
      await loaded.context.dispose();
      await loaded.model.dispose();
    } catch (error) {
      sink.log?.(`assistant runtime: unloading a chat model failed: ${String(error)}`);
    }
  }

  async function disposeEmbedder(): Promise<void> {
    const loaded = loadedEmbedder;
    loadedEmbedder = null;
    if (loaded === null) return;
    try {
      await loaded.context.dispose();
      await loaded.model.dispose();
    } catch (error) {
      sink.log?.(`assistant runtime: unloading the embedder failed: ${String(error)}`);
    }
  }

  async function loadChat(options: LoadChatOptions): Promise<LoadedModelInfo> {
    if (runningCall !== null) {
      throw new EngineError("refused", "A generation is running; the model cannot be swapped under it.");
    }
    await disposeChat();
    const instance = await llama();
    const model = await instance.loadModel({ modelPath: options.modelPath, gpuLayers: options.gpuLayers });
    try {
      const contextSize = loadedContextTokens(options.contextTokens);
      const context = await model.createContext({ contextSize, threads: options.threads });
      const sequence = context.getSequence();
      const { LlamaChat } = await llamaCpp();
      const chat = new LlamaChat({ contextSequence: sequence });
      const wrapper = chat.chatWrapper;
      loadedChat = {
        id: options.id,
        info: {
          id: options.id,
          title: options.title,
          capabilities: options.capabilities,
          contextTokens: contextSize,
        },
        model,
        context,
        sequence,
        chat,
        wrapper,
      };
      sink.log?.(
        `assistant runtime: "${options.id}" loaded with the ${wrapper.wrapperName} chat wrapper ` +
          `(${wrapperSupportsFunctions(wrapper) ? "function calling" : "text fallback"}), context ` +
          `${String(contextSize)} tokens, ${String(model.gpuLayers)} layers on the GPU`,
      );
      return loadedChat.info;
    } catch (error) {
      await model.dispose();
      throw new EngineError("load", `The model could not be prepared: ${String(error)}`);
    }
  }

  async function loadEmbedder(options: LoadEmbedderOptions): Promise<EmbedderInfo> {
    if (runningCall !== null) {
      throw new EngineError("refused", "A generation is running; the embedder cannot be swapped under it.");
    }
    await disposeEmbedder();
    const instance = await llama();
    const model = await instance.loadModel({ modelPath: options.modelPath, gpuLayers: "auto" });
    try {
      const context = await model.createEmbeddingContext({
        contextSize: loadedContextTokens(options.contextTokens),
        threads: options.threads,
      });
      const dimensions = model.embeddingVectorSize;
      loadedEmbedder = { id: options.id, model, context, dimensions };
      sink.log?.(`assistant runtime: embedder "${options.id}" loaded, ${String(dimensions)} dimensions`);
      return { modelId: options.id, dimensions };
    } catch (error) {
      await model.dispose();
      throw new EngineError("load", `The embedding model could not be prepared: ${String(error)}`);
    }
  }

  async function complete(
    callId: number,
    request: CompletionRequest,
    onToken?: (text: string) => void,
  ): Promise<CompletionResult> {
    const loaded = loadedChat;
    if (loaded === null) throw new EngineError("load", "No chat model is loaded.");
    if (runningCall !== null) throw new EngineError("refused", "A generation is already running.");
    if (request.messages.some((message) => (message.images?.length ?? 0) > 0)) {
      throw new EngineError(
        "unsupported-images",
        "This runtime loads no vision model, so an image cannot be part of the conversation.",
      );
    }

    const running = new AbortController();
    controller = running;
    runningCall = callId;
    const meterBefore = loaded.sequence.tokenMeter.getState();
    const supportsFunctions = wrapperSupportsFunctions(loaded.wrapper);
    const filter = supportsFunctions ? null : createFenceFilter();
    // ONE token sink per call: main's channel by default (the worker posts an
    // event per chunk) and the caller's own callback when a caller in this
    // process asked for one, so an answer is never delivered twice.
    const emit = onToken ?? ((text: string): void => sink.onToken(callId, text));

    const meterAfter = (): { promptTokens: number; completionTokens: number } => {
      const after = loaded.sequence.tokenMeter.getState();
      return {
        promptTokens: Math.max(0, after.usedInputTokens - meterBefore.usedInputTokens),
        completionTokens: Math.max(0, after.usedOutputTokens - meterBefore.usedOutputTokens),
      };
    };

    try {
      let history = chatHistoryFrom(request.messages);
      let functions: ReturnType<typeof functionsFrom> | undefined;
      if (request.tools.length > 0) {
        if (supportsFunctions) {
          functions = functionsFrom(request.tools);
        } else {
          const block = fallbackToolsBlock(request.tools);
          if (block !== null) history = withSystemBlock(history, block);
        }
      }

      const response = await loaded.chat.generateResponse(history, {
        ...(functions === undefined ? {} : { functions, documentFunctionParams: true }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
        signal: running.signal,
        stopOnAbortSignal: true,
        // `onResponseChunk` rather than `onTextChunk`: the latter carries only the
        // main response, and a reasoning model's first segment IS a `thought`
        // (Qwen3.5 opens with one), so text-chunk-only streaming shows a user
        // nothing at all while the model thinks. See the note on `text` below.
        onResponseChunk: (chunk) => {
          const text = filter === null ? chunk.text : filter.push(chunk.text);
          if (text !== "") emit(text);
        },
      });

      const fallback = filter?.finish() ?? null;
      const calls =
        response.functionCalls !== undefined && response.functionCalls.length > 0
          ? toolCallsFrom(response.functionCalls)
          : (fallback?.calls ?? []);
      // The contract has ONE text field and no place for a reasoning segment, so
      // the whole of what the model generated is passed through in order: a model
      // that thinks inside a segment shows its thinking, which is what a local
      // model's transcript honestly is. The day the contract grows a `reasoning`
      // field, this is the line that splits it — and nothing else changes.
      const full = response.fullResponse
        .map((part) => (typeof part === "string" ? part : part.text))
        .join("");
      return {
        text: fallback === null ? full : fallback.text,
        toolCalls: calls,
        stopReason: calls.length > 0 ? "tool-calls" : stopReasonFrom(response.metadata.stopReason),
        ...meterAfter(),
      };
    } catch (error) {
      if (running.signal.aborted) {
        // The caller asked to stop. That is an ANSWER (`aborted`), not a failure:
        // the contract has a stop reason for it, and the agent loop treats it as
        // the user's decision rather than as a defect.
        const fallback = filter?.finish() ?? null;
        return {
          text: fallback?.text ?? "",
          toolCalls: [],
          stopReason: "aborted",
          ...meterAfter(),
        };
      }
      throw new EngineError("complete", `The model could not answer: ${String(error)}`);
    } finally {
      runningCall = null;
      controller = null;
    }
  }

  function abort(callId: number): void {
    if (runningCall !== callId) {
      throw new EngineError("unknown-call", "Nothing is running under that call id.");
    }
    controller?.abort();
  }

  async function embed(
    callId: number,
    texts: readonly string[],
  ): Promise<{ readonly dimensions: number; readonly vectors: Float32Array[] }> {
    const loaded = loadedEmbedder;
    if (loaded === null) throw new EngineError("load", "No embedding model is loaded.");
    if (runningCall !== null) throw new EngineError("refused", "A generation is already running.");
    runningCall = callId;
    try {
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const embedding = await loaded.context.getEmbeddingFor(text);
        vectors.push(normalise(embedding.vector, loaded.dimensions));
      }
      return { dimensions: loaded.dimensions, vectors };
    } catch (error) {
      throw new EngineError("embed", `The text could not be embedded: ${String(error)}`);
    } finally {
      runningCall = null;
    }
  }

  async function unloadAll(): Promise<void> {
    if (runningCall !== null) {
      controller?.abort();
      throw new EngineError("refused", "A generation is running; wait for it or abort it first.");
    }
    await disposeChat();
    await disposeEmbedder();
    const pending = llamaPromise;
    llamaPromise = null;
    if (pending !== null) {
      try {
        await (await pending).dispose();
      } catch (error) {
        sink.log?.(`assistant runtime: disposing the llama instance failed: ${String(error)}`);
      }
    }
  }

  return {
    async hardware(): Promise<HardwareReading> {
      const instance = await llama();
      const ram = await instance.getRamState();
      const vram = await instance.getVramState();
      const backend = instance.supportsGpuOffloading && instance.gpu !== false ? instance.gpu : "cpu";
      return {
        totalRamBytes: ram.total,
        freeRamBytes: ram.free,
        cpuThreads: instance.cpuMathCores,
        backend,
        deviceNames: await instance.getGpuDeviceNames(),
        vramBytes: vram.total,
        unifiedVramBytes: vram.unifiedSize,
        usedVramBytes: vram.used,
      };
    },
    loadChat,
    loadEmbedder,
    complete,
    abort,
    embed,
    unloadAll,
    chat(id: string): ChatModel {
      const loaded = loadedChat;
      if (loaded === null || loaded.id !== id) {
        throw new EngineError("load", "That chat model is not the one that is loaded.");
      }
      return {
        info: loaded.info,
        complete: async (request, signal, onToken) => {
          if (signal.aborted) throw new EngineError("unknown-call", "The turn was aborted before it started.");
          const callId = adaptersNextCallId();
          const stop = (): void => {
            try {
              abort(callId);
            } catch {
              // The call already finished, so the late abort is a no-op — which
              // is exactly what an `AbortSignal` that fires after the answer
              // should be.
            }
          };
          signal.addEventListener("abort", stop, { once: true });
          try {
            return await complete(callId, request, onToken);
          } finally {
            signal.removeEventListener("abort", stop);
          }
        },
      };
    },
    embedder(id: string): Embedder {
      const loaded = loadedEmbedder;
      if (loaded === null || loaded.id !== id) {
        throw new EngineError("load", "That embedding model is not the one that is loaded.");
      }
      return {
        modelId: loaded.id,
        dimensions: loaded.dimensions,
        embed: async (texts, signal) => {
          if (signal.aborted) throw new EngineError("unknown-call", "The embedding was aborted before it started.");
          const result = await embed(adaptersNextCallId(), texts);
          return result.vectors;
        },
      };
    },
  };
}

/**
 * The llama instance for this process, built for the best backend this machine
 * can actually LOAD.
 *
 * `build: "never"` and `skipDownload: true` are the two options that keep a
 * failed binary from becoming a network request or a compiler invocation; see
 * the module header.
 */
async function createLlama(sink: EngineSink): Promise<Llama> {
  const { getLlama, getLlamaGpuTypes, LlamaLogLevel } = await llamaCpp();
  let gpu: "cuda" | "vulkan" | "metal" | false = false;
  try {
    const supported = await getLlamaGpuTypes("supported");
    gpu = supported.find((type) => type !== false) ?? false;
  } catch (error) {
    sink.log?.(`assistant runtime: no GPU backend could be tested, using the CPU: ${String(error)}`);
  }
  return await getLlama({
    gpu,
    build: "never",
    skipDownload: true,
    usePrebuiltBinaries: true,
    logLevel: LlamaLogLevel.warn,
  });
}

/**
 * The context a model is loaded with: the runtime's own figure, never more than
 * the model was trained for.
 *
 * `contextTokens: 0` means "not known" — a search result, whose header nobody has
 * read yet — and is answered with the runtime's default rather than with zero.
 */
function loadedContextTokens(contextTokens: number): number {
  return contextTokens > 0 ? Math.min(contextTokens, LOAD_CONTEXT_TOKENS) : LOAD_CONTEXT_TOKENS;
}

/**
 * Whether this wrapper can be driven with `functions` at all.
 *
 * The library's own test is `chatWrapper.settings.functions != null` (it is
 * written that way inside `LlamaChat`), and a wrapper without those settings is
 * a template whose function-calling syntax node-llama-cpp does not know — which
 * is exactly when the contract's text fallback is wanted.
 */
function wrapperSupportsFunctions(wrapper: ChatWrapper): boolean {
  const settings = wrapper.settings as { readonly functions?: unknown };
  return settings.functions !== undefined && settings.functions !== null;
}

/** The tools' system block, appended to the conversation's own system message when there is one. */
function withSystemBlock(
  history: ReturnType<typeof chatHistoryFrom>,
  block: string,
): ReturnType<typeof chatHistoryFrom> {
  const first = history[0];
  if (first !== undefined && first.type === "system" && typeof first.text === "string") {
    return [{ type: "system", text: `${first.text}\n\n${block}` }, ...history.slice(1)];
  }
  return [{ type: "system", text: block }, ...history];
}

/** L2-normalised, and padded to `dimensions` if the model answered with fewer. */
function normalise(vector: Float32Array | readonly number[], dimensions: number): Float32Array {
  const out = new Float32Array(dimensions);
  const count = Math.min(dimensions, vector.length);
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const value = vector[index] ?? 0;
    out[index] = value;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (norm > 0 && Number.isFinite(norm)) {
    for (let index = 0; index < count; index += 1) out[index] = (out[index] ?? 0) / norm;
  }
  return out;
}
