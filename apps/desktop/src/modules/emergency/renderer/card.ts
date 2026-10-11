import { ALLERGY_SEVERITIES, MAX_CARD_FULL_NAME_LENGTH } from "@nexus/core";
import type {
  AllergySeverity,
  CardBloodType,
  CardPrintLanguage,
  OrganDonor,
} from "@nexus/core";
import type {
  CardFieldsPayload,
  EmergencyApi,
  EmergencyCardView,
  EmergencyContactView,
  EmergencyPersonView,
  EmergencyView,
} from "../shared/ipc.js";

/**
 * The card form's drafts and the arithmetic over them, as pure functions.
 *
 * **Why a draft is strings and not values.** A half-typed date of birth is not a
 * date, and a number field that held a `number` would have to choose something to
 * hold between the digits. So every field of `CardForm` is the TEXT of what the
 * user has typed, and exactly one function turns that into the card's own values
 * (`cardFieldsOf`) - which is where blanks become `null` and where the difference
 * between "not answered" and "answered with nothing" is made explicit, because
 * only the form knows which of the two the user meant (the two ticks).
 *
 * **Why the date check is here and not in the store.** The store owns whether a
 * stored day is real and not in the future - and its refusal would cross IPC as a
 * sentence about a column. This file answers the same question at the desk, where
 * the answer can be said under the field the user is looking at, and the store
 * stays the authority rather than a second opinion (the house's `habitErrorMessage`
 * pattern, one layer earlier).
 */

/** One allergy being edited: the label as typed, and the severity the user picked or none. */
export interface AllergyDraft {
  readonly label: string;
  readonly severity: AllergySeverity | null;
}

/** One medication being edited: its name, and the user's own free text for how it is taken. */
export interface MedicationDraft {
  readonly name: string;
  readonly dose: string;
}

/**
 * The whole form as the user is typing it.
 *
 * The three `...Answered` ticks are the form's half of the module's central
 * distinction: a tick means "there are none", no tick and no rows means "I have
 * not answered this", and rows mean the list itself. `cardFieldsOf` is the one
 * place that pair is read.
 */
export interface CardForm {
  readonly fullName: string;
  readonly dateOfBirth: string;
  /** `""` is not answered; otherwise a blood type or `"unknown"`. */
  readonly bloodType: string;
  readonly allergiesAnswered: boolean;
  readonly allergies: readonly AllergyDraft[];
  readonly conditionsAnswered: boolean;
  readonly conditions: readonly string[];
  readonly medicationsAnswered: boolean;
  readonly medications: readonly MedicationDraft[];
  /** `""` is not answered; otherwise `"yes"` or `"no"`. */
  readonly organDonor: string;
  readonly healthInsuranceNumber: string;
  readonly doctorName: string;
  readonly doctorPhone: string;
  readonly notes: string;
  readonly printLanguage: CardPrintLanguage;
}

/** The empty form: a profile that has never made a card, and the page's first action's starting point. */
export function emptyCardForm(): CardForm {
  return {
    fullName: "",
    dateOfBirth: "",
    bloodType: "",
    allergiesAnswered: false,
    allergies: [],
    conditionsAnswered: false,
    conditions: [],
    medicationsAnswered: false,
    medications: [],
    organDonor: "",
    healthInsuranceNumber: "",
    doctorName: "",
    doctorPhone: "",
    notes: "",
    // Serbian, which is the default locale and the module's own default column
    // (`migration 078`: `print_language TEXT NOT NULL DEFAULT 'sr'`).
    printLanguage: "sr",
  };
}

/** A stored card as the form that edits it: every value back to the text it was typed as. */
export function cardFormOf(card: EmergencyCardView): CardForm {
  return {
    fullName: card.fullName ?? "",
    dateOfBirth: card.dateOfBirth ?? "",
    bloodType: card.bloodType ?? "",
    // An empty stored list was an ANSWER, so the tick comes back on; a stored
    // `null` was the absence of one, so nothing does.
    allergiesAnswered: card.allergies !== null,
    allergies: (card.allergies ?? []).map((allergy) => ({
      label: allergy.label,
      severity: allergy.severity,
    })),
    conditionsAnswered: card.conditions !== null,
    conditions: [...(card.conditions ?? [])],
    medicationsAnswered: card.medications !== null,
    medications: (card.medications ?? []).map((medication) => ({
      name: medication.name,
      dose: medication.dose ?? "",
    })),
    organDonor: card.organDonor ?? "",
    healthInsuranceNumber: card.healthInsuranceNumber ?? "",
    doctorName: card.doctorName ?? "",
    doctorPhone: card.doctorPhone ?? "",
    notes: card.notes ?? "",
    printLanguage: card.printLanguage,
  };
}

/**
 * The form as the card's own fields. The ONE place a draft becomes a value.
 *
 * Blanks become `null` - the store trims and does the same, so the wire refuses
 * nothing the user could reasonably have typed. A list is a list when it holds
 * anything; when it holds nothing the ANSWER decides, which is the whole reason
 * the two ticks exist.
 */
export function cardFieldsOf(form: CardForm): CardFieldsPayload {
  const allergies = form.allergies
    .map((allergy) => ({ label: allergy.label.trim(), severity: allergy.severity }))
    .filter((allergy) => allergy.label.length > 0);
  const conditions = form.conditions
    .map((condition) => condition.trim())
    .filter((condition) => condition.length > 0);
  const medications = form.medications
    .map((medication) => ({ name: medication.name.trim(), dose: medication.dose.trim() }))
    .filter((medication) => medication.name.length > 0)
    .map((medication) => ({ name: medication.name, dose: medication.dose.length === 0 ? null : medication.dose }));
  return {
    fullName: blankToNull(form.fullName),
    dateOfBirth: blankToNull(form.dateOfBirth),
    bloodType: form.bloodType === "" ? null : (form.bloodType as CardBloodType),
    allergies: allergies.length > 0 ? allergies : form.allergiesAnswered ? [] : null,
    conditions: conditions.length > 0 ? conditions : form.conditionsAnswered ? [] : null,
    medications: medications.length > 0 ? medications : form.medicationsAnswered ? [] : null,
    organDonor: form.organDonor === "" ? null : (form.organDonor as OrganDonor),
    healthInsuranceNumber: blankToNull(form.healthInsuranceNumber),
    doctorName: blankToNull(form.doctorName),
    doctorPhone: blankToNull(form.doctorPhone),
    notes: blankToNull(form.notes),
    printLanguage: form.printLanguage,
  };
}

/**
 * What the form cannot save, as the name of the field to complain under, or
 * `null` when it can. Two checks and no third: everything else the store would
 * refuse, it refuses with a sentence of its own.
 */
export function cardFormProblem(form: CardForm, today: string): "fullName" | "dateOfBirth" | null {
  if (form.fullName.trim().length > MAX_CARD_FULL_NAME_LENGTH) return "fullName";
  const day = form.dateOfBirth.trim();
  if (day.length === 0) return null;
  if (!isBareDay(day)) return "dateOfBirth";
  // A birth date in the future is the typo the store refuses too; comparing the
  // string is enough because both are bare `YYYY-MM-DD` days.
  return day > today ? "dateOfBirth" : null;
}

/**
 * The neighbours a moved contact has to land between, or `null` when it is
 * already at that end of the list.
 *
 * **This is the one piece of arithmetic in the page, and it is the store's
 * contract spelled out.** `moveContact(id, beforeId, afterId)` takes the row that
 * will sit immediately ABOVE the moved one and the row immediately BELOW it
 * (`rankBetween`'s own wording), so moving UP means landing under the row two
 * places up and above the row one place up. Both ids are always live siblings -
 * which is why the caller passes ids and not positions.
 */
export function moveNeighbours(
  ids: readonly string[],
  index: number,
  direction: "up" | "down",
): { readonly beforeId: string | null; readonly afterId: string | null } | null {
  if (direction === "up") {
    if (index <= 0) return null;
    return { beforeId: ids[index - 2] ?? null, afterId: ids[index - 1] ?? null };
  }
  if (index >= ids.length - 1) return null;
  return { beforeId: ids[index + 1] ?? null, afterId: ids[index + 2] ?? null };
}

/** Today's date as the bare day key a bare date column holds, from the DEVICE's own calendar rather than UTC. */
export function todayKey(at: Date): string {
  const year = String(at.getFullYear()).padStart(4, "0");
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The form's starting rows: one blank row of the kind the button adds. */
export function blankAllergy(): AllergyDraft {
  return { label: "", severity: null };
}

export function blankMedication(): MedicationDraft {
  return { name: "", dose: "" };
}

/**
 * The name a contact row shows in the editor.
 *
 * A contact carries EITHER its own text OR a reference to a person of the People
 * module, and the live name is the only name a linked contact has - so the
 * reference is resolved here, against the same library the card model resolves it
 * against. `null` is the DANGLING reference: the person is gone from the address
 * book, and the row says so rather than showing an empty line (`cardModel.ts`).
 */
export function contactName(
  contact: EmergencyContactView,
  people: readonly EmergencyPersonView[],
): string | null {
  if (contact.personId === null) return contact.name;
  return people.find((person) => person.id === contact.personId)?.name ?? null;
}

/** The severities in the order the form offers them, with `null` first as "not stated". */
export const SEVERITY_CHOICES: readonly (AllergySeverity | null)[] = [null, ...ALLERGY_SEVERITIES];

/**
 * One mutation, as the page runs it: main answers with the whole view and the
 * page is what stores it. Typed against the CONTRACT rather than against
 * `window.nexus`, so the same alias serves the page and the contact editor and
 * neither of them has to reach for a global to spell a type.
 */
export type EmergencyRun = (
  action: (api: EmergencyApi) => Promise<EmergencyView>,
) => Promise<void>;

/**
 * Whether a string is a real `YYYY-MM-DD` day.
 *
 * A calendar check and not a pattern: `2026-02-30` matches the shape and is not a
 * day, and a birth date is the one field on this form whose typo a doctor would
 * read as fact. Leap years are checked the way the calendar does it, so the
 * 29th of February survives in the years that have one.
 */
export function isBareDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return year >= 1;
}

/** How many days one month of one year has. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The value a nullable column takes for a field the user left blank. Shared, because the contact form writes the same three columns. */
export function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

