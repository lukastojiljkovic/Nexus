import { SAFETY_NOTICE } from "../../modules/reader/shared/notice.js";
import { activeLocale } from "./strings.js";

/**
 * The safety notice, drawn wherever a pack's reference content is shown (ADR-100).
 *
 * **Why this file is shared rather than the Reader's own.** The sentence is not
 * about the Reader: it is what this application says about ANY content pack whose
 * manifest carries `notice: "safety"` - survival handbooks today, whatever else
 * later - and a second module that shows one must show the same words. It stands
 * in `renderer/src` for that reason, beside the shell's other shared surfaces.
 *
 * **Why it takes no props.** It is one sentence in the language being read, and
 * nothing about it changes from one call site to the next: a prop here would be a
 * second way to say it. The text comes from `shared/notice.ts` rather than from a
 * copy table, because MAIN prints the same sentence on every sheet and the two
 * must not be able to drift.
 *
 * The class is the shared paragraph tier (`.nx-hint`): the notice is a quiet
 * sentence in the middle of a page, not an alert box, and a louder treatment
 * would need a shared class of its own rather than one invented here.
 */
export function SafetyNotice() {
  return (
    <p className="nx-hint" role="note">
      {activeLocale() === "en" ? SAFETY_NOTICE.en : SAFETY_NOTICE.sr}
    </p>
  );
}
