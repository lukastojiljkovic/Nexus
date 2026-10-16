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
 * **The arguments a key is made of are the NORMALISED ones.** A model repeats a
 * call it was refused with the value written another way as often as with the
 * same bytes - `{"due":"sutra"}` and then `{"due":"2026-10-16"}` - and the tool
 * is handed the normalised value either way (`arguments.ts`). The caller
 * normalises first and passes what the tool would receive, so the two spellings
 * are one question and one "no". This module does no normalisation itself: it
 * is handed the arguments the schema check saw.
 *
 * **The memory dies with the turn.** A "no" answers a question about this turn's
 * request; the next user message may change the user's mind, so the tool asks
 * again there.
 *
 * **A "yes" is never shared.** Only a refusal is recorded, so a repeated call
 * the user approved is a fresh request they still decide. Two identical write
 * calls in one model step are run one after the other and park on ONE question:
 * a "no" answers both, but a "yes" authorises only the call that asked, and the
 * other asks for itself - one approval never runs a write twice.
 */

import type { ConfirmRequest, ToolContext, ToolResult } from "./contract.js";

export interface RefusalMemory {
  /**
   * What to answer a call the user already refused, or `undefined` when it may
   * run. `arguments` are the call's normalised arguments, which are what the
   * tool would be run with.
   */
  alreadyDeclined(name: string, args: unknown): ToolResult | undefined;
  /** The context one call runs with: the context itself, with `confirm` learning from the answer. */
  contextFor(name: string, args: unknown, context: ToolContext): ToolContext;
}

/** An empty memory: one turn, one of these. */
export function createRefusalMemory(): RefusalMemory {
  const refused = new Set<string>();
  /** The questions in flight, so two identical parallel calls ask once. Cleared as each one is answered. */
  const asking = new Map<string, Promise<boolean>>();

  async function confirmOnce(key: string, context: ToolContext, request: ConfirmRequest): Promise<boolean> {
    const approved = await context.confirm(request);
    if (!approved) refused.add(key);
    return approved;
  }

  async function ask(key: string, context: ToolContext, request: ConfirmRequest): Promise<boolean> {
    const pending = asking.get(key);
    if (pending !== undefined) {
      // A "no" answers every identical call; a "yes" authorises the one call
      // that asked, so this one asks for itself.
      return (await pending) ? await confirmOnce(key, context, request) : false;
    }
    const question = confirmOnce(key, context, request).finally(() => asking.delete(key));
    asking.set(key, question);
    return await question;
  }

  return {
    alreadyDeclined(name, args) {
      return refused.has(callKey(name, args)) ? alreadyRefused(name) : undefined;
    },
    contextFor(name, args, context) {
      const key = callKey(name, args);
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

/** One call's key: the tool it named, and its normalised arguments (see {@link canonicalJson}). */
function callKey(name: string, args: unknown): string {
  return `${name}|${canonicalJson(args)}`;
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
