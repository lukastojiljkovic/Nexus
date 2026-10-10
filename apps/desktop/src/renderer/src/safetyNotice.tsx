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
