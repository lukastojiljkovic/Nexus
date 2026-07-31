/**
 * The one piece of NOTE-011's three container blocks that two packages must
 * never disagree about: the callout's closed `variant` vocabulary.
 *
 * The renderer's `Callout` node WRITES the attribute into the Yjs document;
 * `imex/noteMarkdown.ts` READS it back out to pick the `::: <variant>` fence
 * it exports. Open-coding the list twice is exactly how a fifth variant added
 * in the editor would silently export as the neutral default forever — the
 * same drift `parseCardBlock` exists to prevent for flashcard syntax
 * (ADR-017), applied to the one attribute these blocks store.
 *
 * The ids are English, like every other value this codebase persists: they are
 * document data and Markdown syntax, not user-facing copy. Their Serbian
 * labels („Napomena", „Savet", „Upozorenje", „Opasnost") live in the
 * renderer's `strings.ts` like every other label.
 *
 * The toggle and the table of contents need no such contract: the toggle
 * stores only a boolean the export deliberately drops, and the table of
 * contents stores nothing at all.
 */

/**
 * Every variant a callout may carry, in menu order — four semantically
 * distinct notes rather than a palette: a neutral aside, a tip, a warning and
 * a danger. Deliberately closed: a callout whose stored variant is anything
 * else is not a new kind of callout, it is a corrupt one, and reads as `info`.
 */
export const CALLOUT_VARIANTS = ["info", "tip", "warning", "danger"] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

/** The variant a callout falls back to — the quietest one, so a broken attribute never shouts. */
export const DEFAULT_CALLOUT_VARIANT: CalloutVariant = "info";

export function isCalloutVariant(value: unknown): value is CalloutVariant {
  return typeof value === "string" && CALLOUT_VARIANTS.some((variant) => variant === value);
}

/** Any stored/parsed value as a real variant: unknown, missing or non-string all become `DEFAULT_CALLOUT_VARIANT`. */
export function normalizeCalloutVariant(value: unknown): CalloutVariant {
  return isCalloutVariant(value) ? value : DEFAULT_CALLOUT_VARIANT;
}
