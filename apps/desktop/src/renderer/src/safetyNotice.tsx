import { strings } from "./strings.js";

/**
 * THE SAFETY DISCLAIMER (ADR-103), as one component and one sentence.
 *
 * A pack whose manifest says `"notice": "safety"` is survival, first-aid,
 * food-preservation or car-emergency reference material, and the decision was
 * that the disclaimer travels with it EVERYWHERE it is read, not only on the
 * card that installed it: the Reader that opens a survival pack's article and
 * the assistant that answers from one both have to be able to say the same
 * sentence, in the same words.
 *
 * That is why this is a component and a `strings` entry rather than prose
 * typed at each call site, and why the two callers this was written for import
 * it instead of copying it: a disclaimer that exists in three slightly
 * different versions is three different claims, and the one that drifts is the
 * one somebody relies on. `safetyNoticeText` exists for a caller that needs the
 * sentence itself — a title attribute, a downloaded page's header — rather than
 * an element.
 *
 * The wording is the founder's, and it covers the four things such a line has
 * to say: what this is, what it is not, what to do about it, and the emergency
 * number. It is deliberately not a translation of an English original: the two
 * languages are the same claim, written in the register of each.
 */
export function SafetyNotice() {
  return (
    <p className="packs__notice" role="note">
      {strings.safety.text}
    </p>
  );
}

/** The sentence the component draws, for a caller that needs the text and not the element. */
export function safetyNoticeText(): string {
  return strings.safety.text;
}
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
