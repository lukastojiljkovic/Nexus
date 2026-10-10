/**
 * THE CONTRACT'S MESSAGES AS llama.cpp's OWN CHAT HISTORY, AND BACK.
 *
 * `packages/core/src/assistant/contract.ts` and node-llama-cpp describe the same
 * conversation in two different shapes, and this file is the translation — the
 * only one, so a change in either shape has exactly one place to be made.
 *
 * FOUR DECISIONS WORTH STATING, because each one is visible to the model:
 *
 *   1. **A tool call and its result are ONE history item.** llama.cpp's chat
 *      templates render a call and its result as a pair inside the assistant's
 *      own turn, and node-llama-cpp models exactly that: a
 *      `{type: "functionCall", name, params, result}` segment in a `model`
 *      message. The contract instead carries them as two messages — an
 *      assistant message with `toolCalls` and one `tool` message per call,
 *      which is what the agent loop has to emit to stream a tool result while
 *      the answer is still being written. The fold here is that difference, and
 *      the pairing is by `toolCallId`, never by position.
 *   2. **A `tool` message with no matching call is dropped**, and that is what
 *      the template does with it too: a template renders a result only inside
 *      the call it answers, so a result with no call renders nowhere. Dropping
 *      it here makes the runtime's behaviour the template's behaviour rather
 *      than a second opinion about it.
 *   3. **Tool descriptions reach the model in English.** The model's own chat
 *      templates, its few-shot examples and the JSON Schema its function
 *      calling is built from are English, and the assistant's ANSWER language is
 *      the user's — which is what `description.sr` is for, and the UI reads it.
 *      A bilingual tool list in the prompt would spend context on words the
 *      model already understands twice.
 *   4. **A tool call's `id` is minted here**, because llama.cpp does not have
 *      one: its function-calling output is a name and a params object, and the
 *      result is returned positionally. `call_1`, `call_2` … are therefore the
 *      runtime's own identifiers, they never reach the model, and the agent loop
 *      gets a stable key to pair results with.
 *
 * THE TEXT FALLBACK, for a chat template node-llama-cpp cannot drive with
 * `functions` (see `llama.ts`): the tools are described in a system block and
 * the model is asked for one fenced JSON object. The fence tag is
 * `TOOL_CALL_FENCE`, and the parser is strict — a fence that does not parse as
 * `{name, arguments}` is TEXT, not a call, so a model that quotes the format
 * mid-answer is not mistaken for a model that asked for a tool.
 */

import type { AssistantText, ChatMessage, StopReason, ToolCall, ToolSpec } from "@nexus/core";
import type { ChatHistoryItem, ChatModelFunctionCall, ChatModelFunctions } from "node-llama-cpp";

/** The fence tag of the text fallback. `agent-core`'s parser reads the same tag. */
export const TOOL_CALL_FENCE = "tool_call";

/** How much text is held back while a fence may still be arriving. The tag is 11 characters. */
const FENCE_TAIL = 16;

/**
 * The contract's history as a llama.cpp chat history.
 *
 * `tool` messages are folded into the call they answer; `assistant` messages
 * keep their text and gain one segment per call. Everything else is copied.
 */
export function chatHistoryFrom(messages: readonly ChatMessage[]): ChatHistoryItem[] {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId !== undefined) {
      results.set(message.toolCallId, message.content);
    }
  }

  const history: ChatHistoryItem[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "system":
        history.push({ type: "system", text: message.content });
        break;
      case "user":
        // Images are not mapped: the engine refuses a request that carries them
        // before this is reached, and a template that rendered an image token we
        // cannot fill would be worse than the refusal.
        history.push({ type: "user", text: message.content });
        break;
      case "assistant": {
        const response: Array<string | ChatModelFunctionCall> = [];
        if (message.content !== "") response.push(message.content);
        for (const call of message.toolCalls ?? []) {
          response.push({
            type: "functionCall",
            name: call.name,
            params: call.arguments,
            result: results.get(call.id) ?? null,
          });
        }
        if (response.length > 0) history.push({ type: "model", response });
        break;
      }
      default:
        // Folded above.
        break;
    }
  }
  return history;
}

/** The tools a completion offers, as node-llama-cpp describes functions to a template. */
export function functionsFrom(tools: readonly ToolSpec[]): ChatModelFunctions {
  const functions: Record<string, ChatModelFunctions[string]> = {};
  for (const tool of tools) {
    functions[tool.name] = {
      description: englishDescription(tool.description),
      // The contract's `JsonSchema` is the JSON Schema the model is shown; llama.cpp's
      // `GbnfJsonSchema` is the same document read by its grammar compiler, which
      // refuses a schema it cannot compile before a token is generated. One shape,
      // two readers, and the reader that refuses is the one that matters.
      params: tool.parameters as ChatModelFunctions[string]["params"],
    };
  }
  return functions;
}

/** The English half of a tool's description, which is the half the model reads. */
export function englishDescription(description: AssistantText): string {
  return description.en;
}

/**
 * `call_1`, `call_2` … for the calls of one answer. Deterministic, so a retried
 * turn pairs its results with the same calls.
 */
export function toolCallIdFor(index: number): string {
  return `call_${String(index + 1)}`;
}

/** llama.cpp's stop reasons, as the contract's. */
export function stopReasonFrom(reason: string): StopReason {
  switch (reason) {
    case "functionCalls":
      return "tool-calls";
    case "maxTokens":
      return "length";
    case "abort":
      return "aborted";
    default:
      // `eogToken`, `stopGenerationTrigger` and `customStopTrigger`: all three are
      // the model having finished saying what it had to say.
      return "end";
  }
}

/** The calls llama.cpp reported, as the contract's, with ids minted here. */
export function toolCallsFrom(
  calls: readonly { readonly functionName: string; readonly params: unknown }[],
): readonly ToolCall[] {
  return calls.map((call, index) => ({
    id: toolCallIdFor(index),
    name: call.functionName,
    arguments: call.params,
  }));
}

/**
 * The system block that describes the tools in the text fallback, or `null` when
 * there are none to describe.
 *
 * It is written for the model rather than for a user: one paragraph, the format,
 * one worked example per call, and the instruction to answer with the block
 * alone. The example is not a tool that exists — it is `tasks.create` with the
 * shape every tool in this app has — because a model copies an example more
 * faithfully than it follows a sentence.
 */
export function fallbackToolsBlock(tools: readonly ToolSpec[]): string | null {
  if (tools.length === 0) return null;
  const described = tools.map(
    (tool) => `- ${tool.name}: ${englishDescription(tool.description)}\n  arguments: ${JSON.stringify(tool.parameters)}`,
  );
  return [
    "You can use tools. Each tool takes one JSON object of arguments.",
    "",
    "Available tools:",
    ...described,
    "",
    "To use a tool, answer with ONE fenced block and nothing else:",
    "",
    `\`\`\`${TOOL_CALL_FENCE}`,
    '{"name": "tasks.create", "arguments": {"title": "..."}}',
    "```",
    "",
    "Use a tool only when it is needed to answer, and never write one inside prose.",
  ].join("\n");
}

/** What a finished answer turned out to be: visible text, and the calls it asked for. */
export interface FallbackAnswer {
  readonly text: string;
  readonly calls: readonly ToolCall[];
}

/**
 * A streaming filter that keeps the fallback's fence out of the visible answer.
 *
 * The user must not watch `{"name": …}` appear character by character, and the
 * fence may arrive split across chunks, so the filter holds back the last
 * `FENCE_TAIL` characters until either more text proves they are prose or the
 * answer ends. `finish` answers the visible text and the calls — and when the
 * fence is present but its body does not parse as a call, the fence is treated
 * as ordinary text and released, because a model that printed the format while
 * explaining it has not called anything.
 */
export function createFenceFilter(): {
  readonly push: (chunk: string) => string;
  readonly finish: () => FallbackAnswer;
} {
  let held = "";
  let finished = false;

  return {
    push(chunk) {
      if (finished) return "";
      held += chunk;
      const marker = held.search(/`{3}|`{1,2}$/);
      if (marker === -1) {
        if (held.length <= FENCE_TAIL) return "";
        const emit = held.slice(0, held.length - FENCE_TAIL);
        held = held.slice(held.length - FENCE_TAIL);
        return emit;
      }
      // A fence has started: everything before it is prose and is released now,
      // and the fence itself is kept for `finish`.
      const prose = held.slice(0, marker);
      held = held.slice(marker);
      return prose;
    },
    finish() {
      finished = true;
      const call = parsedCall(held);
      const match = call === null ? null : fenceMatch(held);
      // A fence that is NOT a call is ordinary text, released whole: a model that
      // printed the format while explaining it has not called anything, and
      // swallowing the sentence would be worse than showing it.
      const text =
        match === null ? held : `${held.slice(0, match.index)}${held.slice(match.index + match[0].length)}`.trim();
      held = "";
      return { text, calls: call === null ? [] : [call] };
    },
  };
}

/** The fenced block's own extent — what the caller's text keeps everything around. */
function fenceMatch(text: string): RegExpExecArray | null {
  return new RegExp("```" + TOOL_CALL_FENCE + "\\s*\\n[\\s\\S]*?```").exec(text);
}

/**
 * The call in a finished answer's fence, or `null` when there is not exactly one
 * well-formed one.
 *
 * Strict on purpose: the fence tag must be the FIRST thing the block carries,
 * the body must be one JSON object, `name` must be a non-empty string, and
 * `arguments` — when present — must be an object. `arguments` is handed on as
 * whatever was parsed, because the contract says a tool's arguments are
 * "unvalidated until the tool reads it".
 */
export function parsedCall(text: string): ToolCall | null {
  const match = new RegExp("```" + TOOL_CALL_FENCE + "\\s*\\n([\\s\\S]*?)```").exec(text);
  if (match === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as { name?: unknown; arguments?: unknown };
  if (typeof record.name !== "string" || record.name === "") return null;
  if (record.arguments !== undefined && (typeof record.arguments !== "object" || record.arguments === null)) {
    return null;
  }
  return { id: toolCallIdFor(0), name: record.name, arguments: record.arguments ?? {} };
}
