/**
 * Tool calls that arrive as text.
 *
 * llama.cpp normally parses a model's tool calls from its own chat template and
 * hands them over as `CompletionResult.toolCalls`. A GGUF whose template the
 * runtime does not recognise (or a template with no tool support at all)
 * instead emits the call as ordinary text, and the loop would then read it as
 * an ANSWER - the user sees raw JSON where a reply belongs, and the tool is
 * never run. This module is the fallback: it recognises the three shapes that
 * ship in the families the model catalogue carries, strips them from the
 * visible text, and hands the loop calls it can validate.
 *
 * The recognised shapes, each with the artefact it is read from:
 *
 *  - **Hermes / Qwen**: `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`,
 *    possibly several blocks in one message. NousResearch's Hermes function
 *    calling README shows the output verbatim
 *    (https://github.com/NousResearch/Hermes-Function-Calling, retrieved
 *    2026-10-10), and Qwen2.5's own chat template states the same shape for the
 *    assistant turn: "return a json object with function name and arguments
 *    within <tool_call></tool_call> XML tags"
 *    (https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/raw/main/tokenizer_config.json,
 *    retrieved 2026-10-10).
 *
 *  - **Llama 3.x**: `{"name": ..., "parameters": {...}}`, as the whole of the
 *    message's visible text, optionally behind the `<|python_tag|>` marker.
 *    Meta's Llama 3.2 template both instructs that shape ("Respond in the
 *    format {"name": function name, "parameters": dictionary of argument name
 *    and its value}") and renders the assistant turn as exactly that object
 *    (llama.cpp's copy of it:
 *    https://raw.githubusercontent.com/ggml-org/llama.cpp/master/models/templates/meta-llama-Llama-3.2-3B-Instruct.jinja,
 *    retrieved 2026-10-10).
 *
 *  - **Mistral**: `[TOOL_CALLS] [{"name": ..., "arguments": {...}}, ...]`, the
 *    shape Mistral-7B-Instruct-v0.3's chat template emits
 *    (https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/raw/main/tokenizer_config.json,
 *    retrieved 2026-10-10), plus the newer `[TOOL_CALLS]name[ARGS]{json}` form
 *    that llama.cpp's own fixtures carry for Ministral/Magistral
 *    (https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tests/test-chat.cpp,
 *    retrieved 2026-10-10).
 *
 * **Parsing is deliberately literal, and it never guesses.** A block whose JSON
 * does not parse stays in the visible text instead of being removed: a
 * half-parsed call is worse than a visible one, because it would run a tool on
 * arguments the model did not write. A bare JSON object counts as a call only
 * when it is the WHOLE of the message (after the python tag), which is how the
 * Llama family emits it - otherwise a tool result quoted in the answer would
 * read as a command. Arguments are not coerced: a stringified argument object
 * stays a string, and the schema validator's refusal is the model's correction.
 */

export interface ParsedToolCall {
  readonly name: string;
  /** As the model wrote it; `unknown` until `validateToolArguments` has read it. */
  readonly arguments: unknown;
}

export interface ParsedToolCalls {
  /** The message with every recognised call removed. What a page may show. */
  readonly text: string;
  readonly calls: readonly ParsedToolCall[];
}

const HERMES_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const MISTRAL_MARKER = "[TOOL_CALLS]";
const MISTRAL_ARGS = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\[ARGS\]\s*\{/;
const PYTHON_TAG = /<\|python_tag\|>/g;

/** Parse the tool calls a model wrote into its text, and the text that is left. */
export function parseToolCalls(text: string): ParsedToolCalls {
  const hermes = parseHermes(text);
  if (hermes.calls.length > 0) {
    const mistral = parseMistral(hermes.text);
    return mistral.calls.length > 0 ? mistral : hermes;
  }
  const mistral = parseMistral(text);
  if (mistral.calls.length > 0) return mistral;
  return parseLlama(text);
}

/** `<tool_call>…</tool_call>`, one or many. */
function parseHermes(text: string): ParsedToolCalls {
  const calls: ParsedToolCall[] = [];
  const spans: { start: number; end: number }[] = [];
  HERMES_BLOCK.lastIndex = 0;
  for (;;) {
    const match = HERMES_BLOCK.exec(text);
    if (match === null) break;
    const inner = match[1] ?? "";
    const parsed = tryJson(inner.trim());
    const found = callsFromJson(parsed);
    if (found === null) continue;
    // Not a call after all (bad JSON, or a JSON object that is not a call): the
    // block stays in the text.
    calls.push(...found);
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return { text: removeSpans(text, spans), calls };
}

/** `[TOOL_CALLS]` with a JSON array, or the newer `name[ARGS]{…}` form. */
function parseMistral(text: string): ParsedToolCalls {
  const calls: ParsedToolCall[] = [];
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(MISTRAL_MARKER, from);
    if (at < 0) break;
    const payload = at + MISTRAL_MARKER.length;
    // A special token is written once by a template and never by a person; a
    // marker glued into a word (an id containing the string) is not one.
    const before = at === 0 ? " " : text[at - 1] ?? " ";
    if (/[A-Za-z0-9_]/.test(before)) {
      from = payload;
      continue;
    }
    const jsonStart = skipSpace(text, payload);
    const first = text[jsonStart];
    if (first === "[" || first === "{") {
      const end = matchBalanced(text, jsonStart);
      if (end < 0) break;
      const found = callsFromJson(tryJson(text.slice(jsonStart, end)));
      if (found === null) {
        from = payload;
        continue;
      }
      calls.push(...found);
      spans.push({ start: at, end });
      from = end;
      continue;
    }
    const rest = text.slice(payload);
    const named = MISTRAL_ARGS.exec(rest);
    if (named === null) {
      from = payload;
      continue;
    }
    const braceAt = payload + named[0].length - 1;
    const end = matchBalanced(text, braceAt);
    if (end < 0) break;
    const args = tryJson(text.slice(braceAt, end));
    calls.push({ name: named[1] ?? "", arguments: args ?? {} });
    spans.push({ start: at, end });
    from = end;
  }
  return { text: removeSpans(text, spans), calls };
}

/**
 * The Llama 3.x shape: one bare JSON object, and it has to be the whole
 * message. Keys are checked as well as shape, so an answer that quotes a JSON
 * object of its own (`{"name": "Ana", "arguments": []}` out of a note) is not
 * mistaken for a call.
 */
function parseLlama(text: string): ParsedToolCalls {
  const withoutTag = text.replace(PYTHON_TAG, "").trim();
  if (withoutTag.length === 0 || withoutTag[0] !== "{") return { text, calls: [] };
  const end = matchBalanced(withoutTag, 0);
  if (end !== withoutTag.length) return { text, calls: [] };
  const parsed = tryJson(withoutTag);
  const calls = callsFromJson(parsed, ["type", "name", "parameters", "arguments", "id"]);
  return calls === null ? { text, calls: [] } : { text: "", calls };
}

/**
 * Read a parsed JSON value as tool calls, or `null` when it is not one.
 *
 * `allowedKeys` is the narrow form used for a bare object in prose (see
 * {@link parseLlama}); the block forms pass nothing, because their delimiters
 * have already said what the payload is.
 */
function callsFromJson(value: unknown, allowedKeys?: readonly string[]): ParsedToolCall[] | null {
  if (Array.isArray(value)) {
    const calls: ParsedToolCall[] = [];
    for (const element of value) {
      const call = callFromObject(element, allowedKeys);
      if (call === null) return null;
      calls.push(call);
    }
    return calls.length > 0 ? calls : null;
  }
  const call = callFromObject(value, allowedKeys);
  return call === null ? null : [call];
}

function callFromObject(value: unknown, allowedKeys?: readonly string[]): ParsedToolCall | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) return null;
  const hasArguments = Object.hasOwn(record, "arguments");
  const hasParameters = Object.hasOwn(record, "parameters");
  if (!hasArguments && !hasParameters) return null;
  if (allowedKeys !== undefined && Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return null;
  }
  return { name, arguments: hasArguments ? record["arguments"] : record["parameters"] };
}

/**
 * The index just past a balanced `{…}` or `[…]`, string-aware so a brace inside
 * a quoted argument does not close it early. `-1` when it never closes.
 */
function matchBalanced(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (close === "") return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function skipSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index] ?? "")) index += 1;
  return index;
}

function removeSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  if (spans.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  return (out + text.slice(cursor)).trim();
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
