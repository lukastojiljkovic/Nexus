import type { ModulePageIntent } from "../../../../shared/moduleApi.js";
import { TRANSLATOR_TEXT_MAX_CHARS } from "../../shared/ipc.js";
import { languageByCode } from "../../shared/languages.js";

/** A translation the assistant asked the page for: the text, and the two NLLB codes it names (`auto` as a source leaves the language to detection). */
export interface TranslateRequest {
  readonly text: string;
  readonly from: string;
  readonly to: string;
}

/** A stored or sent value that is an NLLB code the table carries, or `null` for anything else. */
function codeOf(value: unknown): string | null {
  return typeof value === "string" && languageByCode(value) !== undefined ? value : null;
}

/**
 * The page's own reading of the assistant's `translate` action, or `null` for
 * any other intent and for a payload the page does not accept.
 *
 * The payload travelled through a window event, so it is validated again here:
 * the text against the same cap the page enforces, and each language as a code
 * the table carries.
 */
export function translateRequestOf(intent: ModulePageIntent | null | undefined): TranslateRequest | null {
  if (intent?.kind !== "action" || intent.action !== "translate") return null;
  const payload = intent.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const { text, from, to } = payload as Record<string, unknown>;
  if (typeof text !== "string" || text.trim() === "" || text.length > TRANSLATOR_TEXT_MAX_CHARS) return null;
  const source = from === "auto" ? "auto" : codeOf(from);
  const target = codeOf(to);
  if (source === null || target === null) return null;
  return { text, from: source, to: target };
}
