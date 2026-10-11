import type { ChatMessage, ToolSpec } from "@nexus/core";
import { describe, expect, it } from "vitest";

import {
  TOOL_CALL_FENCE,
  chatHistoryFrom,
  createFenceFilter,
  fallbackToolsBlock,
  functionsFrom,
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
  it("gives the model the English description and the schema it was given", () => {
    const functions = functionsFrom([TOOL]);
    expect(functions["tasks.create"]?.description).toBe("Creates a task");
    expect(functions["tasks.create"]?.params).toEqual(TOOL.parameters);
  });
});

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
