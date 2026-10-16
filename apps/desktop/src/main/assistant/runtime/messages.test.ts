import type { ChatMessage, ToolSpec } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY } from "../../../shared/moduleVisibility.js";
import { createToolRegistry } from "../tools/index.js";
import {
  TOOL_CALL_FENCE,
  chatHistoryFrom,
  createFenceFilter,
  fallbackToolsBlock,
  functionsFrom,
  grammarSchemaFor,
  parsedCall,
  stopReasonFrom,
  toolCallIdFor,
  toolCallsFrom,
} from "./messages.js";

const TOOL: ToolSpec = {
  name: "tasks.create",
  description: { sr: "Pravi zadatak", en: "Creates a task" },
  parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  effect: "write",
};

/**
 * The contract's conversation as llama.cpp's chat history.
 *
 * The fold is the whole point: the contract carries a tool call as an assistant
 * message and its result as a separate `tool` message (that is what the agent
 * loop has to emit to stream a result while the answer is still being written),
 * and llama.cpp renders the two as ONE segment inside the assistant's turn. The
 * pairing is by `toolCallId` and never by position, so a reordered history cannot
 * silently attach a result to the wrong call.
 */
describe("chatHistoryFrom", () => {
  it("folds a tool result into the call it answers", () => {
    const history = chatHistoryFrom([
      { role: "system", content: "You are Nexus." },
      { role: "user", content: "Napravi zadatak." },
      {
        role: "assistant",
        content: "Pravim ga.",
        toolCalls: [
          { id: "call_1", name: "tasks.create", arguments: { title: "Kupovina" } },
          { id: "call_2", name: "tasks.list", arguments: {} },
        ],
      },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "call_2" },
      { role: "tool", content: "{\"id\":\"t1\"}", toolCallId: "call_1" },
    ]);
    expect(history).toEqual([
      { type: "system", text: "You are Nexus." },
      { type: "user", text: "Napravi zadatak." },
      {
        type: "model",
        response: [
          "Pravim ga.",
          {
            type: "functionCall",
            name: "tasks.create",
            params: { title: "Kupovina" },
            result: "{\"id\":\"t1\"}",
          },
          { type: "functionCall", name: "tasks.list", params: {}, result: "{\"ok\":true}" },
        ],
      },
    ]);
  });

  it("keeps an assistant turn that is only a tool call", () => {
    const history = chatHistoryFrom([
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "app.open", arguments: {} }] },
      { role: "tool", content: "opened", toolCallId: "call_1" },
    ]);
    expect(history[1]).toEqual({
      type: "model",
      response: [{ type: "functionCall", name: "app.open", params: {}, result: "opened" }],
    });
  });

  it("answers null for a result whose call is not in the history", () => {
    // A template renders a result only INSIDE the call it answers, so a result
    // with no call renders nowhere — dropping it here is the template's own
    // behaviour rather than a second opinion about it.
    const history = chatHistoryFrom([
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "x", arguments: {} }] },
      { role: "tool", content: "orphan", toolCallId: "call_9" },
    ]);
    expect(history).toEqual([
      { type: "model", response: [{ type: "functionCall", name: "x", params: {}, result: null }] },
    ]);
  });

  it("drops an assistant turn with nothing in it", () => {
    const messages: readonly ChatMessage[] = [{ role: "assistant", content: "" }];
    expect(chatHistoryFrom(messages)).toEqual([]);
  });

  it("maps a user message without its images", () => {
    const history = chatHistoryFrom([
      {
        role: "user",
        content: "what is this",
        images: [{ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
      },
    ]);
    expect(history).toEqual([{ type: "user", text: "what is this" }]);
  });
});

describe("functionsFrom", () => {
  it("gives the model the English description and the schema it decodes under", () => {
    const functions = functionsFrom([TOOL]);
    expect(functions["tasks.create"]?.description).toBe("Creates a task");
    // The grammar copy, not the tool's own schema — the same document here,
    // because a required string has nothing to translate.
    expect(functions["tasks.create"]?.params).toEqual(TOOL.parameters);
  });
});

/**
 * The grammar a tool call decodes under.
 *
 * node-llama-cpp compiles a function's `params` into GBNF and forces every key
 * in `properties` — its own `types.d.ts` says „`required` is always set to all
 * keys in `properties`, and setting it has no effect" — so an optional property
 * handed over unchanged is one the model MUST fill, and the value a small model
 * writes for a field it has nothing to say about is `""`. The second gap is a
 * `pattern`: the grammar's string schema knows `minLength`, `maxLength` and
 * `format`, and no regular expression, so a day spelled as a pattern would let
 * the model write „tomorrow" there.
 */
describe("grammarSchemaFor", () => {
  const DAY = "^\\d{4}-\\d{2}-\\d{2}$";

  it("hands an optional property to the grammar as a choice with null", () => {
    expect(
      grammarSchemaFor({
        type: "object",
        properties: { note: { type: "string", description: "A note." } },
        required: [],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        // The library's own guidance for an optional value, with the
        // description moved where the model reads it.
        note: {
          oneOf: [{ type: "string" }, { type: "null" }],
          description: "A note. Null when not given.",
        },
      },
      required: [],
      additionalProperties: false,
    });
  });

  it("leaves a required property exactly as the tool declared it", () => {
    expect(
      grammarSchemaFor({
        type: "object",
        properties: { title: { type: "string", description: "What it is." } },
        required: ["title"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: { title: { type: "string", description: "What it is." } },
      required: ["title"],
      additionalProperties: false,
    });
  });

  it("reads a day spelled as a pattern as the format the grammar knows", () => {
    expect(grammarSchemaFor({ type: "string", pattern: DAY, description: "The day." })).toEqual({
      type: "string",
      format: "date",
      description: "The day.",
    });
    // A day that may also be cleared (`tasks.reschedule.due`) keeps both
    // branches, and an optional property built on it adds no third one.
    expect(grammarSchemaFor({ type: ["string", "null"], pattern: DAY })).toEqual({
      oneOf: [{ type: "string", format: "date" }, { type: "null" }],
    });
    expect(
      grammarSchemaFor({
        type: "object",
        properties: { due: { type: ["string", "null"], pattern: DAY, description: "The new day." } },
        required: [],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        due: {
          oneOf: [{ type: "string", format: "date" }, { type: "null" }],
          description: "The new day. Null when not given.",
        },
      },
      required: [],
      additionalProperties: false,
    });
  });

  it("drops a pattern the grammar cannot express, and keeps the rest", () => {
    expect(
      grammarSchemaFor({
        type: "string",
        pattern: "^[A-Za-z]{3}$",
        maxLength: 3,
        description: "A currency.",
      }),
    ).toEqual({ type: "string", maxLength: 3, description: "A currency." });
  });

  it("descends into nested objects and into the objects of an array", () => {
    expect(
      grammarSchemaFor({
        type: "object",
        properties: {
          task: {
            type: "object",
            properties: { note: { type: "string", description: "A note." } },
            additionalProperties: false,
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { due: { type: "string", pattern: DAY } },
              required: ["due"],
              additionalProperties: false,
            },
            description: "The items.",
          },
        },
        required: ["task", "items"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        task: {
          type: "object",
          properties: {
            note: {
              oneOf: [{ type: "string" }, { type: "null" }],
              description: "A note. Null when not given.",
            },
          },
          additionalProperties: false,
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { due: { type: "string", format: "date" } },
            required: ["due"],
            additionalProperties: false,
          },
          description: "The items.",
        },
      },
      required: ["task", "items"],
      additionalProperties: false,
    });
  });

  it("does not change the schema it was given", () => {
    const schema = {
      type: "object",
      properties: {
        due: { type: "string", pattern: DAY, description: "The day." },
        note: { type: "string" },
      },
      required: ["due"],
      additionalProperties: false,
    };
    const before = JSON.stringify(schema);
    grammarSchemaFor(schema);
    expect(JSON.stringify(schema)).toBe(before);
  });
});

/**
 * The real registry, built from the fakes its own test builds it from.
 *
 * Reading a tool's schema needs no database: `parameters` is a declaration and
 * nothing here calls `run`, so the store seam is a stub that refuses to be used
 * rather than the temporary profile database `tools/index.test.ts` keeps open
 * for the calls it makes.
 */
function realTools(): readonly ToolSpec[] {
  return createToolRegistry({
    profileDb: () => {
      throw new Error("The grammar test never opens a profile database.");
    },
    now: () => 0,
    search: () => Promise.resolve([]),
    packs: { list: () => Promise.resolve([]) },
    timers: {
      startCountdown: () => {
        throw new Error("The grammar test never starts a countdown.");
      },
      listCountdowns: () => [],
      pauseCountdown: () => {
        throw new Error("The grammar test never pauses a countdown.");
      },
      resumeCountdown: () => {
        throw new Error("The grammar test never resumes a countdown.");
      },
      cancelCountdown: () => {
        throw new Error("The grammar test never cancels a countdown.");
      },
    },
    modules: createModuleRegistry(),
    visibility: () => DEFAULT_SHELL_VISIBILITY,
    web: null,
  }).tools({ web: false });
}

/**
 * Every tool the app ships, under the grammar: a schema this translation
 * mishandled would be a call the model decodes wrongly, tool by tool and
 * invisible until a user meets it.
 */
describe("the grammar of every tool the registry declares", () => {
  it("leaves no pattern behind, and makes every optional property nullable", () => {
    const tools = realTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      walkGrammar(grammarSchemaFor(tool.parameters), tool.name);
    }
  });
});

/**
 * A converted schema, walked node by node: no `pattern` survives anywhere, and
 * every property an object does not require is a choice with null in it.
 */
function walkGrammar(node: Record<string, unknown>, path: string): void {
  expect(Object.hasOwn(node, "pattern"), `${path}.pattern`).toBe(false);
  const branches = node["oneOf"];
  if (Array.isArray(branches)) {
    branches.forEach((branch, index) => {
      if (isNode(branch)) walkGrammar(branch, `${path}/${index}`);
    });
  }
  const items = node["items"];
  if (isNode(items)) walkGrammar(items, `${path}/items`);
  const properties = node["properties"];
  if (!isNode(properties)) return;
  const required = Array.isArray(node["required"]) ? node["required"] : [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isNode(property)) continue;
    if (!required.includes(name)) {
      const ways = property["oneOf"];
      const nullable =
        Array.isArray(ways) &&
        ways.some((way) => isNode(way) && way["type"] === "null");
      expect(nullable, `${path}/${name} must be able to be null`).toBe(true);
    }
    walkGrammar(property, `${path}/${name}`);
  }
}

function isNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("stop reasons and call ids", () => {
  it("maps llama.cpp's four endings onto the contract's", () => {
    expect(stopReasonFrom("eogToken")).toBe("end");
    expect(stopReasonFrom("stopGenerationTrigger")).toBe("end");
    expect(stopReasonFrom("customStopTrigger")).toBe("end");
    expect(stopReasonFrom("functionCalls")).toBe("tool-calls");
    expect(stopReasonFrom("maxTokens")).toBe("length");
    expect(stopReasonFrom("abort")).toBe("aborted");
  });

  it("mints deterministic ids, because llama.cpp has none", () => {
    expect(toolCallIdFor(0)).toBe("call_1");
    expect(toolCallIdFor(4)).toBe("call_5");
    expect(
      toolCallsFrom([
        { functionName: "tasks.create", params: { title: "x" } },
        { functionName: "app.open", params: {} },
      ]),
    ).toEqual([
      { id: "call_1", name: "tasks.create", arguments: { title: "x" } },
      { id: "call_2", name: "app.open", arguments: {} },
    ]);
  });
});

/**
 * The text fallback, for a chat template node-llama-cpp cannot drive with
 * `functions`. Two properties are load-bearing: the fence never appears in what
 * the user reads (the filter holds back the tail of a chunk that might be the
 * start of one), and a fence that does not parse as a call is TEXT, so a model
 * that quotes the format mid-answer has not called anything.
 */
describe("the text fallback", () => {
  const call = `\`\`\`${TOOL_CALL_FENCE}\n{"name": "tasks.create", "arguments": {"title": "Kupovina"}}\n\`\`\``;

  it("describes the tools and the format to the model", () => {
    const block = fallbackToolsBlock([TOOL]);
    expect(block).toContain("tasks.create: Creates a task");
    expect(block).toContain(`\`\`\`${TOOL_CALL_FENCE}`);
    expect(fallbackToolsBlock([])).toBeNull();
  });

  it("parses a call, and only a call", () => {
    expect(parsedCall(call)).toEqual({
      id: "call_1",
      name: "tasks.create",
      arguments: { title: "Kupovina" },
    });
    // No arguments is an empty object, not a missing one: a tool reads its own
    // input and a `null` would be a second shape for "nothing".
    expect(parsedCall(`\`\`\`${TOOL_CALL_FENCE}\n{"name":"app.open"}\n\`\`\``)?.arguments).toEqual({});
    expect(parsedCall("```json\n{\"name\":\"x\"}\n```")).toBeNull();
    expect(parsedCall(`\`\`\`${TOOL_CALL_FENCE}\nnot json\n\`\`\``)).toBeNull();
    expect(parsedCall(`\`\`\`${TOOL_CALL_FENCE}\n{"arguments":{}}\n\`\`\``)).toBeNull();
    expect(parsedCall(`\`\`\`${TOOL_CALL_FENCE}\n["tasks.create"]\n\`\`\``)).toBeNull();
    expect(parsedCall("plain prose")).toBeNull();
  });

  it("keeps the fence out of the visible text, however it is chunked", () => {
    const filter = createFenceFilter();
    let visible = "";
    let stream = `Here you go.\n${call}`;
    while (stream.length > 0) {
      const chunk = stream.slice(0, 7);
      stream = stream.slice(7);
      visible += filter.push(chunk);
    }
    const answer = filter.finish();
    expect(visible + answer.text).toBe("Here you go.\n");
    expect(answer.calls).toHaveLength(1);
    expect(answer.calls[0]?.name).toBe("tasks.create");
  });

  it("releases a fence that is not a call, so nothing is swallowed", () => {
    const filter = createFenceFilter();
    const prose = "That is a ```json block, not a call.";
    const pushed = filter.push(prose);
    const answer = filter.finish();
    expect(pushed + answer.text).toBe(prose);
    expect(answer.calls).toEqual([]);
  });

  it("answers plain prose unchanged", () => {
    const filter = createFenceFilter();
    let visible = "";
    for (const chunk of ["Zdravo", ", ", "svete", "!"]) visible += filter.push(chunk);
    const answer = filter.finish();
    expect(visible + answer.text).toBe("Zdravo, svete!");
    expect(answer.calls).toEqual([]);
  });
});
