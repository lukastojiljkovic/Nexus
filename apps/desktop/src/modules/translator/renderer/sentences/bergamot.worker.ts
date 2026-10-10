/**
 * The translation worker: the Bergamot WASM engine, the pack's model files, and
 * the message protocol in `protocol.ts`.
 *
 * **What comes from the npm package, unmodified.** `@browsermt/bergamot-translator`
 * 0.4.9 ships the engine as `bergamot-translator-worker.wasm` plus its Emscripten
 * glue `bergamot-translator-worker.js` (MPL-2.0). Both are imported here with
 * Vite's `?url` suffix, so the bundler emits them as assets and this worker loads
 * them byte-for-byte: the glue through `importScripts`, the wasm through the
 * `instantiateWasm` hook. Nothing in either file is patched or regenerated.
 *
 * **Why the wrapper below is written here rather than imported.** The package's
 * own `translator.js` builds its worker and finds its engine with
 * `new URL('./worker/translator-worker.js', import.meta.url)` and
 * `new URL('./bergamot-translator-worker.wasm', self.location)`. That is right
 * for the unbundled build the package is published as, and impossible for a
 * bundled one: after Vite has hashed and moved the assets, the worker script's
 * own URL no longer has the wasm beside it, and the model registry the package
 * downloads from would be a network call this app may not make. So the ~120
 * lines of WASM binding glue (aligned memory, `TranslationModel`,
 * `BlockingService`, the response vectors) are mirrored from the package's
 * `worker/translator-worker.js` 0.4.9 — same method order, same default
 * configuration, same message protocol — with two differences, both stated where
 * they occur: the wasm is fetched from an emitted asset URL rather than from
 * `self.location`, and the models are packed by `loadModelFromPack`.
 *
 * **One model at a time.** The page offers one direction at a time, and a loaded
 * model is ~17–32 MB of files and ~250 MB resident, so loading another direction
 * releases the previous one first. Idle release is the page's decision
 * (`idle.ts`); this worker only obeys an `unload`.
 *
 * **The assets, and the platform's two wiring facts.** Vite bundles this file as
 * a classic worker (`worker.format: "iife"` is the default), which is why
 * `importScripts` is available. Two things outside this file must agree with it,
 * both owned by the shell rather than by this module: the worker needs
 * `worker-src`/`child-src` (or `default-src`) to admit its own script URL, and
 * `connect-src` must admit `nx-pack:` so the three model fetches are not blocked
 * while the app is offline. See the module report for the exact lines.
 */

import glueUrl from "@browsermt/bergamot-translator/worker/bergamot-translator-worker.js?url";
import wasmUrl from "@browsermt/bergamot-translator/worker/bergamot-translator-worker.wasm?url";
import type { WorkerReply, WorkerRequest } from "./protocol.js";

/** The worker global scope, as much of it as this file uses. `lib.dom` has no worker scope, so it is declared here. */
interface WorkerScope {
  postMessage(message: unknown): void;
  importScripts(...urls: string[]): void;
  fetch(input: string): Promise<Response>;
  readonly location: { readonly href: string };
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = self as unknown as WorkerScope;

// --- The WASM surface ------------------------------------------------------
//
// The C++ classes Emscripten exports, as much of each as the wrapper below
// touches. Opaque handles are objects this file never inspects; the array-like
// ones are read by index or converted with `getTranslatedText`.

interface AlignedMemory {
  getByteArrayView(): Int8Array;
  delete(): void;
}

interface AlignedMemoryList {
  push_back(memory: AlignedMemory): void;
  delete(): void;
}

interface TranslationModel {
  delete(): void;
}

interface VectorString {
  push_back(text: string): void;
  delete(): void;
}

interface BergamotResponseOptions {
  readonly alignment: boolean;
  readonly html: boolean;
  readonly qualityScores: boolean;
}

interface VectorResponseOptions {
  push_back(options: BergamotResponseOptions): void;
  delete(): void;
}

/** One sentence of the engine's answer. Named away from the DOM's `Response`, which this file would otherwise shadow. */
interface BergamotResponse {
  getTranslatedText(): string;
}

interface BergamotResponseVector {
  get(index: number): BergamotResponse;
  delete(): void;
}

interface BlockingService {
  translate(
    model: TranslationModel,
    input: VectorString,
    options: VectorResponseOptions,
  ): BergamotResponseVector;
}

/** The Emscripten module: its exports plus the two hooks the glue reads off it. */
interface BergamotModule {
  BlockingService: new (options: { cacheSize: number }) => BlockingService;
  AlignedMemory: new (size: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => AlignedMemoryList;
  TranslationModel: new (
    config: string,
    model: AlignedMemory,
    shortlist: AlignedMemory,
    vocabs: AlignedMemoryList,
    qualityModel: AlignedMemory | null,
  ) => TranslationModel;
  VectorString: new () => VectorString;
  VectorResponseOptions: new () => VectorResponseOptions;
  /** The instantiated wasm's exports, where the embedded intgemm functions live. */
  asm: Record<string, (...args: number[]) => number>;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    accept: (instance: WebAssembly.Instance) => void,
  ) => unknown;
  onRuntimeInitialized?: () => void;
}

/**
 * The intgemm symbols bergamot expects, mapped to the fallback implementations
 * compiled into the same wasm binary. Firefox Nightly can swizzle these for a
 * faster kernel through `mozIntGemm`; this app runs in Electron's Chromium, so
 * only the fallback path exists here — the upstream wrapper's native branch is
 * unreachable and is left out rather than carried dead.
 */
const GEMM_FALLBACKS: Record<string, string> = {
  int8_prepare_a: "int8PrepareAFallback",
  int8_prepare_b: "int8PrepareBFallback",
  int8_prepare_b_from_transposed: "int8PrepareBFromTransposedFallback",
  int8_prepare_b_from_quantized_transposed: "int8PrepareBFromQuantizedTransposedFallback",
  int8_prepare_bias: "int8PrepareBiasFallback",
  int8_multiply_and_add_bias: "int8MultiplyAndAddBiasFallback",
  int8_select_columns_of_b: "int8SelectColumnsOfBFallback",
};

/**
 * The Marian configuration, as the upstream wrapper assembles it: its defaults
 * (beam size 1, int8shiftAlphaAll — the only shifted precision the wasm build
 * supports) plus its overrides. Written as one literal because the values do not
 * vary per model: the three released architectures (tiny, base-memory, base) all
 * take this same set, which is what Firefox delivers them with.
 */
const MARIAN_CONFIG = [
  "beam-size: 1",
  "normalize: 1.0",
  "word-penalty: 0",
  "cpu-threads: 0",
  "gemm-precision: int8shiftAlphaAll",
  "skip-cost: true",
  "alignment: soft",
  "quiet: true",
  "quiet-translation: true",
  "max-length-break: 128",
  "mini-batch-words: 1024",
  "workspace: 128",
  "max-length-factor: 2.0",
  "",
].join("\n");

/** The module object the glue fills in. Passed to it as the global `Module`. */
const engine: Partial<BergamotModule> = {};

let modulePromise: Promise<BergamotModule> | null = null;
let service: BlockingService | null = null;
let loaded: { key: string; model: TranslationModel } | null = null;
/** The ready engine, for the pieces that need its constructors. */
let loadedModule: BergamotModule | null = null;

/**
 * Resolves a bundler-emitted asset URL against this worker's own URL.
 *
 * The renderer is built with `base: "./"`, so an emitted asset is named relative
 * to the chunk that imports it. `importScripts` and `new URL(…, location)`
 * resolve against the worker script's directory, which is the same directory the
 * asset sits in — and for an absolute URL (the dev server's `/@fs/…`) the
 * resolution changes nothing.
 */
function assetUrl(url: string): string {
  return new URL(url, scope.location.href).href;
}

/**
 * Fetches and instantiates the engine, then loads the glue, and resolves once
 * Emscripten says the runtime is up.
 *
 * The wasm is fetched from the asset URL the bundler emitted rather than from
 * `self.location` (see the header), and the glue is loaded with `importScripts`
 * so its top-level `moduleOverrides`/`Module` wiring runs exactly as upstream's
 * worker runs it. `instantiateStreaming` needs the response's MIME type to be
 * `application/wasm`; a custom scheme that does not set one falls back to
 * `WebAssembly.instantiate`, which does not care.
 */
function loadEngine(): Promise<BergamotModule> {
  if (modulePromise !== null) return modulePromise;
  modulePromise = (async () => {
    const response = await scope.fetch(assetUrl(wasmUrl));
    if (!response.ok) throw new Error(`the translation engine's wasm could not be read (${response.status})`);
    const bytes = await response.arrayBuffer();

    const ready = new Promise<BergamotModule>((accept, reject) => {
      engine.instantiateWasm = (imports, done) => {
        try {
          WebAssembly.instantiate(bytes, {
            ...imports,
            wasm_gemm: Object.fromEntries(
              Object.entries(GEMM_FALLBACKS).map(([expected, fallback]) => [
                expected,
                (...args: number[]) => {
                  const exported = engine.asm?.[fallback];
                  if (exported === undefined) throw new Error(`the engine has no ${fallback}`);
                  return exported(...args);
                },
              ]),
            ),
          })
            .then(({ instance }) => done(instance))
            .catch(reject);
        } catch (error) {
          reject(error);
          return undefined;
        }
        // Upstream's worker returns an empty object from this hook; Emscripten
        // reads a falsy return as "the instance arrives through `done`", so the
        // value is deliberately nothing.
        return undefined;
      };
      engine.onRuntimeInitialized = () => accept(engine as BergamotModule);
    });

    // The glue reads `Module` off the global scope, exactly as upstream sets it.
    (globalThis as unknown as { Module?: unknown }).Module = engine;
    scope.importScripts(assetUrl(glueUrl));
    const module = await ready;
    service = new module.BlockingService({ cacheSize: 0 });
    loadedModule = module;
    return module;
  })();
  return modulePromise;
}

/** One aligned copy of a file's bytes, at the alignment Marian requires for it. */
function aligned(module: BergamotModule, bytes: ArrayBuffer, size: number): AlignedMemory {
  const memory = new module.AlignedMemory(bytes.byteLength, size);
  memory.getByteArrayView().set(new Int8Array(bytes));
  return memory;
}

/** Releases the loaded model, if there is one. The service stays; it holds no model. */
function unload(): void {
  loaded?.model.delete();
  loaded = null;
}

/**
 * Loads the model of one direction from the three pack files.
 *
 * Files are fetched plain (the pack stores Mozilla's uncompressed exports) and
 * copied into memory Marian owns. Re-loading the same direction is a no-op, and
 * loading a different one releases the previous model first.
 */
async function loadModel(
  direction: string,
  urls: { model: string; shortlist: string; vocab: string },
): Promise<void> {
  if (loaded?.key === direction) return;
  const module = await loadEngine();

  const read = async (url: string, what: string): Promise<ArrayBuffer> => {
    const response = await scope.fetch(url);
    if (!response.ok) throw new Error(`${what} could not be read from the pack (${response.status})`);
    return await response.arrayBuffer();
  };
  const [modelBytes, shortlistBytes, vocabBytes] = await Promise.all([
    read(urls.model, "the model"),
    read(urls.shortlist, "the shortlist"),
    read(urls.vocab, "the vocabulary"),
  ]);

  const modelMemory = aligned(module, modelBytes, 256);
  const shortlistMemory = aligned(module, shortlistBytes, 64);
  const vocabs = new module.AlignedMemoryList();
  vocabs.push_back(aligned(module, vocabBytes, 64));

  // Released BEFORE the new model is built, so two models are never resident.
  unload();
  const model = new module.TranslationModel(
    MARIAN_CONFIG,
    modelMemory,
    shortlistMemory,
    vocabs,
    null,
  );
  vocabs.delete();
  loaded = { key: direction, model };
}

/** Translates sentences that are already split, in order, one batch at a time. */
function translate(direction: string, sentences: readonly string[]): string[] {
  const model = loaded?.model;
  if (model === undefined) throw new Error("no translation model is loaded");
  if (loaded?.key !== direction) throw new Error("a different translation model is loaded");
  const block = service;
  if (block === null) throw new Error("the translation engine is not ready");

  const module = loadedModule;
  if (module === null) throw new Error("the translation engine is not ready");
  const input = new module.VectorString();
  const options = new module.VectorResponseOptions();
  try {
    for (const sentence of sentences) input.push_back(sentence);
    for (let at = 0; at < sentences.length; at += 1) {
      options.push_back({ alignment: false, html: false, qualityScores: false });
    }
    const responses = block.translate(model, input, options);
    try {
      return sentences.map((_sentence, index) => responses.get(index).getTranslatedText());
    } finally {
      responses.delete();
    }
  } finally {
    input.delete();
    options.delete();
  }
}

/** One reply per request, carrying the request's own id. */
function reply(message: WorkerReply): void {
  scope.postMessage(message);
}

scope.addEventListener("message", (event) => {
  const request = event.data as WorkerRequest;
  if (typeof request !== "object" || request === null || typeof request.id !== "number") return;
  void (async () => {
    try {
      if (request.kind === "load") {
        await loadModel(request.direction, request.urls);
        reply({ id: request.id, kind: "ack" });
        return;
      }
      if (request.kind === "translate") {
        reply({ id: request.id, kind: "translated", sentences: translate(request.direction, request.sentences) });
        return;
      }
      unload();
      reply({ id: request.id, kind: "ack" });
    } catch (error) {
      reply({
        id: request.id,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
