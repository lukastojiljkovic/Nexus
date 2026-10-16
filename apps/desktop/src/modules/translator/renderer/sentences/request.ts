import type { ModulePageIntent } from "../../../../shared/moduleApi.js";
import { TRANSLATOR_TEXT_MAX_CHARS } from "../../shared/ipc.js";
import { DIRECTIONS, type Direction } from "./models.js";

/** A sentence translation the assistant asked the page for: the text, and the direction it names. */
export interface SentenceRequest {
  readonly text: string;
  readonly direction: Direction;
}

/**
 * The page's own reading of the assistant's `translate` action, or `null` for
 * any other intent and for a payload the page does not accept.
 *
 * The payload is the tool's `{ text, from, to }`, and it is validated here again:
 * it travelled through a window event, and a direction is only a direction when
 * it is one this module has a pack for.
 */
export function sentenceRequestOf(intent: ModulePageIntent | null | undefined): SentenceRequest | null {
  if (intent?.kind !== "action" || intent.action !== "translate") return null;
  const payload = intent.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const { text, from, to } = payload as Record<string, unknown>;
  if (typeof text !== "string" || text.trim() === "" || text.length > TRANSLATOR_TEXT_MAX_CHARS) return null;
  const direction = DIRECTIONS.find((each) => each === `${String(from)}-${String(to)}`);
  if (direction === undefined) return null;
  return { text, direction };
}
