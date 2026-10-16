import { describe, expect, it } from "vitest";
import { MAX_TOOLS_PER_TURN } from "./toolChoice.js";
import { ToolMeaningIndex } from "./toolMeaning.js";
import type { Embedder, JsonSchema, ToolSpec } from "./contract.js";

/**
 * The meaning index against a fake embedder, which records what it was asked to
 * embed. A real model is not needed to prove the caching and the cosine; what
 * the model thinks of a tool is the thing this file does not claim.
 */

const EMPTY_SCHEMA: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

const tool = (name: string, en: string, sr = `${en} (sr)`): ToolSpec => ({
  name,
  description: { sr, en },
  parameters: EMPTY_SCHEMA,
  effect: "read",
});

const TASKS = tool("tasks.create", "Creates a task from a title.");
const NOTES = tool("notes.list", "Lists the notes by date.");

/**
 * An embedder whose vectors are chosen by the text: the question starts with
 * "q:", tasks.create's text says so, and everything else points the other way.
 */
function fakeEmbedder(modelId = "fake-embedder") {
  const asked: string[][] = [];
  const embedder: Embedder = {
    modelId,
    dimensions: 2,
    embed(texts) {
      asked.push([...texts]);
      return Promise.resolve(
        texts.map((text) => {
          if (text.startsWith("q:") || text.includes("tasks.create")) return new Float32Array([1, 0]);
          return new Float32Array([0, 1]);
        }),
      );
    },
  };
  return { embedder, asked };
}

const signal = (): AbortSignal => new AbortController().signal;

/** Lets the background warm-up finish: the fake embedder answers at once, so one macrotask is enough. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** An index whose descriptions are already embedded, and the record of what it asked after that. */
async function warmed(tools: readonly ToolSpec[], made = fakeEmbedder()) {
  const index = new ToolMeaningIndex();
  await index.similarities(tools, "q: warm", made.embedder, signal());
  await settle();
  made.asked.length = 0;
  return { index, ...made };
}

describe("ToolMeaningIndex", () => {
  it("answers undefined without an embedder, so the lexical choice is the whole answer", async () => {
    const index = new ToolMeaningIndex();
    expect(await index.similarities([TASKS, NOTES], "q: zdravo", null, signal())).toBeUndefined();
  });

  it("does not make a question wait for the descriptions: it answers undefined and embeds them behind it", async () => {
    let release = (): void => undefined;
    const asked: string[][] = [];
    const slow: Embedder = {
      modelId: "slow",
      dimensions: 2,
      embed(texts) {
        asked.push([...texts]);
        return new Promise((resolve) => {
          release = () => resolve(texts.map(() => new Float32Array([1, 0])));
        });
      },
    };
    const index = new ToolMeaningIndex();
    expect(await index.similarities([TASKS, NOTES], "q: prvi", slow, signal())).toBeUndefined();
    expect(asked).toEqual([[expect.stringContaining("tasks.create"), expect.stringContaining("notes.list")]]);
    // A second turn while the first warm-up runs starts no second one.
    expect(await index.similarities([TASKS, NOTES], "q: drugi", slow, signal())).toBeUndefined();
    expect(asked).toHaveLength(1);
    release();
  });

  it("gives each tool the cosine of its description against the question", async () => {
    const { index, embedder } = await warmed([TASKS, NOTES]);
    const meaning = await index.similarities([TASKS, NOTES], "q: dodaj zadatak", embedder, signal());
    expect(meaning?.get("tasks.create")).toBeCloseTo(1);
    expect(meaning?.get("notes.list")).toBeCloseTo(0);
  });

  it("embeds a tool's description once: a warmed turn asks only for the question", async () => {
    const { index, embedder, asked } = await warmed([TASKS, NOTES]);
    await index.similarities([TASKS, NOTES], "q: prvi", embedder, signal());
    await index.similarities([TASKS, NOTES], "q: drugi", embedder, signal());
    expect(asked).toEqual([["q: prvi"], ["q: drugi"]]);
  });

  it("embeds again a tool whose description changed, and no other", async () => {
    const { index, embedder, asked } = await warmed([TASKS, NOTES]);
    const edited = tool("tasks.create", "Creates a task from a title and a due date.");
    expect(await index.similarities([edited, NOTES], "q: drugi", embedder, signal())).toBeUndefined();
    await settle();
    expect(asked).toEqual([[expect.stringContaining("due date")]]);
  });

  it("keeps the vectors of one model apart from another's", async () => {
    const { index } = await warmed([TASKS], fakeEmbedder("model-a"));
    const second = fakeEmbedder("model-b");
    expect(await index.similarities([TASKS], "q: drugi", second.embedder, signal())).toBeUndefined();
    expect(second.asked).toEqual([[expect.stringContaining("tasks.create")]]);
  });

  it("lifts no more tools than a turn can offer: only the closest are in the map", async () => {
    const many = Array.from({ length: MAX_TOOLS_PER_TURN + 4 }, (_, index) => tool(`area.verb${String(index)}`, "Other."));
    const { index, embedder } = await warmed([TASKS, ...many]);
    const meaning = await index.similarities([TASKS, ...many], "q: dodaj zadatak", embedder, signal());
    expect(meaning?.size).toBe(MAX_TOOLS_PER_TURN);
    expect(meaning?.get("tasks.create")).toBeCloseTo(1);
  });

  it("stores nothing when the embedder answers fewer vectors than it was asked for", async () => {
    const short: Embedder = {
      modelId: "short",
      dimensions: 2,
      embed: () => Promise.resolve([new Float32Array([1, 0])]),
    };
    const index = new ToolMeaningIndex();
    expect(await index.similarities([TASKS, NOTES], "q: x", short, signal())).toBeUndefined();
    await settle();
    expect(await index.similarities([TASKS, NOTES], "q: x", short, signal())).toBeUndefined();
  });

  it("answers undefined when the embedder fails, and neither the turn nor the warm-up throws", async () => {
    const broken: Embedder = {
      modelId: "broken",
      dimensions: 2,
      embed: () => Promise.reject(new Error("the model is gone")),
    };
    const index = new ToolMeaningIndex();
    expect(await index.similarities([TASKS], "q: x", broken, signal())).toBeUndefined();
    await settle();
    expect(await index.similarities([TASKS], "q: x", broken, signal())).toBeUndefined();
  });
});
