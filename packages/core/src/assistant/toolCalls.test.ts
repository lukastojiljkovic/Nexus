import { describe, expect, it } from "vitest";
import { parseToolCalls } from "./toolCalls.js";

/**
 * The samples below are the formats as each family's own artefact writes them,
 * retrieved 2026-10-10:
 *
 *  - Hermes: https://github.com/NousResearch/Hermes-Function-Calling (README,
 *    "Inference Example Output": the `<tool_call>` block around
 *    `{"name": "get_stock_fundamentals", "arguments": {"symbol": "TSLA"}}`).
 *  - Qwen 2.5: https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/raw/main/tokenizer_config.json
 *    (the chat template asks for "a json object with function name and
 *    arguments within <tool_call></tool_call> XML tags:
 *    {"name": <function-name>, "arguments": <args-json-object>}"; the values
 *    here are filled in the same shape).
 *  - Llama 3.2: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/models/templates/meta-llama-Llama-3.2-3B-Instruct.jinja
 *    (llama.cpp's copy of Meta's template: it instructs
 *    `{"name": function name, "parameters": dictionary of argument name and its
 *    value}` and renders the assistant turn as exactly that object).
 *  - Mistral 7B Instruct v0.3: https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/raw/main/tokenizer_config.json
 *    (the template emits `[TOOL_CALLS] [` then each call's function JSON, then
 *    `, "id": "..."`, then `]`).
 *  - Ministral/Magistral Large 3: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tests/test-chat.cpp
 *    (the fixtures `[TOOL_CALLS]special_function[ARGS]{"arg1":1}`, including two
 *    in one message for parallel calls).
 */

const HERMES =
  '<tool_call>\n{"name": "get_stock_fundamentals", "arguments": {"symbol": "TSLA"}}\n</tool_call>';

describe("Hermes and Qwen: <tool_call> blocks", () => {
  it("reads the documented sample", () => {
    expect(parseToolCalls(HERMES)).toEqual({
      text: "",
      calls: [{ name: "get_stock_fundamentals", arguments: { symbol: "TSLA" } }],
    });
  });

  it("keeps the prose that surrounds the block", () => {
    const text = `Provericu to.\n${HERMES}`;
    expect(parseToolCalls(text)).toEqual({
      text: "Provericu to.",
      calls: [{ name: "get_stock_fundamentals", arguments: { symbol: "TSLA" } }],
    });
  });

  it("reads several blocks in one message, in order", () => {
    const text = `<tool_call>{"name": "tasks.list", "arguments": {}}</tool_call><tool_call>{"name": "calendar.list", "arguments": {"day": "2026-10-10"}}</tool_call>`;
    expect(parseToolCalls(text).calls).toEqual([
      { name: "tasks.list", arguments: {} },
      { name: "calendar.list", arguments: { day: "2026-10-10" } },
    ]);
  });

  it("reads a JSON array inside one block", () => {
    const text = `<tool_call>[{"name": "a.b", "arguments": {}}, {"name": "c.d", "arguments": {"n": 1}}]</tool_call>`;
    expect(parseToolCalls(text).calls).toEqual([
      { name: "a.b", arguments: {} },
      { name: "c.d", arguments: { n: 1 } },
    ]);
  });

  it("leaves a block alone when its JSON does not parse", () => {
    const text = `<tool_call>{"name": "tasks.list", "arguments": {</tool_call>`;
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });

  it("leaves a block alone when its JSON is not a call", () => {
    const text = `<tool_call>{"temperature": 26.1, "location": "San Francisco"}</tool_call>`;
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });
});

describe("Llama 3.x: a bare JSON object as the whole message", () => {
  it("reads the documented shape, with parameters as the arguments", () => {
    const text =
      '{"name": "get_current_weather", "parameters": {"location": "San Francisco, CA", "unit": "celsius"}}';
    expect(parseToolCalls(text)).toEqual({
      text: "",
      calls: [
        {
          name: "get_current_weather",
          arguments: { location: "San Francisco, CA", unit: "celsius" },
        },
      ],
    });
  });

  it("reads it behind the builtin-tools python tag", () => {
    const text = '<|python_tag|>{"name": "web_search", "parameters": {"query": "helicopter signal"}}';
    expect(parseToolCalls(text)).toEqual({
      text: "",
      calls: [{ name: "web_search", arguments: { query: "helicopter signal" } }],
    });
  });

  it("does not read a call-shaped object out of prose", () => {
    const text = 'Evo podataka: {"name": "Ana", "parameters": {"city": "Nis"}}';
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });

  it("does not read an object with extra keys as a call", () => {
    const text = '{"name": "x", "parameters": {}, "role": "user"}';
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });
});

describe("Mistral: [TOOL_CALLS]", () => {
  it("reads the v0.3 shape, a JSON array behind the marker", () => {
    const text = '[TOOL_CALLS] [{"name": "get_weather", "arguments": {"city": "Paris"}}]';
    expect(parseToolCalls(text)).toEqual({
      text: "",
      calls: [{ name: "get_weather", arguments: { city: "Paris" } }],
    });
  });

  it("reads two calls and ignores the id the template also emits", () => {
    const text =
      '[TOOL_CALLS] [{"name": "get_weather", "arguments": {"city": "Paris"}, "id": "Vl3Qd1kQg"}, {"name": "tasks.list", "arguments": {}}]';
    expect(parseToolCalls(text).calls).toEqual([
      { name: "get_weather", arguments: { city: "Paris" } },
      { name: "tasks.list", arguments: {} },
    ]);
  });

  it("reads the newer name[ARGS] form llama.cpp's fixtures carry", () => {
    expect(parseToolCalls('[TOOL_CALLS]special_function[ARGS]{"arg1": 1}')).toEqual({
      text: "",
      calls: [{ name: "special_function", arguments: { arg1: 1 } }],
    });
  });

  it("reads two of them in one message, the parallel fixture", () => {
    const text =
      '[TOOL_CALLS]special_function[ARGS]{"arg1": 1}[TOOL_CALLS]special_function_with_opt[ARGS]{"arg1": 1, "arg2": 2}';
    expect(parseToolCalls(text).calls).toEqual([
      { name: "special_function", arguments: { arg1: 1 } },
      { name: "special_function_with_opt", arguments: { arg1: 1, arg2: 2 } },
    ]);
  });

  it("keeps the prose around the marker", () => {
    const text = 'Trazim prognozu.\n[TOOL_CALLS] [{"name": "get_weather", "arguments": {}}]';
    expect(parseToolCalls(text).text).toBe("Trazim prognozu.");
  });
});

describe("everything else", () => {
  it("returns plain prose unchanged", () => {
    const text = "Danas je lep dan. Kako mogu da pomognem?";
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });

  it("ignores braces inside a quoted argument value", () => {
    const text = '<tool_call>{"name": "x.y", "arguments": {"q": "}{"}}</tool_call>';
    expect(parseToolCalls(text)).toEqual({
      text: "",
      calls: [{ name: "x.y", arguments: { q: "}{" } }],
    });
  });

  it("does not see a marker glued into an identifier", () => {
    const text = "id:[TOOL_CALLS]x matters";
    expect(parseToolCalls(text)).toEqual({ text, calls: [] });
  });
});
