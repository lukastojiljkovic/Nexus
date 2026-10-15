/**
 * The calls the user refused inside ONE turn.
 *
 * **Why the loop holds this.** A tool that would write or reach the network asks
 * the user first (`ToolContext.confirm`), and the system prompt tells the model
 * both that a refusal is an ordinary result and that a refused call is never
 * repeated (`prompts.ts`). A local model repeats it anyway - observed on the
 * packaged app with 2-4B models - and the user is then asked the same question
 * again inside a turn they have already answered. The prompt cannot close that:
 * the half of the rule a model can ignore is not a rule, so the loop remembers
 * the "no" itself and answers the repeat without running anything.
 *
 * **A key is the tool's name and its canonical arguments.** A model writes the
 * same arguments as a different OBJECT every time it repeats a call - the keys
 * in another order, a value written `1.0` where the first call wrote `1` - so one
 * key has to see through the spelling ({@link canonicalJson}), or the repeat is
 * asked again. A call with DIFFERENT arguments is deliberately a different key:
 * a corrected call is a new question, and the user may well say yes to it.
 *
 * **The memory dies with the turn.** A "no" answers a question about this turn's
 * request; the next user message may change the user's mind, so the tool asks
 * again there.
 *
 * **A "yes" is not remembered.** Only a refusal is recorded, so a repeated call
 * the user approved is a fresh request they still decide. What IS shared is the
 * question itself: two identical calls in one model step run in parallel, and
 * they park on ONE `confirm`, so the user is asked once and both calls take that
 * answer - if it was "yes", both run, exactly as two identical calls always did.
 */

import type { ConfirmRequest, ToolCall, ToolContext, ToolResult } from "./contract.js";

export interface RefusalMemory {
  /** What to answer a call the user already refused, or `undefined` when it may run. */
  alreadyDeclined(call: ToolCall): ToolResult | undefined;
  /** The context one call runs with: the context itself, with `confirm` learning from the answer. */
  contextFor(call: ToolCall, context: ToolContext): ToolContext;
}

/** An empty memory: one turn, one of these. */
export function createRefusalMemory(): RefusalMemory {
  const refused = new Set<string>();
  /** The questions in flight, so two identical parallel calls ask once. Cleared as each one is answered. */
  const asking = new Map<string, Promise<boolean>>();

  function ask(key: string, context: ToolContext, request: ConfirmRequest): Promise<boolean> {
    const pending = asking.get(key);
    if (pending !== undefined) return pending;
    const question = (async (): Promise<boolean> => {
      try {
        const approved = await context.confirm(request);
        if (!approved) refused.add(key);
        return approved;
      } finally {
        asking.delete(key);
      }
    })();
    asking.set(key, question);
    return question;
  }

  return {
    alreadyDeclined(call) {
      return refused.has(callKey(call)) ? alreadyRefused(call.name) : undefined;
    },
    contextFor(call, context) {
      const key = callKey(call);
      return { ...context, confirm: (request) => ask(key, context, request) };
    },
  };
}

/**
 * What a repeat of a refused call is answered with.
 *
 * A tool RESULT and not an error: nothing failed and nothing ran, which is the
 * same shape the tool's own refusal has, and the model is told what to do
 * instead - repeat the call and the user is asked again, which is the whole
 * reason this exists.
 */
function alreadyRefused(name: string): ToolResult {
  return {
    ok: false,
    content: `The user already refused ${name} with these arguments in this turn. Do not call it again: tell the user it was not done.`,
  };
}

/** One call's key: the tool it named, and its arguments (see {@link canonicalJson}). */
function callKey(call: ToolCall): string {
  return `${call.name}|${canonicalJson(call.arguments)}`;
}

/**
 * A value as stable JSON: an object's members are sorted, so the same arguments
 * written in another order are one key.
 *
 * Deliberately not `JSON.stringify` alone, and deliberately not a general
 * canonical-JSON implementation either: what it has to tell apart is the
 * arguments a model wrote for one call, so numbers keep JSON's own spelling
 * (`1.0` and `1` are one key) and anything JSON cannot write becomes `null`
 * rather than throwing.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value as Record<string, unknown>)
      .map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`)
      .sort();
    return `{${members.join(",")}}`;
  }
  const written = JSON.stringify(value);
  return written === undefined ? "null" : written;
}
