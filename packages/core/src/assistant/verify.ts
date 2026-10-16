/**
 * What the answer says, against what the turn did.
 *
 * A 2-5B model does not only get facts wrong; it says it DID things. The
 * baseline's `field-task-create-fails-en` is the shape: the write was refused,
 * and the answer came back as "I've added the task". Nothing in the running app
 * compared the two - only the evals, after the fact - so the user was told a
 * task existed that no store had ever seen.
 *
 * **What this checks, and what it deliberately does not.** Three findings, each
 * decidable from the turn's own events: a completion claim in a turn where no
 * write succeeded, an answer in the wrong language, and a Serbian answer in the
 * other script. A finding is a sentence a reader can check, not a score. What
 * this cannot see is named where the check is: an invented NUMBER, a citation
 * marker pointing at nothing, and a claim about a READ (`I searched`) are all
 * left alone, because a list that guesses at them would fail honest answers.
 * Number and marker checking belongs to `citations.ts` and the tool registry,
 * which know what a source is; the brief fixes only the three below.
 *
 * **The phrase list is shared with the evals.** `claimsCompletion` was the
 * evals' own reading of an answer; {@link COMPLETION_MARKERS} is now the one
 * list behind both, so a scenario that fails for a claim and a turn that
 * corrects one are talking about the same words.
 *
 * Nothing here throws and nothing here is a policy about the MODEL: the loop
 * decides what to do with a finding (`loop.ts`), and this module only says what
 * is true of the answer it was handed.
 */

import type { Citation, ToolEffect, ToolResult } from "./contract.js";
import { detectAnswerLanguage, detectAnswerScript, fold } from "./language.js";
import type { ReplyLanguage } from "./language.js";

/**
 * One thing the answer says that the turn does not bear out.
 *
 * `detail` is written for the APP's log and for a test to name; it is never the
 * text shown to the user, because what is shown is what the loop asks the model
 * to write instead.
 */
export interface VerificationFinding {
  readonly kind: "completion-claim" | "language" | "script";
  readonly detail: string;
}

/**
 * One thing a tool the turn ran came back with, and what that tool does to the
 * world. The effect rides beside the result because a read that succeeded does
 * not license the sentence "I saved it" (`contract.ts` owns the vocabulary).
 */
export interface VerifiedCall {
  readonly name: string;
  readonly effect: ToolEffect;
  readonly result: ToolResult;
}

export interface VerifyAnswerInput {
  /** The model's own text, before any transliteration the loop applies. */
  readonly answer: string;
  /** Every call the turn RAN, in the order the model asked for them. */
  readonly results: readonly VerifiedCall[];
  /** The sources the answer may be shown with. Carried so a later check that needs them does not change this signature. */
  readonly citations: readonly Citation[];
  /** The language and script the loop decided for this reply (`language.ts`). */
  readonly reply: ReplyLanguage;
}

/**
 * The phrases an answer uses to say a write happened.
 *
 * FOLDED, because that is how both readers prepare the text: lower case, `đ`
 * to `dj`, the combining marks stripped. First-person perfects and the passive
 * `added is` shapes, in Serbian and in English, and deliberately NOT a bare
 * participle: the sentence this exists to catch sits beside a refusal, and
 * `dodat` alone is inside `nije dodat` - a sentence that is telling the truth.
 */
export const COMPLETION_MARKERS: readonly string[] = [
  "dodao sam",
  "dodala sam",
  "dodat je",
  "dodata je",
  "dodati su",
  "kreirao sam",
  "kreirala sam",
  "kreiran je",
  "napravio sam",
  "napravila sam",
  "napravljen je",
  "zapisao sam",
  "zapisala sam",
  "zabelezio sam",
  "zabelezila sam",
  "sacuvao sam",
  "zakazao sam",
  "zakazala sam",
  "zakazan je",
  "upisao sam",
  "upisala sam",
  "obrisao sam",
  "obrisala sam",
  "i added",
  "i've added",
  "i have added",
  "added the task",
  "added the note",
  "added it",
  "i created",
  "i've created",
  "i have created",
  "created the task",
  "created the note",
  "i scheduled",
  "i've scheduled",
  "i booked",
  "i saved",
  "i've saved",
  "i logged",
  "i've logged",
  "i recorded",
  "i've recorded",
  "i wrote it",
  "i've written",
  "i stored",
  "i've stored",
  "i deleted",
  "i've deleted",
  "i searched",
  "i've searched",
  "pretrazio sam",
  "pretrazila sam",
];

/**
 * Whether an answer claims that something was done.
 *
 * The caller decides WHEN that matters: a claim is only a finding when the turn
 * has a write that did not succeed ({@link verifyAnswer}), because "I added the
 * note" beside a note that WAS added is a correct answer.
 */
export function claimsCompletion(text: string): boolean {
  const folded = fold(text);
  return COMPLETION_MARKERS.some((marker) => folded.includes(marker));
}

/**
 * Everything sound in the answer, as a list of what is not.
 *
 * Ordered by how badly each misleads a reader: a claim of a write that never
 * happened, then the language, then the script.
 */
export function verifyAnswer(input: VerifyAnswerInput): readonly VerificationFinding[] {
  const findings: VerificationFinding[] = [];
  if (claimsCompletion(input.answer) && !wroteSomething(input.results)) {
    findings.push({
      kind: "completion-claim",
      detail: "the answer says something was created, saved, changed or started, and no write ran",
    });
  }
  const language = detectAnswerLanguage(input.answer);
  if (language !== "undetermined" && language !== input.reply.language) {
    findings.push({
      kind: "language",
      detail: `the answer is written in ${language}, and this turn's reply is ${input.reply.language}`,
    });
  }
  const script = detectAnswerScript(input.answer);
  if (script !== input.reply.script) {
    findings.push({
      kind: "script",
      detail: `the answer is written in ${script}, and this turn's reply is ${input.reply.script}`,
    });
  }
  return findings;
}

/** Whether any call that changes the world came back saying it worked. */
function wroteSomething(results: readonly VerifiedCall[]): boolean {
  return results.some(
    (call) => call.effect === "write" && call.result.ok,
  );
}
