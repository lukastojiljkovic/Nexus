import type { CompletionRequest, LoadedModelInfo, ModelCapability, ToolSpec } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createLlamaEngine, type LoadChatOptions } from "./llama.js";

/**
 * A stand-in for `node-llama-cpp`, handed to the engine through its `library`
 * seam. It records what the engine asks of the library, in order, so the tests
 * can prove the engine's own decisions (the wrapper it reads, the context it
 * loads, the empty sequence it starts each answer on) without a GGUF file.
 */
interface Recording {
  readonly calls: string[];
  contextSize?: number;
  readonly generations: { readonly history: unknown; readonly options: Record<string, unknown> }[];
}

function fakeLibrary(wrapperName: string, settings: { readonly functions?: unknown }, recording: Recording) {
  const sequence = {
    tokenMeter: { getState: () => ({ usedInputTokens: 0, usedOutputTokens: 0 }) },
    clearHistory: async (): Promise<void> => {
      recording.calls.push("clearHistory");
    },
  };
  const context = { getSequence: () => sequence, dispose: async (): Promise<void> => {} };
  const model = {
    gpuLayers: 0,
    createContext: async (options: { readonly contextSize: number }) => {
      recording.contextSize = options.contextSize;
      return context;
    },
    dispose: async (): Promise<void> => {},
  };
  class LlamaChat {
    readonly chatWrapper = { wrapperName, settings };
    constructor(_options: unknown) {}
    async generateResponse(history: unknown, options: Record<string, unknown>) {
      recording.calls.push("generateResponse");
      recording.generations.push({ history, options });
      return { response: "Answer", functionCalls: undefined, metadata: { stopReason: "eogToken" } };
    }
    dispose(): void {}
  }
  const llama = { loadModel: async () => model, dispose: async (): Promise<void> => {} };
  return {
    getLlama: async () => llama,
    getLlamaGpuTypes: async () => [false],
    LlamaLogLevel: { warn: 0 },
    LlamaChat,
  } as unknown as typeof import("node-llama-cpp");
}

function engineWith(wrapperName: string, settings: { readonly functions?: unknown }) {
  const recording: Recording = { calls: [], generations: [] };
  const library = fakeLibrary(wrapperName, settings, recording);
  const engine = createLlamaEngine({ onToken: () => {} }, { library: async () => library });
  return { engine, recording };
}

const NATIVE = { functions: { call: {} } };
const TEXT = {};

function loadOptions(overrides: Partial<LoadChatOptions> = {}): LoadChatOptions {
  return {
    id: "fixture",
    title: "Fixture model",
    capabilities: ["chat"] as ModelCapability[],
    modelPath: "/models/fixture.gguf",
    contextTokens: 262144,
    gpuLayers: "auto",
    threads: 1,
    ...overrides,
  };
}

const TOOL: ToolSpec = {
  name: "tasks.create",
  description: { sr: "Pravi zadatak", en: "Creates a task" },
  parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  effect: "write",
};

const REQUEST: CompletionRequest = {
  messages: [{ role: "user", content: "Make a task" }],
  tools: [TOOL],
};

describe("the chat model's calling path and load policy", () => {
  it("reports the wrapper the library resolved and the calling path it implies", async () => {
    const native = engineWith("Qwen", NATIVE);
    const text = engineWith("Generic", TEXT);
    const nativeInfo: LoadedModelInfo = await native.engine.loadChat(loadOptions());
    const textInfo: LoadedModelInfo = await text.engine.loadChat(loadOptions());
    expect(nativeInfo).toMatchObject({ wrapper: "Qwen", functionCalling: "native" });
    expect(textInfo).toMatchObject({ wrapper: "Generic", functionCalling: "text" });
  });

  it("derives the tools capability from the wrapper, in both directions", async () => {
    const { engine } = engineWith("Qwen", NATIVE);
    const granted = await engine.loadChat(loadOptions({ capabilities: ["chat"] }));
    expect(granted.capabilities).toEqual(["chat", "tools"]);

    const { engine: textEngine } = engineWith("Generic", TEXT);
    const refused = await textEngine.loadChat(loadOptions({ capabilities: ["chat", "tools"] }));
    expect(refused.capabilities).toEqual(["chat"]);
  });

  it("loads at the entry's context, never above its cap, and at the default cap when it states none", async () => {
    const cases: readonly [Partial<LoadChatOptions>, number][] = [
      [{ contextTokens: 262144 }, 8192],
      [{ contextTokens: 262144, contextCap: 4096 }, 4096],
      [{ contextTokens: 2048, contextCap: 4096 }, 2048],
      [{ contextTokens: 0, contextCap: 16384 }, 16384],
    ];
    for (const [overrides, expected] of cases) {
      const { engine, recording } = engineWith("Qwen", NATIVE);
      const info = await engine.loadChat(loadOptions(overrides));
      expect(recording.contextSize).toBe(expected);
      expect(info.contextTokens).toBe(expected);
    }
  });

  it("starts every answer on an empty sequence, so no turn sees the one before it", async () => {
    const { engine, recording } = engineWith("Qwen", NATIVE);
    await engine.loadChat(loadOptions());
    await engine.chat("fixture").complete(REQUEST, new AbortController().signal, () => {});
    await engine.chat("fixture").complete(REQUEST, new AbortController().signal, () => {});
    expect(recording.calls).toEqual([
      "clearHistory",
      "generateResponse",
      "clearHistory",
      "generateResponse",
    ]);
  });

  it("passes the entry's sampling and thought budget, and a request's own temperature still wins", async () => {
    const { engine, recording } = engineWith("Qwen", NATIVE);
    await engine.loadChat(
      loadOptions({ thoughtTokens: 512, sampling: { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1 } }),
    );
    await engine.chat("fixture").complete({ ...REQUEST, maxTokens: 1024 }, new AbortController().signal, () => {});
    await engine.chat("fixture").complete({ ...REQUEST, temperature: 0 }, new AbortController().signal, () => {});
    const [first, second] = recording.generations.map((generation) => generation.options);
    expect(first).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repeatPenalty: { penalty: 1.1 },
      maxTokens: 1024,
      budgets: { thoughtTokens: 512 },
    });
    expect(second).toMatchObject({ temperature: 0 });
  });

  it("keeps the text fallback for a wrapper without function calling, and says the tools in the system block", async () => {
    const { engine, recording } = engineWith("Generic", TEXT);
    await engine.loadChat(loadOptions());
    await engine.chat("fixture").complete(REQUEST, new AbortController().signal, () => {});
    const [generation] = recording.generations;
    expect(generation?.options).not.toHaveProperty("functions");
    expect(JSON.stringify(generation?.history)).toContain("tasks.create");
  });
});
