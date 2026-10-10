import type {
  CardAllergy,
  CardBloodType,
  CardDocumentMode,
  CardMedication,
  CardPrintLanguage,
  OrganDonor,
} from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * EMERGENCY's contract: the channels it answers on, the payload each one takes,
 * and the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Why the card's own vocabulary comes from `@nexus/core`.** `CardBloodType`,
 * `CardAllergy` and the rest are the module's core (`cardFields.ts`), and the
 * store, main's validators and this page all have to agree on them. `@nexus/core`
 * is safe to import from `shared/` - the kit only forbids reaching a Node-only
 * package from here, because the renderer shares this folder.
 *
 * **Why every mutation answers with the whole view.** One card, a short contact
 * list and the two libraries a contact can point into; a full read is smaller
 * than the bookkeeping a delta would need, and the page then has exactly one way
 * to update: what main just said. It also makes a wrong local guess impossible -
 * the card's person-or-text pair, its list order and its completeness are all
 * main's to decide, and the page never re-derives one.
 */

/**
 * The card as it crosses the wire: the store's own fields, plus the row's
 * identity and the instant it changed. Declared here rather than imported from
 * `@nexus/db`, which is where the row lives - no file under `shared/` may reach
 * that package (it is SQLite and therefore Node-only, and the renderer shares
 * this folder). `main/register.ts` is the one thing that maps one onto the
 * other, and the compiler checks that mapping, because the store's row is what
 * it maps FROM.
 */
export interface EmergencyCardView {
  readonly id: string;
  /** Optional: the page still prints for somebody who never typed their own name. */
  readonly fullName: string | null;
  /** A bare `YYYY-MM-DD` day, never a time. */
  readonly dateOfBirth: string | null;
  readonly bloodType: CardBloodType | null;
  /** `null` is "not answered"; `[]` is "there are none" - two different answers. */
  readonly allergies: readonly CardAllergy[] | null;
  readonly conditions: readonly string[] | null;
  readonly medications: readonly CardMedication[] | null;
  readonly organDonor: OrganDonor | null;
  readonly healthInsuranceNumber: string | null;
  readonly doctorName: string | null;
  readonly doctorPhone: string | null;
  readonly notes: string | null;
  readonly printLanguage: CardPrintLanguage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One contact as stored: EITHER a person of the People module (`personId`, and
 * then `name` is null - the live name is the only name) OR its own text, never
 * both. `phone` and `relation` belong to this row and not to the person: People
 * keeps no phone number, and a card of contacts with no numbers would be a list
 * of names on the one page where the number is the point.
 */
export interface EmergencyContactView {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly relation: string | null;
  /** Fractional sort key; the list arrives already ordered by it. */
  readonly rank: string;
}

/** One document reference as stored. `mode` is the user's own print choice, carried verbatim. */
export interface EmergencyDocumentView {
  readonly id: string;
  readonly documentId: string;
  readonly mode: CardDocumentMode;
  readonly rank: string;
}

/** A person a contact may point at, with the one fact a card needs from People. */
export interface EmergencyPersonView {
  readonly id: string;
  readonly name: string;
}

/** A tracked document a reference may point at: what Documents actually holds. */
export interface EmergencyDocumentChoiceView {
  readonly id: string;
  readonly label: string;
  readonly expiryDate: string;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface EmergencyView {
  /** This profile's live card, or `null` while it has none. */
  readonly card: EmergencyCardView | null;
  /** The user's own order. Empty while there is no live card. */
  readonly contacts: readonly EmergencyContactView[];
  readonly documents: readonly EmergencyDocumentView[];
  /**
   * The two libraries the card POINTS into, so the page, the card view and the
   * printed sheet resolve a reference the same way - and so a reference that has
   * gone missing is visible rather than silently dropped (`buildCardModel`).
   * Both arrive in the profile's own Serbian sort order.
   */
  readonly people: readonly EmergencyPersonView[];
  readonly documentChoices: readonly EmergencyDocumentChoiceView[];
}

/**
 * The card's editable fields, as ONE payload.
 *
 * Every field is REQUIRED, `null` where the user has answered nothing, and that
 * is deliberate rather than convenient: a partial patch would carry the
 * difference between "leave this alone" and "clear this" in the absence of a
 * key, which is exactly the ambiguity `cardFields.ts` spends its header on. The
 * page holds the whole form, so it sends the whole form.
 */
export interface CardFieldsPayload {
  readonly fullName: string | null;
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

/**
 * How the card is laid out on paper. Two answers, and the user picks: an A6
 * sheet the card fills, or a card at credit-card width printed on A4.
 */
export const CARD_PRINT_FORMATS = ["a6", "card-a4"] as const;
export type CardPrintFormat = (typeof CARD_PRINT_FORMATS)[number];

/**
 * What a print answered. A cancel is not an error - the user closed a dialog -
 * so it is a value rather than a thrown refusal, and the page says nothing.
 */
export type CardPrintResult =
  | { readonly saved: false }
  | { readonly saved: true; readonly path: string };

type SaveCardPayload = { readonly profileId: string; readonly fields: CardFieldsPayload };
type OneContactPayload = {
  readonly profileId: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly relation: string | null;
};

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.emergency.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type EmergencyOps = {
  list: { request: { readonly profileId: string }; response: EmergencyView };
  createCard: { request: SaveCardPayload; response: EmergencyView };
  updateCard: { request: SaveCardPayload; response: EmergencyView };
  removeCard: { request: { readonly profileId: string }; response: EmergencyView };
  addContact: { request: OneContactPayload; response: EmergencyView };
  updateContact: { request: OneContactPayload & { readonly id: string }; response: EmergencyView };
  removeContact: { request: { readonly profileId: string; readonly id: string }; response: EmergencyView };
  /**
   * Re-orders one contact between two of its siblings, either end `null` at the
   * ends of the list. A move is ONE row's write (the fractional rank, migration
   * 062), which is why the page computes the neighbours rather than sending a
   * position.
   */
  moveContact: {
    request: {
      readonly profileId: string;
      readonly id: string;
      readonly beforeId: string | null;
      readonly afterId: string | null;
    };
    response: EmergencyView;
  };
  /**
   * Prints the card and saves it where the user chooses.
   *
   * **No path is in the payload, and that is the security property rather than
   * a simplification.** The renderer never names a filesystem location; main
   * opens the native save dialog and the path it answers with is the only one
   * that is ever written to (SEC-EL, exactly as the export handler states it).
   */
  printCard: {
    request: { readonly profileId: string; readonly format: CardPrintFormat };
    response: CardPrintResult;
  };
};

/** This module's renderer API: one method per op, named after the op. */
export type EmergencyApi = ModuleApiOf<EmergencyOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on.
 */
export const contract = defineModuleContract<"emergency", EmergencyOps>("emergency", [
  "list",
  "createCard",
  "updateCard",
  "removeCard",
  "addContact",
  "updateContact",
  "removeContact",
  "moveContact",
  "printCard",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.emergency.list(...)` typed in this
 * module's own page and in the dashboard widget.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    emergency: EmergencyApi;
  }
}
