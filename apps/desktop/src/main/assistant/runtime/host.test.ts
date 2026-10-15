import type { ChatModel, ModelEntry } from "@nexus/core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DownloadService } from "../../download/service.js";
import { bundledCatalogue, type CatalogueEntry } from "./catalogue.js";
import { parseHostRequest, PROTOCOL_VERSION, type HostEvent } from "./protocol.js";
import { createModelHost, type ModelHostDeps, type WorkerPort } from "./host.js";
import { modelFilePath, upsertInstalled } from "./install.js";

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-host-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/**
 * Writes a model into the registry with a file on disk, so the host's existence
 * check passes.
 *
 * The id is one the catalogue no longer carries (Qwen3.5 2B, withdrawn by
 * ADR-113), which is what most of these tests want: an installed model the
 * chooser cannot offer, because the registry — not the catalogue — is what the
 * host reads for the installed list, a load and a removal.
 */
function installFixture(id: string, overrides: Partial<CatalogueEntry> = {}): ModelEntry {
  const entry: CatalogueEntry = {
    id,
    origin: "catalogue",
    title: "Qwen3.5 2B (Q4_K_M)",
    family: "Qwen3.5",
    repo: "unsloth/Qwen3.5-2B-GGUF",
    file: "Qwen3.5-2B-Q4_K_M.gguf",
    sha256: "a".repeat(64),
    sizeBytes: 1_280_835_840,
    quantization: "Q4_K_M",
    contextTokens: 262144,
    capabilities: ["chat", "tools"],
    languages: [],
    licence: { name: "Apache-2.0", url: "https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/LICENSE" },
    ...overrides,
  };
  const path = modelFilePath(userData, id, entry.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "a model");
  upsertInstalled(userData, { ...entry, installedAt: 1_760_000_000_000 });
  return entry;
}

/**
 * A worker on the other side of the wire, scripted.
 *
 * It validates EVERY request with `parseHostRequest` before answering, which is
 * the "validated on both sides" claim made executable: a request the host builds
 * but the protocol does not admit is a failed test rather than a silent
 * difference between the two sides. Its replies are built as plain objects, which
 * is exactly what a forked worker would post.
 */
class FakeWorker implements WorkerPort {
  readonly requests: string[] = [];
  readonly parsed: unknown[] = [];
  readonly seen: HostEvent[] = [];
  /** While `control.hold` is true this worker records requests and answers none of them. */
  control: { hold: boolean } = { hold: false };
  exits = 0;
  /** The text the scripted model "generates", chunk by chunk. */
  answer: readonly string[] = ["Zdravo"];
  /** Set to a failure code to make the next request fail. */
  failNext: { readonly code: "load" | "complete"; readonly message: string } | null = null;
  private listener: ((message: unknown) => void) | null = null;
  private exitListener: (() => void) | null = null;
  private readonly callIds = new Map<number, number>();

  post(message: unknown): void {
    const request = parseHostRequest(message);
    this.parsed.push(request);
    this.requests.push(request.kind);
    if (this.control.hold) return;
    if (this.failNext !== null) {
      const failure = this.failNext;
      this.failNext = null;
      queueMicrotask(() => {
        this.emit({
          v: PROTOCOL_VERSION,
          kind: "failed",
          ...("seq" in request ? { seq: request.seq } : {}),
          code: failure.code,
          message: failure.message,
        });
      });
      return;
    }
    switch (request.kind) {
      case "hardware":
        this.emit({
          v: PROTOCOL_VERSION,
          kind: "hardware",
          seq: request.seq,
          hardware: {
            totalRamBytes: 33_963_352_064,
            freeRamBytes: 15_940_681_728,
            cpuThreads: 10,
            gpus: [{ name: "NVIDIA GeForce RTX 4070 Laptop GPU", vramBytes: 6_723_469_312, backend: "vulkan" }],
          },
        });
        return;
      case "load-chat":
        this.emit({
          v: PROTOCOL_VERSION,
          kind: "loaded",
          seq: request.seq,
          info: {
            id: request.id,
            title: request.title,
            capabilities: request.capabilities,
            contextTokens: request.contextTokens > 0 ? 8192 : 8192,
            wrapper: "fixture",
            functionCalling: "native",
          },
        });
        return;
      case "load-embedder":
        this.emit({
          v: PROTOCOL_VERSION,
          kind: "embedder-ready",
          seq: request.seq,
          modelId: request.id,
          dimensions: 1024,
        });
        return;
      case "complete": {
        this.callIds.set(request.seq, request.callId);
        // A MACROTASK, so a caller that aborts synchronously after starting a
        // turn reaches the worker first — which is what a real generation does
        // (it takes seconds) and what makes the abort path testable at all.
        setTimeout(() => {
          for (const chunk of this.answer) {
            this.emit({ v: PROTOCOL_VERSION, kind: "token", callId: request.callId, text: chunk });
          }
          this.emit({
            v: PROTOCOL_VERSION,
            kind: "result",
            seq: request.seq,
            callId: request.callId,
            result: {
              text: this.answer.join(""),
              toolCalls: [],
              stopReason: "end",
              promptTokens: 12,
              completionTokens: 4,
            },
          });
        }, 0);
        return;
      }
      case "abort": {
        const seq = [...this.callIds.entries()].find(([, callId]) => callId === request.callId)?.[0];
        if (seq !== undefined) {
          this.callIds.delete(seq);
          this.emit({
            v: PROTOCOL_VERSION,
            kind: "result",
            seq,
            callId: request.callId,
            result: { text: "", toolCalls: [], stopReason: "aborted", promptTokens: 12, completionTokens: 1 },
          });
        }
        return;
      }
      case "embed":
        this.emit({
          v: PROTOCOL_VERSION,
          kind: "embedded",
          seq: request.seq,
          callId: request.callId,
          dimensions: 4,
          vectors: request.texts.map(() => [0.5, 0.5, 0.5, 0.5]),
        });
        return;
      case "unload":
        this.emit({ v: PROTOCOL_VERSION, kind: "unloaded", seq: request.seq });
        return;
    }
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listener = listener;
  }

  onExit(listener: () => void): void {
    this.exitListener = listener;
  }

  /** Simulates the utility process dying: main learns through the port, not from a promise. */
  die(): void {
    this.exits += 1;
    this.exitListener?.();
  }

  private emit(event: HostEvent): void {
    queueMicrotask(() => {
      this.seen.push(event);
      this.listener?.(event);
    });
  }
}

function makeHost(
  overrides: Partial<ModelHostDeps> = {},
  options: {
    readonly failFirst?: { readonly code: "load" | "complete"; readonly message: string };
    readonly control?: { hold: boolean };
  } = {},
): {
  readonly host: ReturnType<typeof createModelHost>;
  readonly workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const host = createModelHost({
    userData,
    mode: () => "downloads",
    isAllowedUrl: () => true,
    spawnWorker: () => {
      const worker = new FakeWorker();
      worker.failNext = options.failFirst ?? null;
      if (options.control !== undefined) worker.control = options.control;
      workers.push(worker);
      return worker;
    },
    downloadFor: () => ({}) as DownloadService,
    fetchJson: () => Promise.resolve([]),
    freeBytes: () => Promise.resolve(64 * 1024 * 1024 * 1024),
    ...overrides,
  });
  return { host, workers };
}

describe("the model host on a fake worker", () => {
  it("caches the hardware reading for the session and sends nothing else for it", async () => {
    const { host, workers } = makeHost();
    const first = await host.hardware();
    const second = await host.hardware();
    expect(first).toEqual(second);
    expect(first.cpuThreads).toBe(10);
    expect(workers[0]?.requests).toEqual(["hardware"]);
  });

  it("loads the installed model, with the file it will actually read", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    const model = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(model.info).toEqual({
      id: "qwen3.5-2b-q4-k-m",
      title: "Qwen3.5 2B (Q4_K_M)",
      capabilities: ["chat", "tools"],
      contextTokens: 8192,
      wrapper: "fixture",
      functionCalling: "native",
    });
    const worker = workers[0];
    expect(worker?.requests).toEqual(["hardware", "load-chat"]);
    const load = worker?.parsed[1];
    expect(load).toMatchObject({
      kind: "load-chat",
      modelPath: modelFilePath(userData, "qwen3.5-2b-q4-k-m", "Qwen3.5-2B-Q4_K_M.gguf"),
      gpuLayers: "auto",
      threads: 10,
    });
  });

  it("reads the GPU-layer override at load time, so a setting applies without a restart", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    let layers: number | "auto" = "auto";
    const { host, workers } = makeHost({ gpuLayers: () => layers });
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    layers = 12;
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(workers[0]?.parsed[1]).toMatchObject({ gpuLayers: "auto" });
    // The second load is the third request: hardware is cached.
    expect(workers[0]?.parsed[2]).toMatchObject({ gpuLayers: 12 });
  });

  it("answers a second load of the model it already has without asking the worker again", async () => {
    // `register.ts` loads on every turn, and a model that is in memory is not
    // read from disk again: the second call is the same request, so it is
    // answered from what the first one produced.
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    const first = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const second = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(second.info).toEqual(first.info);
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat"]);
  });

  it("loads a different entry in place of the resident one", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    installFixture("qwen3.5-2b-q4-k-m-second");
    const { host, workers } = makeHost();
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const next = await host.loadChat("qwen3.5-2b-q4-k-m-second", new AbortController().signal);
    expect(next.info.id).toBe("qwen3.5-2b-q4-k-m-second");
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat", "load-chat"]);
  });

  it("reloads when the entry's own policy changes, because that is a different model to run", async () => {
    installFixture("qwen3.5-2b-q4-k-m", { contextCap: 4096 });
    const { host, workers } = makeHost();
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    // The user's copy of the entry is re-read on every load (`requireInstalled`),
    // so a cap that arrives with a catalogue refresh is honoured on the next turn.
    installFixture("qwen3.5-2b-q4-k-m", { contextCap: 2048 });
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat", "load-chat"]);
    expect(workers[0]?.parsed[2]).toMatchObject({ contextCap: 2048 });
  });

  it("hands the entry's per-model policy to the worker", async () => {
    installFixture("qwen3.5-2b-q4-k-m", {
      contextCap: 16384,
      thoughtTokens: 512,
      sampling: { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
    });
    const { host, workers } = makeHost();
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(workers[0]?.parsed[1]).toMatchObject({
      kind: "load-chat",
      contextCap: 16384,
      thoughtTokens: 512,
      sampling: { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
    });
  });

  it("does not give a resident model back because the turn that asked for it was stopped", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const controller = new AbortController();
    controller.abort();
    await expect(host.loadChat("qwen3.5-2b-q4-k-m", controller.signal)).rejects.toMatchObject({
      code: "aborted",
    });
    // No `unload`: nothing was loaded for this call, so nothing is handed back.
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat"]);
  });

  it("streams an answer and answers with the tokens the worker reported", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    const model = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const tokens: string[] = [];
    const result = await model.complete(
      { messages: [{ role: "user", content: "Zdravo!" }], tools: [] },
      new AbortController().signal,
      (text) => tokens.push(text),
    );
    expect(tokens.join("")).toBe("Zdravo");
    expect(result).toEqual({
      text: "Zdravo",
      toolCalls: [],
      stopReason: "end",
      promptTokens: 12,
      completionTokens: 4,
    });
    const worker = workers[0];
    // Every request the host built passed the protocol's own validator: the fake
    // worker parses each message before it answers one.
    expect(worker?.requests).toEqual(["hardware", "load-chat", "complete"]);
  });

  it("answers an aborted turn with the contract's `aborted` stop reason", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    const model = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const controller = new AbortController();
    const waiting = model.complete(
      { messages: [{ role: "user", content: "hi" }], tools: [] },
      controller.signal,
      () => undefined,
    );
    controller.abort();
    const result = await waiting;
    expect(result.stopReason).toBe("aborted");
    expect(workers[0]?.requests).toContain("abort");
    // An already-aborted signal costs no request at all.
    const before = workers[0]?.requests.length ?? 0;
    const aborted = await model.complete(
      { messages: [{ role: "user", content: "hi" }], tools: [] },
      controller.signal,
      () => undefined,
    );
    expect(aborted.stopReason).toBe("aborted");
    expect(workers[0]?.requests.length).toBe(before);
  });

  it("refuses an image in main, so no user picture crosses into the worker", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    const model = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const before = workers[0]?.requests.length ?? 0;
    await expect(
      model.complete(
        {
          messages: [
            { role: "user", content: "what is this", images: [{ mime: "image/png", bytes: new Uint8Array([1]) }] },
          ],
          tools: [],
        },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "unsupported-images" });
    expect(workers[0]?.requests.length).toBe(before);
  });

  it("refuses a model that is not installed, and one whose file is gone", async () => {
    const { host, workers } = makeHost();
    await expect(host.loadChat("nothing", new AbortController().signal)).rejects.toMatchObject({
      code: "not-installed",
    });
    const entry = installFixture("qwen3.5-2b-q4-k-m");
    rmSync(modelFilePath(userData, entry.id, entry.file));
    await expect(host.loadChat(entry.id, new AbortController().signal)).rejects.toMatchObject({
      code: "not-installed",
    });
    // Nothing was asked of the worker for either refusal: the worker is not even
    // forked, because both are decided from the registry and the filesystem.
    expect(workers).toEqual([]);
  });

  it("unloads before removing the model that is loaded", async () => {
    const entry = installFixture("qwen3.5-2b-q4-k-m");
    const { host, workers } = makeHost();
    await host.loadChat(entry.id, new AbortController().signal);
    await host.remove(entry.id);
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat", "unload"]);
    expect(await host.installed()).toEqual([]);
  });

  it("refuses the Hub outside the downloads mode, before any request", async () => {
    let asked = 0;
    const { host } = makeHost({
      mode: () => "offline",
      fetchJson: () => {
        asked += 1;
        return Promise.resolve([]);
      },
    });
    await expect(host.searchHuggingFace("qwen", new AbortController().signal)).rejects.toMatchObject({
      code: "mode",
    });
    expect(asked).toBe(0);
  });

  it("hands the search through the same allowlist the session uses", async () => {
    const { host } = makeHost({ isAllowedUrl: (url) => url.includes("huggingface.co") });
    const entries = await host.searchHuggingFace("qwen", new AbortController().signal);
    expect(entries).toEqual([]);
  });

  it("loads an embedder and answers vectors of the width the worker reported", async () => {
    installFixture("qwen3-embedding-0.6b-q8-0", { capabilities: ["embedding"], file: "Qwen3-Embedding-0.6B-Q8_0.gguf" });
    const { host, workers } = makeHost();
    const embedder = await host.loadEmbedder("qwen3-embedding-0.6b-q8-0", new AbortController().signal);
    expect(embedder.modelId).toBe("qwen3-embedding-0.6b-q8-0");
    expect(embedder.dimensions).toBe(1024);
    const vectors = await embedder.embed(["one", "two"], new AbortController().signal);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[0]?.length).toBe(4);
    expect(workers[0]?.requests).toEqual(["hardware", "load-embedder", "embed"]);
  });

  it("hands back the catalogue and refuses nothing about an empty install", async () => {
    const { host } = makeHost();
    expect(await host.installed()).toEqual([]);
    const catalogue = await host.catalogue();
    expect(catalogue).toHaveLength(8);
    expect(host.recommend(await host.hardware(), catalogue)).toHaveLength(3);
  });

  it("keeps a model whose entry left the catalogue: listed, loadable and removable", async () => {
    // People who installed a model that a later run withdrew keep the file, and
    // the registry is what the installed list is read from (`readInstalled` in
    // `install.ts`), never the catalogue: the chooser is the only reader of that,
    // through `recommend`. So withdrawal costs a user nothing but the pick.
    const entry = installFixture("qwen3.5-2b-q4-k-m");
    expect(bundledCatalogue().map((candidate) => candidate.id)).not.toContain(entry.id);
    const { host } = makeHost();
    expect((await host.installed()).map((candidate) => candidate.id)).toEqual([entry.id]);
    const model = await host.loadChat(entry.id, new AbortController().signal);
    expect(model.info.id).toBe(entry.id);
    await host.remove(entry.id);
    expect(await host.installed()).toEqual([]);
    expect(existsSync(modelFilePath(userData, entry.id, entry.file))).toBe(false);
  });

  it("refuses every pending request when the worker dies, and forks a new one next time", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const control = { hold: true };
    const { host, workers } = makeHost({}, { control });
    const pending = host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    // Let the host fork its worker and post its requests.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers).toHaveLength(1);
    workers[0]?.die();
    await expect(pending).rejects.toMatchObject({ code: "worker" });
    control.hold = false;
    const model = await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    expect(model.info.id).toBe("qwen3.5-2b-q4-k-m");
    expect(workers).toHaveLength(2);
  });

  it("turns a worker refusal into the runtime's own error, and its code keeps the meaning", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    const { host } = makeHost({}, {
      failFirst: { code: "load", message: "the file is not a model this build can load" },
    });
    await expect(
      host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal),
    ).rejects.toMatchObject({ code: "load" });
  });

  it("keeps one chat model at a time by asking the worker to swap", async () => {
    installFixture("qwen3.5-2b-q4-k-m");
    installFixture("qwen3.5-4b-q4-k-m", {
      title: "Qwen3.5 4B (Q4_K_M)",
      file: "Qwen3.5-4B-Q4_K_M.gguf",
      sha256: "b".repeat(64),
    });
    const { host, workers } = makeHost();
    await host.loadChat("qwen3.5-2b-q4-k-m", new AbortController().signal);
    const second: ChatModel = await host.loadChat("qwen3.5-4b-q4-k-m", new AbortController().signal);
    expect(second.info.id).toBe("qwen3.5-4b-q4-k-m");
    await host.unloadAll();
    expect(workers[0]?.requests).toEqual(["hardware", "load-chat", "load-chat", "unload"]);
  });
});
