import type { CardLanguage } from "@nexus/core";

/**
 * THE emergency card's own words, in both languages at once.
 *
 * **Why this is not `renderer/copy.sr.ts`.** A copy table in a kit module is
 * rewritten in place by the locale switch: it holds the words of the interface,
 * in the language the interface is being read in. The card is the opposite
 * thing. Its `printLanguage` decides which languages print at all, and a card
 * that prints in both prints them TOGETHER - so its headings cannot be "in the
 * current language", they have to exist in both at any moment. Main and the
 * renderer therefore read the same pairs here: `main/print.ts` builds the
 * printed sheet from them, the page's card view draws them, and neither can
 * disagree with the other about what a section is called.
 *
 * **Why the headings live in `shared/` at all.** `main/` and `renderer/` are
 * separate projects (`tsconfig.node.json` / `tsconfig.web.json`), and this is
 * the one folder both include - the same reason `manifest.ts` carries the
 * module's name as a pair.
 *
 * Nothing here is advice. Every sentence names a field of the card, or says who
 * the information came from. The card computes no dose, ranks nothing and fills
 * in no blank (`cardFields.ts` carries that reasoning in full).
 */
export const CARD_TEXT = {
  dateOfBirth: { sr: "Datum rođenja", en: "Date of birth" },
  bloodType: { sr: "Krvna grupa", en: "Blood type" },
  /** The user's own answer, kept apart from the absence of one. */
  bloodTypeUnknown: { sr: "Nije poznato", en: "Not known" },
  allergies: { sr: "Alergije", en: "Allergies" },
  allergiesNone: { sr: "Nema poznatih alergija", en: "No known allergies" },
  conditions: { sr: "Stanja", en: "Conditions" },
  conditionsNone: { sr: "Nema navedenih stanja", en: "No conditions listed" },
  medications: { sr: "Lekovi", en: "Medications" },
  medicationsNone: { sr: "Ne uzima lekove", en: "No medications" },
  organDonor: { sr: "Donor organa", en: "Organ donor" },
  contactMissing: {
    sr: "Osoba više nije u imeniku",
    en: "This person is no longer in the address book",
  },
  contacts: { sr: "Kontakti za hitne slučajeve", en: "Emergency contacts" },
  doctor: { sr: "Izabrani lekar", en: "Doctor" },
  insurance: { sr: "Zdravstveno osiguranje", en: "Health insurance" },
  documents: { sr: "Dokumenti", en: "Documents" },
  documentMissing: {
    sr: "Dokument više nije evidentiran",
    en: "This document is no longer tracked",
  },
  notes: { sr: "Napomene", en: "Notes" },
  yes: { sr: "Da", en: "Yes" },
  no: { sr: "Ne", en: "No" },
  /**
   * How bad a reaction is, in the user's word. The card prints the word it was
   * given and never upgrades or downgrades it (`ALLERGY_SEVERITIES`).
   */
  severityMild: { sr: "blaga", en: "mild" },
  severitySevere: { sr: "teška", en: "severe" },
  severityAnaphylaxis: { sr: "anafilaksija", en: "anaphylaxis" },
  /**
   * The card states whose information it is, in one small line, because it is
   * read by somebody who has never met its subject and cannot ask them. It is
   * not a disclaimer about the app: it is the provenance of everything above it.
   */
  disclaimer: {
    sr: "Podatke navodi vlasnik kartice.",
    en: "Information provided by the card holder.",
  },
  emergencyNumbers: { sr: "Hitni brojevi u Srbiji", en: "Emergency numbers in Serbia" },
} satisfies Record<string, { readonly sr: string; readonly en: string }>;

/** One card label in the language a pass is being printed in. */
export function cardText(text: { readonly sr: string; readonly en: string }, language: CardLanguage): string {
  return text[language];
}

/** One of the emergency numbers a reader of the card may have to dial. */
export interface EmergencyNumber {
  /** The number as it is dialled, digits only. */
  readonly number: string;
  readonly label: { readonly sr: string; readonly en: string };
}

/**
 * The four numbers an emergency card in Serbia carries.
 *
 * **These are the four the module's brief names** - 112 the single European
 * emergency number, 192 the police, 193 the fire brigade, 194 the ambulance -
 * and they are carried as DATA rather than computed or looked up, because a
 * card that had to fetch them would be a card that does not work in the one
 * moment it exists for. Nothing here checks or reorders them.
 */
export const SERBIAN_EMERGENCY_NUMBERS: readonly EmergencyNumber[] = [
  {
    number: "112",
    label: {
      sr: "Jedinstveni evropski broj za hitne slučajeve",
      en: "Single European emergency number",
    },
  },
  { number: "192", label: { sr: "Policija", en: "Police" } },
  { number: "193", label: { sr: "Vatrogasci", en: "Fire brigade" } },
  { number: "194", label: { sr: "Hitna pomoć", en: "Ambulance" } },
];
