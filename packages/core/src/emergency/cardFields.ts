/**
 * The emergency card's own vocabulary and bounds (EMERGENCY, migration 078).
 *
 * **The card exists for the ten minutes somebody else has to act on it.** A
 * paramedic, a stranger who found the phone, a hospital admissions desk: none of
 * them knows this person, none of them can open the app, and all of them read the
 * page once. That is why this module stores so little and refuses so much - every
 * value here is either something a doctor can act on or something that makes the
 * card harder to read at a glance.
 *
 * **Nothing here is a medical judgement.** The card records what the user says
 * about themselves. It never computes a dose (a medication carries the user's own
 * free text for how it is taken, and there is deliberately no field for a
 * quantity), it never ranks an allergy above another by anything but the
 * severity word the user chose, and it never fills a blank in. An empty field on
 * a printed emergency card is honest; a guessed one is dangerous.
 *
 * **The distinction the whole module turns on: unanswered, versus answered with
 * nothing.** `null` means the user has not said. An EMPTY LIST means the user
 * said there are none - and that is a real answer, which is why it is legal and
 * why it travels as itself rather than collapsing into `null`. A doctor reading
 * a card that is silent about allergies learns nothing; one reading "no known
 * allergies" learns something. The same pair exists for the blood type, where
 * `"unknown"` is the user's answer and `null` is the absence of one.
 *
 * **The vocabularies live here rather than in the store** because three surfaces
 * have to agree on them: the store (which revalidates everything main hands it),
 * main's IPC validators in stage 2 (SEC-EL-02), and the renderer. One definition,
 * or the wire and the store quietly disagree about what a severity is - the
 * reason `@nexus/db` already exports FIN's money predicates.
 *
 * **Every bound here is about the page, not about the domain.** An emergency card
 * is ONE sheet under a fridge magnet, so a name or a contact is a line, a note is
 * a short paragraph, and a list is a handful of items. The caps are generous
 * enough that no honest card meets them and low enough that a pasted document or
 * a runaway import cannot be written into a page nobody can print.
 */

/** The eight ABO/Rh groups, in the order to offer them. */
export const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/**
 * The ninth answer, and a distinct one: the user does not know their group. Kept
 * apart from `null` because the two print differently - "unknown" is a fact about
 * the user, and a blank prompts them to go and find out.
 */
export const BLOOD_TYPE_UNKNOWN = "unknown";
export type CardBloodType = BloodType | typeof BLOOD_TYPE_UNKNOWN;

/** How bad a reaction is, in the user's words. The card prints the word; it never
 *  upgrades or downgrades it. */
export const ALLERGY_SEVERITIES = ["mild", "severe", "anaphylaxis"] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

/** The organ-donor answer, or `null` for a user who has not stated one. */
export const ORGAN_DONOR_CHOICES = ["yes", "no"] as const;
export type OrganDonor = (typeof ORGAN_DONOR_CHOICES)[number];

/** The languages the card prints in. `both` is a page in two heading languages. */
export const CARD_LANGUAGES = ["sr", "en"] as const;
export type CardLanguage = (typeof CARD_LANGUAGES)[number];
export type CardPrintLanguage = CardLanguage | "both";

/**
 * How a card prints one of its documents. The user's choice, carried verbatim:
 * the number alone, or the number together with the document's own image.
 */
export const CARD_DOCUMENT_MODES = ["number", "number_image"] as const;
export type CardDocumentMode = (typeof CARD_DOCUMENT_MODES)[number];

export const MAX_CARD_FULL_NAME_LENGTH = 120;
export const MAX_CARD_INSURANCE_NUMBER_LENGTH = 60;
export const MAX_CARD_DOCTOR_NAME_LENGTH = 120;
/** An international number with its separators and an extension still fits. */
export const MAX_CARD_PHONE_LENGTH = 40;
export const MAX_CARD_NOTES_LENGTH = 2000;
export const MAX_CARD_CONTACT_NAME_LENGTH = 120;
export const MAX_CARD_CONTACT_RELATION_LENGTH = 60;
export const MAX_CARD_ALLERGY_LABEL_LENGTH = 120;
export const MAX_CARD_CONDITION_LENGTH = 200;
export const MAX_CARD_MEDICATION_NAME_LENGTH = 120;
export const MAX_CARD_MEDICATION_DOSE_LENGTH = 200;
/** The cap on each of the three JSON lists: allergies, conditions and medications. */
export const MAX_CARD_LIST_ITEMS = 100;
export const MAX_CARD_CONTACTS = 50;
export const MAX_CARD_DOCUMENTS = 50;

/** One allergy with the severity the user gave it, or `null` for one they did not. */
export interface CardAllergy {
  readonly label: string;
  readonly severity: AllergySeverity | null;
}

/** One medication: its name, and the user's own free text for how it is taken. */
export interface CardMedication {
  readonly name: string;
  readonly dose: string | null;
}

export function isBloodType(value: unknown): value is CardBloodType {
  return value === BLOOD_TYPE_UNKNOWN || (BLOOD_TYPES as readonly unknown[]).includes(value);
}

export function isAllergySeverity(value: unknown): value is AllergySeverity {
  return (ALLERGY_SEVERITIES as readonly unknown[]).includes(value);
}

export function isOrganDonor(value: unknown): value is OrganDonor {
  return (ORGAN_DONOR_CHOICES as readonly unknown[]).includes(value);
}

export function isCardLanguage(value: unknown): value is CardLanguage {
  return (CARD_LANGUAGES as readonly unknown[]).includes(value);
}

export function isCardPrintLanguage(value: unknown): value is CardPrintLanguage {
  return value === "both" || isCardLanguage(value);
}

export function isCardDocumentMode(value: unknown): value is CardDocumentMode {
  return (CARD_DOCUMENT_MODES as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exactly these own keys, no more and no fewer - `habitSchedule.ts`'s rule: a
 * value carrying a key this module never wrote did not come from this module, and
 * quietly dropping the extra would hide a caller that has a different idea of
 * what an allergy is.
 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** A trimmed, non-blank string within its bound, or `null` for anything else. */
function trimmedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Structural validation of the `allergies` column or any untrusted list, into the
 * CANONICAL list - `validateHabitSchedule`'s contract, restated: labels are
 * trimmed, so two spellings of one list are one stored value. The ORDER is the
 * user's and is never touched; an empty array is a valid list and means "none".
 *
 * The column's own `null` (unanswered) never reaches this function - the store
 * decides that before it calls, because "no list at all" and "a list that is
 * empty" are different answers and only one of them is a list.
 */
export function validateCardAllergies(value: unknown): CardAllergy[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_LIST_ITEMS) return null;
  const allergies: CardAllergy[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isRecord(item) || !hasExactKeys(item, ["label", "severity"])) return null;
    const label = trimmedText(item["label"], MAX_CARD_ALLERGY_LABEL_LENGTH);
    if (label === null) return null;
    let severity: AllergySeverity | null = null;
    if (item["severity"] !== null) {
      if (!isAllergySeverity(item["severity"])) return null;
      severity = item["severity"];
    }
    allergies.push({ label, severity });
  }
  return allergies;
}

/** The canonical text of an allergies list - what the column holds. */
export function serializeCardAllergies(allergies: readonly CardAllergy[]): string {
  return JSON.stringify(
    allergies.map((allergy) => ({ label: allergy.label, severity: allergy.severity })),
  );
}

/** Structural validation of the `conditions` column or any untrusted list, in the user's order. */
export function validateCardConditions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_LIST_ITEMS) return null;
  const conditions: string[] = [];
  for (const item of value as readonly unknown[]) {
    const text = trimmedText(item, MAX_CARD_CONDITION_LENGTH);
    if (text === null) return null;
    conditions.push(text);
  }
  return conditions;
}

/** The canonical text of a conditions list. */
export function serializeCardConditions(conditions: readonly string[]): string {
  return JSON.stringify([...conditions]);
}

/**
 * Structural validation of the `medications` column or any untrusted list. A
 * blank dose collapses to `null` - the user typed nothing, so nothing is stored -
 * while a blank NAME is refused, because a medication with no name is a row that
 * prints as an empty line.
 */
export function validateCardMedications(value: unknown): CardMedication[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_LIST_ITEMS) return null;
  const medications: CardMedication[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isRecord(item) || !hasExactKeys(item, ["name", "dose"])) return null;
    const name = trimmedText(item["name"], MAX_CARD_MEDICATION_NAME_LENGTH);
    if (name === null) return null;
    let dose: string | null = null;
    const raw = item["dose"];
    if (raw !== null) {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (trimmed.length > MAX_CARD_MEDICATION_DOSE_LENGTH) return null;
      dose = trimmed.length === 0 ? null : trimmed;
    }
    medications.push({ name, dose });
  }
  return medications;
}

/** The canonical text of a medications list. */
export function serializeCardMedications(medications: readonly CardMedication[]): string {
  return JSON.stringify(medications.map((item) => ({ name: item.name, dose: item.dose })));
}
