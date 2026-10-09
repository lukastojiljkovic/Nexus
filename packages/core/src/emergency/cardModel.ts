/**
 * The emergency card as the printed page reads it: pure, complete, and in print
 * order. Nothing here touches a database, a clock or the network - the store
 * hands over the card and the two libraries it points into, and everything below
 * is a decision that can be replayed in a test.
 *
 * **The card POINTS at People and Documents, and never copies them.** A linked
 * contact prints the person's live name, so a person renamed is renamed on the
 * card and a card never carries a stale spelling of somebody's name. A document
 * prints its live label. The price of pointing is that a reference can dangle -
 * and that is the case this module exists to get right: a person or a document
 * the module no longer carries comes back as a row with `missing: true`, never
 * dropped. A silently shortened list is the worst outcome here, because the user
 * would print a card believing it lists everybody they named.
 *
 * **`null` prints nothing; an empty list prints a heading with nothing under
 * it.** That is the module's one distinction and it is deliberate (see
 * `cardFields.ts`): "no known allergies" is information, and so is a phone number
 * with nobody attached to it yet.
 *
 * **The print order is decided HERE and not by the renderer.** Clinical facts
 * come first because they are what a paramedic reads before anything else, then
 * the people to call, then the doctor and the paperwork, and the free text last.
 * Two places deciding the order of one page is how the page and its own table of
 * contents drift apart.
 *
 * **`locale` is the RENDER language, not the card's.** The card's own
 * `printLanguage` decides which languages print at all; `locale` only decides
 * which of the two comes first on a card that prints in both, so a page produced
 * in English leads with its English headings. A single-language card has one pass
 * whatever `locale` says - the card's choice is not the reader's to override.
 */

import type {
  CardAllergy,
  CardBloodType,
  CardDocumentMode,
  CardLanguage,
  CardMedication,
  CardPrintLanguage,
  OrganDonor,
} from "./cardFields.js";

/**
 * The card's own fields, exactly as the store keeps them - one property per
 * column, one copy of the shape, so the store's row and the page's model cannot
 * disagree about what a card is.
 */
export interface EmergencyCardFields {
  /** Optional: stage 2 defaults it to the profile's name, which is why the page can
   *  still be printed for someone who never typed their own. */
  readonly fullName: string | null;
  /** A bare `YYYY-MM-DD` day, never a time: a birth date has no time zone. */
  readonly dateOfBirth: string | null;
  readonly bloodType: CardBloodType | null;
  readonly allergies: readonly CardAllergy[] | null;
  readonly conditions: readonly string[] | null;
  readonly medications: readonly CardMedication[] | null;
  readonly organDonor: OrganDonor | null;
  readonly healthInsuranceNumber: string | null;
  readonly doctorName: string | null;
  readonly doctorPhone: string | null;
  readonly notes: string | null;
  readonly printLanguage: CardPrintLanguage;
}

/** A person as the model resolves one: the People module's id, and the name that is
 *  the whole reason a contact links to one instead of carrying its own text. */
export interface CardPerson {
  readonly id: string;
  readonly name: string;
}

/** A document as the model resolves one: what the Documents module actually holds
 *  about a tracked document. */
export interface CardDocument {
  readonly id: string;
  readonly label: string;
  readonly expiryDate: string;
}

/**
 * One ordered contact, before resolution. A contact names EITHER a person
 * (`personId`, and then `name` is null - the live name is the only name) OR its
 * own free text (`name`), never both, which the store and migration 078 both
 * refuse. `phone` and `relation` belong to the ROW and not to the person: Nexus's
 * People module deliberately keeps no phone number, and an emergency card whose
 * contacts have no numbers would be a list of names.
 */
export interface CardContactSource {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly relation: string | null;
}

/**
 * One ordered document on the card, before resolution: which document, and how
 * the user wants it printed.
 *
 * The `mode` is carried through the model untouched even though nothing in Nexus
 * resolves its two halves yet - see the module report. Storing the user's choice
 * and dropping it here would silently turn every document into the same one.
 */
export interface CardDocumentSource {
  readonly id: string;
  readonly documentId: string;
  readonly mode: CardDocumentMode;
}

/** The card fields plus the ordered contacts list - what completeness asks about. */
export interface EmergencyCardWithContacts extends EmergencyCardFields {
  readonly contacts: readonly CardContactSource[];
}

/** The card as `buildCardModel` reads it: its own fields plus the two lists it owns. */
export interface EmergencyCardSource extends EmergencyCardWithContacts {
  readonly documents: readonly CardDocumentSource[];
}

/** One resolved contact. `missing` is set when the linked person is not in the
 *  library that was handed over - and then `name` is null, because the card has no
 *  name to print and inventing one would be inventing a person. */
export interface ResolvedCardContact {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly relation: string | null;
  readonly missing: boolean;
}

/** One resolved document. `missing` is set when the Documents module no longer
 *  carries the referenced row, and then both document facts are null. */
export interface ResolvedCardDocument {
  readonly id: string;
  readonly documentId: string;
  readonly mode: CardDocumentMode;
  readonly label: string | null;
  readonly expiryDate: string | null;
  readonly missing: boolean;
}

/** One section of the printed page: a stable key, so stage 2 owns the heading
 *  copy, and the resolved content underneath it. */
export type CardBlock =
  | { readonly key: "identity"; readonly fullName: string | null; readonly dateOfBirth: string | null }
  | { readonly key: "bloodType"; readonly bloodType: CardBloodType }
  | { readonly key: "allergies"; readonly allergies: readonly CardAllergy[] }
  | { readonly key: "conditions"; readonly conditions: readonly string[] }
  | { readonly key: "medications"; readonly medications: readonly CardMedication[] }
  | { readonly key: "organDonor"; readonly organDonor: OrganDonor }
  | { readonly key: "contacts"; readonly contacts: readonly ResolvedCardContact[] }
  | { readonly key: "doctor"; readonly name: string | null; readonly phone: string | null }
  | { readonly key: "insurance"; readonly number: string }
  | { readonly key: "documents"; readonly documents: readonly ResolvedCardDocument[] }
  | { readonly key: "notes"; readonly notes: string };

export type CardBlockKey = CardBlock["key"];

/** One language's whole page. */
export interface CardPass {
  readonly language: CardLanguage;
  readonly blocks: readonly CardBlock[];
}

/** Everything stage 2 prints: one pass per language the card asks for, in order. */
export interface CardModel {
  readonly passes: readonly CardPass[];
}

/**
 * The card's sections, resolved and in print order. A block appears when the card
 * has something to say in it: the scalar fields when they are set, an explicitly
 * empty list when the user answered it (that answer IS the content), and the two
 * pointing lists only when they hold a row.
 *
 * Phone numbers are passed through byte for byte. The stored string is what the
 * user copied off whatever they copied it from, and a formatter that reflowed
 * `+381 64 111 222` into another shape would be the one thing on this page a
 * reader cannot check against the original.
 */
export function buildCardModel(
  card: EmergencyCardSource,
  people: readonly CardPerson[],
  documents: readonly CardDocument[],
  locale: CardLanguage,
): CardModel {
  const byPersonId = new Map(people.map((person) => [person.id, person]));
  const byDocumentId = new Map(documents.map((document) => [document.id, document]));
  const blocks = buildBlocks(card, byPersonId, byDocumentId);
  return {
    passes: passesFor(card.printLanguage, locale).map((language) => ({ language, blocks })),
  };
}

/** Which languages print, and in which order - see the file header for `locale`'s own half. */
function passesFor(printLanguage: CardPrintLanguage, locale: CardLanguage): readonly CardLanguage[] {
  if (printLanguage === "both") return locale === "sr" ? ["sr", "en"] : ["en", "sr"];
  return [printLanguage];
}

function buildBlocks(
  card: EmergencyCardSource,
  byPersonId: ReadonlyMap<string, CardPerson>,
  byDocumentId: ReadonlyMap<string, CardDocument>,
): CardBlock[] {
  const blocks: CardBlock[] = [
    { key: "identity", fullName: card.fullName, dateOfBirth: card.dateOfBirth },
  ];
  if (card.bloodType !== null) blocks.push({ key: "bloodType", bloodType: card.bloodType });
  if (card.allergies !== null) blocks.push({ key: "allergies", allergies: card.allergies });
  if (card.conditions !== null) blocks.push({ key: "conditions", conditions: card.conditions });
  if (card.medications !== null) blocks.push({ key: "medications", medications: card.medications });
  if (card.organDonor !== null) blocks.push({ key: "organDonor", organDonor: card.organDonor });
  if (card.contacts.length > 0) {
    blocks.push({
      key: "contacts",
      contacts: card.contacts.map((contact) => resolveContact(contact, byPersonId)),
    });
  }
  // One block for the pair: a doctor with no number still tells a reader who to
  // ask for, and a number with no name is still the only way to reach them.
  if (card.doctorName !== null || card.doctorPhone !== null) {
    blocks.push({ key: "doctor", name: card.doctorName, phone: card.doctorPhone });
  }
  if (card.healthInsuranceNumber !== null) {
    blocks.push({ key: "insurance", number: card.healthInsuranceNumber });
  }
  if (card.documents.length > 0) {
    blocks.push({
      key: "documents",
      documents: card.documents.map((link) => resolveDocument(link, byDocumentId)),
    });
  }
  if (card.notes !== null) blocks.push({ key: "notes", notes: card.notes });
  return blocks;
}

function resolveContact(
  contact: CardContactSource,
  byPersonId: ReadonlyMap<string, CardPerson>,
): ResolvedCardContact {
  if (contact.personId === null) {
    return {
      id: contact.id,
      personId: null,
      name: contact.name,
      phone: contact.phone,
      relation: contact.relation,
      missing: false,
    };
  }
  const person = byPersonId.get(contact.personId);
  return {
    id: contact.id,
    personId: contact.personId,
    name: person?.name ?? null,
    phone: contact.phone,
    relation: contact.relation,
    missing: person === undefined,
  };
}

function resolveDocument(
  link: CardDocumentSource,
  byDocumentId: ReadonlyMap<string, CardDocument>,
): ResolvedCardDocument {
  const document = byDocumentId.get(link.documentId);
  return {
    id: link.id,
    documentId: link.documentId,
    mode: link.mode,
    label: document?.label ?? null,
    expiryDate: document?.expiryDate ?? null,
    missing: document === undefined,
  };
}
