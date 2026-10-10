/**
 * A `ChatModel` that plays a script.
 *
 * Every test in this folder - the loop's, the evals harness's, and any future
 * one - needs a model that does exactly what a test says and can prove what it
 * was asked. This is that model: a list of steps, each one a text, a set of
 * tool calls, or a stop reason, streamed token by token, with every request it
 * received kept for statements.
 *
 * It is exported from the assistant's public surface on purpose. It is not
 * production code and nothing in the app constructs one: the runtime's
 * `createModelHost` is the only thing that loads a real model, and a fake that
 * cannot be reached from a test in another package is a fake every test
 * re-invents.
 *
 * Two behaviours exist so tests can be honest rather than convenient. A script
 * that runs out THROWS rather than returning an empty answer, because an
 * under-scripted test should fail loudly instead of passing on a default it
 * never wrote. And a step can fail on purpose, so `model-failed` is reachable
 * without mocking the runtime.
 */

import type {
  ChatModel,
  CompletionRequest,
  CompletionResult,
  LoadedModelInfo,
  ModelCapability,
  StopReason,
  ToolCall,
} from "./contract.js";

export interface ScriptedStep {
  readonly text?: string;
  readonly toolCalls?: readonly ToolCall[];
  /** Defaults to `tool-calls` when the step carries calls, `end` otherwise. */
  readonly stopReason?: StopReason;
  /** The chunks `onToken` receives. Defaults to the text split at word boundaries. */
  readonly tokens?: readonly string[];
  /** Reported back; defaults to a rough character estimate, as a real runtime would report. */
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /** Wait before streaming, so a test can abort while the model is „thinking". */
  readonly delayMs?: number;
  /** Throw this message instead of returning, for the `model-failed` path. */
  readonly fail?: string;
}

export interface ScriptedModelOptions {
  readonly id?: string;
  readonly title?: string;
  readonly capabilities?: readonly ModelCapability[];
  readonly contextTokens?: number;
}

export interface ScriptedChatModel extends ChatModel {
  /** Every request this model received, oldest first. */
  readonly requests: readonly CompletionRequest[];
}

/**
 * A model that answers with `steps[i]` on its i-th call.
 *
 * The default `info` is a modest chat model with tools and a 4096-token window;
 * a test that cares about the budget or about `no-model` overrides it.
 */
export function createScriptedModel(
  steps: readonly ScriptedStep[],
  options: ScriptedModelOptions = {},
): ScriptedChatModel {
  const info: LoadedModelInfo = {
    id: options.id ?? "scripted-model",
    title: options.title ?? "Scripted model",
    capabilities: options.capabilities ?? ["chat", "tools"],
    contextTokens: options.contextTokens ?? 4096,
  };
  const requests: CompletionRequest[] = [];
  let index = 0;

  return {
    info,
    requests,
    async complete(request, signal, onToken): Promise<CompletionResult> {
      requests.push(request);
      const step = steps[index];
      index += 1;
      if (step === undefined) {
        throw new Error(`scripted model has no step ${index} (${steps.length} scripted)`);
      }
      if (step.delayMs !== undefined && step.delayMs > 0) {
        await wait(step.delayMs);
      }
      if (step.fail !== undefined) throw new Error(step.fail);

      const text = step.text ?? "";
      const tokens = step.tokens ?? splitTokens(text);
      let streamed = "";
      for (const chunk of tokens) {
        if (signal.aborted) return abortedResult(streamed);
        onToken(chunk);
        streamed += chunk;
      }
      if (signal.aborted) return abortedResult(streamed);

      const toolCalls = step.toolCalls ?? [];
      return {
        text,
        toolCalls,
        stopReason: step.stopReason ?? (toolCalls.length > 0 ? "tool-calls" : "end"),
        promptTokens: step.promptTokens ?? roughTokens(request.messages.map((m) => m.content)),
        completionTokens: step.completionTokens ?? roughTokens([text]),
      };
    },
  };
}

/** Word-boundary chunks, with the whitespace kept, so the concatenation is the text. */
function splitTokens(text: string): readonly string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * A rough count, standing in for a runtime's own tokeniser. Four characters per
 * token is the English side of the measurement in `budget.ts`; a test that
 * wants exact numbers writes them into the step.
 */
function roughTokens(parts: readonly string[]): number {
  let characters = 0;
  for (const part of parts) characters += part.length;
  return Math.ceil(characters / 4);
}

function abortedResult(streamed: string): CompletionResult {
  return {
    text: streamed,
    toolCalls: [],
    stopReason: "aborted",
    promptTokens: 0,
    completionTokens: 0,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
