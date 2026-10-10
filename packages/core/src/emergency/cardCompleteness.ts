/**
 * What the card still has to be told before it is worth printing - the three
 * questions stage 2 asks, and the reason the module can tell "unanswered" from
 * "answered with nothing" at all.
 *
 * **Only three, and that is the whole point.** A card is complete when a doctor
 * can act on it: a blood type, at least one person to call, and the allergies
 * question answered one way or the other. Everything else on the card - the
 * doctor's name, the insurance number, the notes - makes the page better and
 * makes it no less usable, so none of them may hold a Save button hostage. A
 * completeness list that grows is a form that never feels finished.
 *
 * **An empty answer counts as an answer.** `allergies: []` is the user saying
 * there are none and is COMPLETE; `allergies: null` is the open question. The
 * same holds for a blood type of `"unknown"`: prompting somebody for a fact they
 * have already told you they do not know is how a prompt teaches people to
 * dismiss prompts.
 */

import type { EmergencyCardWithContacts } from "./cardModel.js";

/** A recommended field the card has not answered yet. */
export type CardGap = "bloodType" | "allergies" | "contacts";

/**
 * The unanswered recommended fields, in the order the card prints them - so stage
 * 2 can walk the list and its prompts arrive in the same order as the page they
 * are about. Empty means the card asks for nothing.
 */
export function cardCompleteness(card: EmergencyCardWithContacts): CardGap[] {
  const gaps: CardGap[] = [];
  if (card.bloodType === null) gaps.push("bloodType");
  if (card.allergies === null) gaps.push("allergies");
  if (card.contacts.length === 0) gaps.push("contacts");
  return gaps;
}
