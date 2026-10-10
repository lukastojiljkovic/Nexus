/**
 * The EMERGENCY module: the user's own card, read out.
 *
 * **The card exists on this branch and the tool reads it.** `EmergencyCardStore`
 * (migration 078) is in `@nexus/db` with its `get`, its ordered contacts and its
 * ordered document references, and this tool is a plain read of them — the same
 * call the module's own page makes. There is no emergency PAGE in this build
 * yet (the module's renderer half is a later wave), so the one thing this tool
 * cannot do is offer a place to open; it answers with the card's own words
 * instead.
 *
 * **The safety notice travels with the card.** A card is health information
 * about a person, and an assistant that relays it is one sentence away from
 * sounding like medical advice. The disclaimer below is the same one the brief
 * fixes for a pack with `notice: "safety"`, and the tool states it as the last
 * line of its own answer with an instruction not to answer without it — the
 * model points at what the card says; it does not rephrase it into advice of its
 * own.
 */

import { EmergencyCardStore } from "@nexus/db";
import type { EmergencyCard } from "@nexus/db";
import type { CardAllergy, CardMedication } from "@nexus/core";
import type { AssistantLocale, Tool } from "@nexus/core";
// The disclaimer, exactly as the assistant's own rules state it: this sentence
// is the product's promise about how it talks about safety, and it exists once.
import { SAFETY_NOTICE } from "@nexus/core";
import { asArgs } from "./args.js";
import {
  assertLive,
  formatDay,
  guard,
  okResult,
  text,
  type ProfileDb,
} from "./support.js";

export interface EmergencyToolDeps {
  readonly profileDb: ProfileDb;
}

/** Said to the model, once, so the notice above is not treated as decoration. */
const SAFETY_INSTRUCTION = {
  sr: "Obaveštenje ispod mora da ide uz svaki odgovor koji koristi ovu karticu.",
  en: "The notice below must travel with every answer that uses this card.",
} as const;

const NO_CARD: { sr: string; en: string } = {
  sr: "Ovaj profil nema karticu za hitne slučajeve.",
  en: "This profile has no emergency card.",
};

/** The card's own field labels, in both languages. */
const LABELS = {
  heading: { sr: "Kartica za hitne slučajeve:", en: "Emergency card:" },
  fullName: { sr: "Ime i prezime", en: "Name" },
  dateOfBirth: { sr: "Datum rođenja", en: "Date of birth" },
  bloodType: { sr: "Krvna grupa", en: "Blood type" },
  allergies: { sr: "Alergije", en: "Allergies" },
  conditions: { sr: "Stanja", en: "Conditions" },
  medications: { sr: "Lekovi", en: "Medications" },
  organDonor: { sr: "Davalac organa", en: "Organ donor" },
  insurance: { sr: "Zdravstveno osiguranje", en: "Health insurance number" },
  doctor: { sr: "Lekar", en: "Doctor" },
  notes: { sr: "Napomene", en: "Notes" },
  contacts: { sr: "Kontakti", en: "Contacts" },
  documents: { sr: "Povezani dokumenti", en: "Linked documents" },
  unknown: { sr: "nepoznato", en: "unknown" },
  yes: { sr: "da", en: "yes" },
  no: { sr: "ne", en: "no" },
} as const;

export function emergencyTools(deps: EmergencyToolDeps): readonly Tool[] {
  const card: Tool = {
    name: "emergency.card",
    description: {
      sr: "Čita karticu za hitne slučajeve iz profila: krvna grupa, alergije, lekovi, kontakti i lekar. Koristi ga kada korisnik traži te podatke ili kada je situacija hitna. Odgovor uvek nosi obaveštenje koje alat vraća.",
      en: "Reads the profile's emergency card: blood type, allergies, medications, contacts and doctor. Use it when the user asks for those facts or when the situation is urgent. The answer always carries the notice the tool returns.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        asArgs(rawArgs);
        const stored = deps.profileDb(
          context.profileId,
          (db, id) => new EmergencyCardStore(db, id),
        );
        const card = stored.get();
        if (card === null) {
          return okResult(text(context.locale, NO_CARD));
        }
        const lines = [
          text(context.locale, LABELS.heading),
          ...cardLines(context.locale, card),
          ...contactLines(context.locale, stored.listContacts()),
          `- ${text(context.locale, LABELS.documents)}: ${stored.listDocuments().length}`,
          "",
          text(context.locale, SAFETY_INSTRUCTION),
          text(context.locale, SAFETY_NOTICE),
        ];
        return okResult(lines.join("\n"));
      }),
  };

  return [card];
}

/** The card's own fields, one line each, and only the ones the user actually filled in. */
function cardLines(locale: AssistantLocale, card: EmergencyCard): string[] {
  const lines: string[] = [];
  const push = (label: { sr: string; en: string }, value: string | null): void => {
    if (value === null || value.trim().length === 0) return;
    lines.push(`- ${text(locale, label)}: ${value}`);
  };

  push(LABELS.fullName, card.fullName);
  push(
    LABELS.dateOfBirth,
    card.dateOfBirth === null ? null : formatDay(locale, card.dateOfBirth),
  );
  push(
    LABELS.bloodType,
    card.bloodType === null
      ? null
      : card.bloodType === "unknown"
        ? text(locale, LABELS.unknown)
        : card.bloodType,
  );
  push(LABELS.allergies, listOf(card.allergies?.map(allergyText) ?? []));
  push(LABELS.conditions, listOf(card.conditions ?? []));
  push(LABELS.medications, listOf(card.medications?.map(medicationText) ?? []));
  push(
    LABELS.organDonor,
    card.organDonor === null ? null : text(locale, card.organDonor === "yes" ? LABELS.yes : LABELS.no),
  );
  push(LABELS.insurance, card.healthInsuranceNumber);
  push(
    LABELS.doctor,
    [card.doctorName, card.doctorPhone].filter((part): part is string => part !== null).join(", "),
  );
  push(LABELS.notes, card.notes);
  return lines;
}

/** The contacts, in the order the user arranged them, each with whatever of the number and the relation they filled in. */
function contactLines(
  locale: AssistantLocale,
  contacts: readonly { readonly name: string | null; readonly phone: string | null; readonly relation: string | null }[],
): string[] {
  if (contacts.length === 0) return [];
  const rows = contacts.map((contact) => {
    const parts = [contact.phone, contact.relation].filter(
      (part): part is string => part !== null && part.trim().length > 0,
    );
    const name = contact.name ?? text(locale, LABELS.unknown);
    return `  - ${name}${parts.length === 0 ? "" : ` (${parts.join(", ")})`}`;
  });
  return [`- ${text(locale, LABELS.contacts)}:`, ...rows];
}

function allergyText(allergy: CardAllergy): string {
  return allergy.severity === null ? allergy.label : `${allergy.label} (${allergy.severity})`;
}

function medicationText(medication: CardMedication): string {
  return medication.dose === null ? medication.name : `${medication.name} (${medication.dose})`;
}

/** A list as one readable line, or null when it is empty — the same "say nothing about what nobody filled in" rule the fields follow. */
function listOf(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join("; ");
}
