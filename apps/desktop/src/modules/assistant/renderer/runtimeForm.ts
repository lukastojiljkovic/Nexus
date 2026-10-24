import type { AssistantRuntimeOptionsView, AssistantRuntimeView } from "../shared/ipc.js";

/**
 * THE RUNTIME FORM'S RULES: how a typed number becomes a value main accepts, and
 * when the form differs from what is saved. Pure, so the card only draws what
 * these return.
 *
 * **Why the form keeps text.** A field is edited as the user types it, so a
 * half-typed `0.` or an empty box must be representable; the value is parsed
 * only when it is checked. An empty model value means the model's own value, and
 * an empty idle time is not a value at all.
 */

/** The five values a model is sampled with. A `null` is the model's own value. */
export const MODEL_VALUE_KEYS = ["contextTokens", "temperature", "topP", "topK", "repeatPenalty"] as const;

/** Every number the form edits: the model values, then the minutes before a model is unloaded. */
export const NUMBER_KEYS = [...MODEL_VALUE_KEYS, "idleUnloadMinutes"] as const;

export type NumberKey = (typeof NUMBER_KEYS)[number];

export type RuntimeLimits = AssistantRuntimeView["limits"];

/** Why a typed value was refused. The page says it in words, on the field that holds it. */
export type FieldProblem = "not-a-number" | "not-whole" | "out-of-range";

/** The form as it is edited: each number as typed, and the checkbox. */
export type RuntimeDraft = Readonly<Record<NumberKey, string>> & { readonly autoCompact: boolean };

export type FieldParse =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly problem: FieldProblem };

/** A plain decimal, with an optional minus; a comma is the Serbian decimal mark. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * One typed field against its limit. An empty model value is `null`; an empty idle
 * time is refused, because main stores a number there.
 */
export function parseField(key: NumberKey, text: string, limit: RuntimeLimits[NumberKey]): FieldParse {
  const trimmed = text.trim();
  if (trimmed === "") {
    return key === "idleUnloadMinutes" ? { ok: false, problem: "not-a-number" } : { ok: true, value: null };
  }
  const normalized = trimmed.replace(",", ".");
  if (!DECIMAL.test(normalized)) return { ok: false, problem: "not-a-number" };
  const value = Number(normalized);
  if (limit.integer && !Number.isInteger(value)) return { ok: false, problem: "not-whole" };
  if (value < limit.min || value > limit.max) return { ok: false, problem: "out-of-range" };
  return { ok: true, value };
}

export interface DraftCheck {
  /** The options to send, or `null` while any field is refused. */
  readonly options: AssistantRuntimeOptionsView | null;
  readonly problems: Partial<Record<NumberKey, FieldProblem>>;
}

/** Checks every field of the form. Nothing is sent unless every field is valid. */
export function checkDraft(draft: RuntimeDraft, limits: RuntimeLimits): DraftCheck {
  const problems: Partial<Record<NumberKey, FieldProblem>> = {};
  const values = {} as Record<NumberKey, number | null>;
  for (const key of NUMBER_KEYS) {
    const parsed = parseField(key, draft[key], limits[key]);
    if (parsed.ok) values[key] = parsed.value;
    else problems[key] = parsed.problem;
  }
  if (Object.keys(problems).length > 0) return { options: null, problems };
  return {
    options: { ...values, autoCompact: draft.autoCompact } as AssistantRuntimeOptionsView,
    problems,
  };
}

/** The form as the saved options read in it. */
export function draftFrom(options: AssistantRuntimeOptionsView): RuntimeDraft {
  const text = (value: number | null) => (value === null ? "" : String(value));
  return {
    contextTokens: text(options.contextTokens),
    temperature: text(options.temperature),
    topP: text(options.topP),
    topK: text(options.topK),
    repeatPenalty: text(options.repeatPenalty),
    idleUnloadMinutes: String(options.idleUnloadMinutes),
    autoCompact: options.autoCompact,
  };
}

/** The same form with the five model values cleared, so each is the model's own. Everything else is kept. */
export function withModelDefaults(draft: RuntimeDraft): RuntimeDraft {
  return { ...draft, contextTokens: "", temperature: "", topP: "", topK: "", repeatPenalty: "" };
}

/** Whether checked options differ from the saved ones in any field. */
export function isChanged(options: AssistantRuntimeOptionsView, saved: AssistantRuntimeOptionsView): boolean {
  return (Object.keys(saved) as (keyof AssistantRuntimeOptionsView)[]).some(
    (key) => options[key] !== saved[key],
  );
}
