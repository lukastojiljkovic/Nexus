/**
 * The LLM import's device preferences (IMEX-005), stored in `localStorage` on
 * the `calendarPrefs.ts` recipe: a closed value set, a safe fallback for
 * anything unrecognized, and no IPC — they describe what THIS machine last
 * imported and in which language it asks, not what the profile contains.
 *
 * Two of them, the block's two pickers: which KIND the next prompt is about,
 * and which LANGUAGE it is written in. Both persisted so the flow's natural
 * rhythm — generate, chat, paste, again next week — does not reopen on
 * „Zadatke / Srpski" for someone who always imports kartice in English.
 *
 * The defaults are the pickers' own first options (`LLM_IMPORT_KINDS` and
 * `LLM_PROMPT_LANGUAGES` lead with them), so a device that never stored either
 * key behaves exactly as the block always has.
 */

import {
  LLM_IMPORT_KINDS,
  LLM_PROMPT_LANGUAGES,
  type LlmImportKind,
  type LlmPromptLanguage,
} from "../../shared/ipc.js";

const KIND_KEY = "nexus.llmImport.kind";
const LANGUAGE_KEY = "nexus.llmImport.language";

const DEFAULT_KIND: LlmImportKind = "tasks";
const DEFAULT_LANGUAGE: LlmPromptLanguage = "sr";

export function readStoredLlmImportKind(): LlmImportKind {
  const stored = localStorage.getItem(KIND_KEY);
  return LLM_IMPORT_KINDS.find((kind) => kind === stored) ?? DEFAULT_KIND;
}

export function persistLlmImportKind(kind: LlmImportKind): void {
  localStorage.setItem(KIND_KEY, kind);
}

export function readStoredLlmPromptLanguage(): LlmPromptLanguage {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  return LLM_PROMPT_LANGUAGES.find((language) => language === stored) ?? DEFAULT_LANGUAGE;
}

export function persistLlmPromptLanguage(language: LlmPromptLanguage): void {
  localStorage.setItem(LANGUAGE_KEY, language);
}

/**
 * Forgets both keys, so the next read is the module's own default again. No
 * card offers this yet — „Rezervna kopija" has no reset link, deliberately —
 * but every preference module ships its own clear so a future reset surface
 * enumerates functions rather than guessing at keys.
 */
export function clearStoredLlmImportPreferences(): void {
  localStorage.removeItem(KIND_KEY);
  localStorage.removeItem(LANGUAGE_KEY);
}
