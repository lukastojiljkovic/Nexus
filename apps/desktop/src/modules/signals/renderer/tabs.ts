import type { SignalsPrefs } from "./prefs.js";

/**
 * What a tab that draws one of the module's three preferences is handed.
 *
 * Declared once, here, because the two tabs that need it (Morse and the tuner)
 * would otherwise each declare it — and a props type that lives in `Page.tsx`
 * would make both of them import the file that imports them.
 */
export interface TabProps {
  /** The live preferences, read once by the page. */
  readonly prefs: SignalsPrefs;
  /** The page's one writer of them. */
  readonly onChange: (patch: Partial<SignalsPrefs>) => void;
}
