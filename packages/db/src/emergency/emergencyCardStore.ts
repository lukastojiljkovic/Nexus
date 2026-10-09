import type Database from "better-sqlite3-multiple-ciphers";
import {
  isBloodType,
  isCardDocumentMode,
  isCardPrintLanguage,
  isOrganDonor,
  isRank,
  MAX_CARD_CONTACTS,
  MAX_CARD_CONTACT_NAME_LENGTH,
  MAX_CARD_CONTACT_RELATION_LENGTH,
  MAX_CARD_DOCUMENTS,
  MAX_CARD_DOCTOR_NAME_LENGTH,
  MAX_CARD_FULL_NAME_LENGTH,
  MAX_CARD_INSURANCE_NUMBER_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_PHONE_LENGTH,
  MAX_ID_LENGTH,
  rankAfter,
  serializeCardAllergies,
  serializeCardConditions,
  serializeCardMedications,
  validateCardAllergies,
  validateCardConditions,
  validateCardMedications,
} from "@nexus/core";
import type {
  CardAllergy,
  CardBloodType,
  CardDocumentMode,
  CardMedication,
  CardPrintLanguage,
  OrganDonor,
} from "@nexus/core";
import {
  EmergencyCardNotFoundError,
  EmergencyCardValidationError,
  isUniqueConstraintViolation,
} from "../errors.js";
import { isBareDate, isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";
import { placeBetween } from "../tasks/taskListStore.js";

type DatabaseHandle = Database.Database;

/** The version this store's `exportData` writes and `importData` accepts. */
export const EMERGENCY_EXPORT_VERSION = 1;

/**
 * The emergency card as the store returns it: the card's own fields plus the row's
 * identity and timestamps. One card per profile, so there is no list read.
 */
export interface EmergencyCard {
  id: string;
  profileId: string;
  fullName: string | null;
  dateOfBirth: string | null;
  bloodType: CardBloodType | null;
  allergies: CardAllergy[] | null;
  conditions: string[] | null;
  medications: CardMedication[] | null;
  organDonor: OrganDonor | null;
  healthInsuranceNumber: string | null;
  doctorName: string | null;
  doctorPhone: string | null;
  notes: string | null;
  printLanguage: CardPrintLanguage;
  createdAt: string;
  updatedAt: string;
}

/**
 * One ordered contact of the card. `personId` names a row of the People module and
 * `name` carries the contact's own text, and exactly one of them is set - see
 * migration 078's file doc for why that pair is the schema's own rule and why
 * neither column is a foreign key.
 *
 * `phone`/`relation` belong to the ROW rather than to the person, because Nexus's
 * People module keeps no phone number at all: a list of contacts with no numbers
 * would be a list of names on the one page where a number is the point.
 */
export interface EmergencyCardContact {
  id: string;
  cardId: string;
  personId: string | null;
  name: string | null;
  phone: string | null;
  relation: string | null;
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** One ordered reference to a document of the Documents module, and how it prints. */
export interface EmergencyCardDocumentRef {
  id: string;
  cardId: string;
  documentId: string;
  mode: CardDocumentMode;
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** Every field optional; an omitted one is left unset on create and untouched on update. */
export interface EmergencyCardFieldsInput {
  fullName?: string | null;
  dateOfBirth?: string | null;
  bloodType?: CardBloodType | null;
  allergies?: readonly CardAllergy[] | null;
  conditions?: readonly string[] | null;
  medications?: readonly CardMedication[] | null;
  organDonor?: OrganDonor | null;
  healthInsuranceNumber?: string | null;
  doctorName?: string | null;
  doctorPhone?: string | null;
  notes?: string | null;
  printLanguage?: CardPrintLanguage;
}

export type CreateEmergencyCardInput = EmergencyCardFieldsInput;

/** A partial patch: an omitted key is left untouched, an explicit null clears a nullable field. */
export type UpdateEmergencyCardFields = EmergencyCardFieldsInput;

export interface AddEmergencyContactInput {
  personId?: string | null;
  name?: string | null;
  phone?: string | null;
  relation?: string | null;
}

export type UpdateEmergencyContactFields = AddEmergencyContactInput;

export interface AddEmergencyDocumentInput {
  documentId: string;
  /** How the document prints; the number alone when the caller states no preference. */
  mode?: CardDocumentMode;
}

export interface UpdateEmergencyDocumentFields {
  documentId?: string;
  mode?: CardDocumentMode;
}

/**
 * The card and its two lists as ONE plain JSON value - the shape stage 2 hands to
 * the profile archive and reads back out of it. Ids and timestamps travel with the
 * rows: an archive reproduces rows, and re-minting ids on the way in would break
 * nothing today and everything the day the card's own references need to be
 * matched against it.
 */
export interface EmergencyCardExport {
  readonly version: number;
  readonly card: ExportedEmergencyCard | null;
  readonly contacts: readonly ExportedEmergencyCardContact[];
  readonly documents: readonly ExportedEmergencyCardDocument[];
}

export interface ExportedEmergencyCard {
  readonly id: string;
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExportedEmergencyCardContact {
  readonly id: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly relation: string | null;
  readonly rank: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExportedEmergencyCardDocument {
  readonly id: string;
  readonly documentId: string;
  readonly mode: CardDocumentMode;
  readonly rank: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CardRow {
  id: string;
  profile_id: string;
  full_name: string | null;
  date_of_birth: string | null;
  blood_type: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  organ_donor: string | null;
  health_insurance_number: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  notes: string | null;
  print_language: string;
  created_at: string;
  updated_at: string;
}

interface ContactRow {
  id: string;
  card_id: string;
  person_id: string | null;
  name: string | null;
  phone: string | null;
  relation: string | null;
  rank: string;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  card_id: string;
  document_id: string;
  mode: string;
  rank: string;
  created_at: string;
  updated_at: string;
}

const CARD_COLUMNS =
  "id, profile_id, full_name, date_of_birth, blood_type, allergies, conditions, medications, " +
  "organ_donor, health_insurance_number, doctor_name, doctor_phone, notes, print_language, " +
  "created_at, updated_at";

const CONTACT_COLUMNS =
  "id, card_id, person_id, name, phone, relation, rank, created_at, updated_at";

const DOCUMENT_COLUMNS = "id, card_id, document_id, mode, rank, created_at, updated_at";

/** The card's own fields, resolved and validated - the JSON columns still as the values they hold. */
interface ResolvedCard {
  fullName: string | null;
  dateOfBirth: string | null;
  bloodType: CardBloodType | null;
  allergies: CardAllergy[] | null;
  conditions: string[] | null;
  medications: CardMedication[] | null;
  organDonor: OrganDonor | null;
  healthInsuranceNumber: string | null;
  doctorName: string | null;
  doctorPhone: string | null;
  notes: string | null;
  printLanguage: CardPrintLanguage;
}

/** The identity a contact row ends up with, once the person-or-text pair is settled. */
interface ResolvedContactIdentity {
  personId: string | null;
  name: string | null;
}

/**
 * The emergency card, its ordered contacts and its ordered document references,
 * for ONE profile, over prepared and parameterized statements (SEC-API-03; every
 * value is bound, never interpolated). Construct one per profile and reuse it.
 *
 * **One card per profile, and every child write goes through it.** The card is a
 * singleton per profile (migration 078's partial unique index), so `get` answers
 * null rather than a list and `create` refuses a second LIVE card. Contacts and
 * document references carry no `profile_id` of their own: they are scoped THROUGH
 * the card, and every write resolves the live card first - which is what stops a
 * write naming another profile's card, and what makes a soft-deleted card take its
 * rows out of every read while keeping them for the restore, exactly as
 * `habit_entries` behaves one module over.
 *
 * **A `personId` or a `documentId` is checked for a LIVE row in this profile at
 * the moment of the write, and never again.** That check is the half that catches
 * a typo or a stale id out of the renderer; the other half - a person or a
 * document that leaves afterwards - is deliberately NOT the database's business
 * (no foreign key, migration 078's file doc), because the card must be able to
 * hold a reference to something People or Documents no longer carries and report
 * it as missing rather than lose the row.
 *
 * **Removing a contact is a hard delete; removing the card is a soft one.** A
 * contact is an edit to a list, so `removeContact` really removes it - the
 * attachment tables' arrangement. The card is content the user may want back, so
 * `softDelete`/`restore` is a pair and the rows it owns travel with it.
 *
 * Every mutating method takes `now` from its caller rather than reading the clock
 * (`HabitStore`, `PeopleStore`, `DocumentStore`): a caller that stamps one instant
 * across several writes is what lets a test assert an exact timestamp.
 */
export class EmergencyCardStore {
  private readonly insertCard: Database.Statement;
  private readonly selectLiveCard: Database.Statement;
  private readonly selectCardOwnerById: Database.Statement;
  private readonly updateCardFields: Database.Statement;
  private readonly markCardDeleted: Database.Statement;
  private readonly markCardRestored: Database.Statement;
  private readonly selectLivePerson: Database.Statement;
  private readonly selectLiveDocument: Database.Statement;
  private readonly insertContact: Database.Statement;
  private readonly selectContacts: Database.Statement;
  private readonly selectContactById: Database.Statement;
  private readonly updateContactFields: Database.Statement;
  private readonly updateContactRank: Database.Statement;
  private readonly deleteContact: Database.Statement;
  private readonly selectMaxContactRank: Database.Statement;
  private readonly countContacts: Database.Statement;
  private readonly insertDocumentLink: Database.Statement;
  private readonly selectDocumentLinks: Database.Statement;
  private readonly selectDocumentLinkById: Database.Statement;
  private readonly updateDocumentLinkFields: Database.Statement;
  private readonly updateDocumentLinkRank: Database.Statement;
  private readonly deleteDocumentLink: Database.Statement;
  private readonly selectMaxDocumentRank: Database.Statement;
  private readonly countDocuments: Database.Statement;
  private readonly deleteCardContacts: Database.Statement;
  private readonly deleteCardDocuments: Database.Statement;
  private readonly deleteCardsForProfile: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    readonly profileId: string,
  ) {
    this.insertCard = db.prepare(
      `INSERT INTO emergency_cards
         (id, profile_id, full_name, date_of_birth, blood_type, allergies, conditions,
          medications, organ_donor, health_insurance_number, doctor_name, doctor_phone,
          notes, print_language, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    // The one gate every read and every child write passes: the LIVE card of THIS
    // profile. There is at most one (the partial unique index), so this is a get.
    this.selectLiveCard = db.prepare(
      `SELECT ${CARD_COLUMNS} FROM emergency_cards
       WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // Deliberately NOT filtered on `deleted_at`: an import collides with the ROW,
    // and a soft-deleted one still holds its id.
    this.selectCardOwnerById = db.prepare(
      `SELECT profile_id FROM emergency_cards WHERE id = ?`,
    );
    this.updateCardFields = db.prepare(
      `UPDATE emergency_cards
          SET full_name = ?, date_of_birth = ?, blood_type = ?, allergies = ?, conditions = ?,
              medications = ?, organ_donor = ?, health_insurance_number = ?, doctor_name = ?,
              doctor_phone = ?, notes = ?, print_language = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markCardDeleted = db.prepare(
      `UPDATE emergency_cards SET deleted_at = ?, updated_at = ?
       WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The NEWEST cleared card, and only one: a user who clears a card, makes
    // another and clears that one too has two deleted rows, and restoring both
    // would collide with the partial unique index above them. Restoring the most
    // recent is the one a user means by "put it back".
    this.markCardRestored = db.prepare(
      `UPDATE emergency_cards SET deleted_at = NULL, updated_at = ?
        WHERE id = (SELECT id FROM emergency_cards
                     WHERE profile_id = ? AND deleted_at IS NOT NULL
                     ORDER BY deleted_at DESC, id DESC LIMIT 1)`,
    );
    this.selectLivePerson = db.prepare(
      `SELECT id FROM people WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectLiveDocument = db.prepare(
      `SELECT id FROM tracked_documents WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertContact = db.prepare(
      `INSERT INTO emergency_contacts
         (id, card_id, person_id, name, phone, relation, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectContacts = db.prepare(
      `SELECT ${CONTACT_COLUMNS} FROM emergency_contacts WHERE card_id = ? ORDER BY rank, id`,
    );
    this.selectContactById = db.prepare(
      `SELECT ${CONTACT_COLUMNS} FROM emergency_contacts WHERE id = ? AND card_id = ?`,
    );
    this.updateContactFields = db.prepare(
      `UPDATE emergency_contacts
          SET person_id = ?, name = ?, phone = ?, relation = ?, updated_at = ?
        WHERE id = ? AND card_id = ?`,
    );
    this.updateContactRank = db.prepare(
      `UPDATE emergency_contacts SET rank = ?, updated_at = ? WHERE id = ? AND card_id = ?`,
    );
    this.deleteContact = db.prepare(`DELETE FROM emergency_contacts WHERE id = ? AND card_id = ?`);
    this.selectMaxContactRank = db.prepare(
      `SELECT rank FROM emergency_contacts WHERE card_id = ? ORDER BY rank DESC LIMIT 1`,
    );
    this.countContacts = db.prepare(`SELECT count(*) AS n FROM emergency_contacts WHERE card_id = ?`);
    this.insertDocumentLink = db.prepare(
      `INSERT INTO emergency_documents
         (id, card_id, document_id, mode, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectDocumentLinks = db.prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM emergency_documents WHERE card_id = ? ORDER BY rank, id`,
    );
    this.selectDocumentLinkById = db.prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM emergency_documents WHERE id = ? AND card_id = ?`,
    );
    this.updateDocumentLinkFields = db.prepare(
      `UPDATE emergency_documents SET document_id = ?, mode = ?, updated_at = ?
        WHERE id = ? AND card_id = ?`,
    );
    this.updateDocumentLinkRank = db.prepare(
      `UPDATE emergency_documents SET rank = ?, updated_at = ? WHERE id = ? AND card_id = ?`,
    );
    this.deleteDocumentLink = db.prepare(
      `DELETE FROM emergency_documents WHERE id = ? AND card_id = ?`,
    );
    this.selectMaxDocumentRank = db.prepare(
      `SELECT rank FROM emergency_documents WHERE card_id = ? ORDER BY rank DESC LIMIT 1`,
    );
    this.countDocuments = db.prepare(`SELECT count(*) AS n FROM emergency_documents WHERE card_id = ?`);
    // The import's replace step. Scoped through the card rather than by a
    // `profile_id` the two child tables do not have - and written out instead of
    // leaning on `ON DELETE CASCADE`, the rule `RESTORE_WIPE_TABLES` keeps.
    this.deleteCardContacts = db.prepare(
      `DELETE FROM emergency_contacts
        WHERE card_id IN (SELECT id FROM emergency_cards WHERE profile_id = ?)`,
    );
    this.deleteCardDocuments = db.prepare(
      `DELETE FROM emergency_documents
        WHERE card_id IN (SELECT id FROM emergency_cards WHERE profile_id = ?)`,
    );
    this.deleteCardsForProfile = db.prepare(`DELETE FROM emergency_cards WHERE profile_id = ?`);
  }

  /** This profile's live card, or null while it has none. */
  get(): EmergencyCard | null {
    const row = this.readLiveCard();
    return row === null ? null : toCard(row);
  }

  /** Inserts the profile's one card. Refuses a second LIVE card rather than replacing it. */
  create(input: CreateEmergencyCardInput, now: string): EmergencyCard {
    const validNow = validateNow(now);
    if (this.readLiveCard() !== null) {
      throw new EmergencyCardValidationError("This profile already has an emergency card.");
    }
    const resolved = resolveCard(input, null, validNow);
    const id = uuidv7();

    this.insertCard.run(
      id, this.profileId, resolved.fullName, resolved.dateOfBirth, resolved.bloodType,
      serializedOrNull(resolved.allergies, serializeCardAllergies),
      serializedOrNull(resolved.conditions, serializeCardConditions),
      serializedOrNull(resolved.medications, serializeCardMedications),
      resolved.organDonor, resolved.healthInsuranceNumber, resolved.doctorName,
      resolved.doctorPhone, resolved.notes, resolved.printLanguage, validNow, validNow,
    );

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /** Applies a partial patch to the profile's live card. */
  update(fields: UpdateEmergencyCardFields, now: string): EmergencyCard {
    const validNow = validateNow(now);
    const current = this.requireLiveCard();
    const resolved = resolveCard(fields, current, validNow);

    this.updateCardFields.run(
      resolved.fullName, resolved.dateOfBirth, resolved.bloodType,
      serializedOrNull(resolved.allergies, serializeCardAllergies),
      serializedOrNull(resolved.conditions, serializeCardConditions),
      serializedOrNull(resolved.medications, serializeCardMedications),
      resolved.organDonor, resolved.healthInsuranceNumber, resolved.doctorName,
      resolved.doctorPhone, resolved.notes, resolved.printLanguage, validNow,
      current.id, this.profileId,
    );

    return { ...current, ...resolved, updatedAt: validNow };
  }

  /**
   * Takes the card out of every read, keeping it and everything it owns for
   * `restore`. The contacts and document references are NOT touched: the card is
   * the gate they are read through.
   */
  softDelete(now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markCardDeleted.run(validNow, validNow, this.profileId);
    if (changes === 0) {
      throw new EmergencyCardNotFoundError("This profile has no live emergency card to delete.");
    }
  }

  /** Puts a soft-deleted card back, with every contact and document reference it held. */
  restore(now: string): void {
    const validNow = validateNow(now);
    // Checked before the UPDATE, not inferred from its row count: a live card plus
    // an older cleared one would otherwise collide with `emergency_cards_profile_live`
    // and surface as a driver error rather than as this module's refusal.
    if (this.readLiveCard() !== null) {
      throw new EmergencyCardNotFoundError("This profile's emergency card is not deleted.");
    }
    const { changes } = this.markCardRestored.run(validNow, this.profileId);
    if (changes === 0) {
      throw new EmergencyCardNotFoundError("This profile has no deleted emergency card to restore.");
    }
  }

  /** The card's contacts in the user's order; empty while the profile has no live card. */
  listContacts(): EmergencyCardContact[] {
    const card = this.readLiveCard();
    if (card === null) return [];
    return (this.selectContacts.all(card.id) as ContactRow[]).map(toContact);
  }

  /** Appends a contact to the card's list. See the class doc for the person/name pair. */
  addContact(input: AddEmergencyContactInput, now: string): EmergencyCardContact {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    if (this.rowCount(this.countContacts, card.id) >= MAX_CARD_CONTACTS) {
      throw new EmergencyCardValidationError(
        `An emergency card holds at most ${MAX_CARD_CONTACTS} contacts.`,
      );
    }
    const identity = resolveContactIdentity(input.personId ?? null, input.name ?? null);
    if (identity.personId !== null) this.requireLivePerson(identity.personId);
    const id = uuidv7();
    const rank = rankAfter(this.maxRank(this.selectMaxContactRank, card.id));

    this.insertContact.run(
      id, card.id, identity.personId, identity.name,
      optionalText(input.phone, MAX_CARD_PHONE_LENGTH, "phone"),
      optionalText(input.relation, MAX_CARD_CONTACT_RELATION_LENGTH, "relation"),
      rank, validNow, validNow,
    );

    return toContact(this.requireContact(card.id, id));
  }

  /**
   * Patches a contact. The person-or-name pair is re-checked as a PAIR, so moving
   * a contact from its own text onto a person is one patch that clears the name
   * (`{ personId, name: null }`) rather than two writes passing through the
   * ambiguous state the schema refuses.
   */
  updateContact(id: string, fields: UpdateEmergencyContactFields, now: string): EmergencyCardContact {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    const current = toContact(this.requireContact(card.id, id));
    const identity = resolveContactIdentity(
      "personId" in fields ? (fields.personId ?? null) : current.personId,
      "name" in fields ? (fields.name ?? null) : current.name,
    );
    if (identity.personId !== null) this.requireLivePerson(identity.personId);
    const phone =
      "phone" in fields ? optionalText(fields.phone, MAX_CARD_PHONE_LENGTH, "phone") : current.phone;
    const relation =
      "relation" in fields
        ? optionalText(fields.relation, MAX_CARD_CONTACT_RELATION_LENGTH, "relation")
        : current.relation;

    this.updateContactFields.run(identity.personId, identity.name, phone, relation, validNow, id, card.id);

    return toContact(this.requireContact(card.id, id));
  }

  /** Removes a contact from the list. A contact is an edit, so this is a real delete. */
  removeContact(id: string): void {
    const card = this.requireLiveCard();
    const { changes } = this.deleteContact.run(id, card.id);
    if (changes === 0) {
      throw new EmergencyCardNotFoundError(`This card has no contact "${id}".`);
    }
  }

  /**
   * Re-orders a contact between two of its live siblings; either end may be null
   * at the ends of the list. One row moves and no other row is rewritten, which is
   * the whole point of a fractional rank (migration 062): two devices that each
   * move a contact cannot produce the mass update a renumber used to.
   */
  moveContact(id: string, beforeId: string | null, afterId: string | null, now: string): void {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    this.requireContact(card.id, id);
    if (beforeId === id || afterId === id) {
      throw new EmergencyCardValidationError("A contact cannot be ordered against itself.");
    }
    const rank = placeBetween(
      (other) => toContact(this.requireContact(card.id, other)).rank,
      beforeId,
      afterId,
    );
    if (rank === null) {
      throw new EmergencyCardValidationError(
        '"beforeId" and "afterId" do not describe a gap in this card.',
      );
    }
    this.updateContactRank.run(rank, validNow, id, card.id);
  }

  /** The card's document references in the user's order; empty while there is no live card. */
  listDocuments(): EmergencyCardDocumentRef[] {
    const card = this.readLiveCard();
    if (card === null) return [];
    return (this.selectDocumentLinks.all(card.id) as DocumentRow[]).map(toDocumentRef);
  }

  /** Appends a document to the card. See the class doc for when the id is checked. */
  addDocument(input: AddEmergencyDocumentInput, now: string): EmergencyCardDocumentRef {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    if (this.rowCount(this.countDocuments, card.id) >= MAX_CARD_DOCUMENTS) {
      throw new EmergencyCardValidationError(
        `An emergency card holds at most ${MAX_CARD_DOCUMENTS} documents.`,
      );
    }
    const documentId = requiredId(input.documentId, "documentId");
    this.requireLiveDocument(documentId);
    const mode = resolveDocumentMode(input.mode ?? "number");
    const id = uuidv7();
    const rank = rankAfter(this.maxRank(this.selectMaxDocumentRank, card.id));

    this.insertDocumentLinkOrRefuse(id, card.id, documentId, mode, rank, validNow);
    return toDocumentRef(this.requireDocumentLink(card.id, id));
  }

  /** Patches a document reference: which document, and how it prints. */
  updateDocument(
    id: string,
    fields: UpdateEmergencyDocumentFields,
    now: string,
  ): EmergencyCardDocumentRef {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    const current = toDocumentRef(this.requireDocumentLink(card.id, id));
    const documentId =
      fields.documentId === undefined
        ? current.documentId
        : requiredId(fields.documentId, "documentId");
    this.requireLiveDocument(documentId);
    const mode = fields.mode === undefined ? current.mode : resolveDocumentMode(fields.mode);

    try {
      this.updateDocumentLinkFields.run(documentId, mode, validNow, id, card.id);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new EmergencyCardValidationError("That document is already on the card.");
      }
      throw error;
    }

    return toDocumentRef(this.requireDocumentLink(card.id, id));
  }

  /** Removes a document reference from the list. A real delete, as for a contact. */
  removeDocument(id: string): void {
    const card = this.requireLiveCard();
    const { changes } = this.deleteDocumentLink.run(id, card.id);
    if (changes === 0) {
      throw new EmergencyCardNotFoundError(`This card has no document "${id}".`);
    }
  }

  /** Re-orders a document reference between two of its live siblings (`moveContact`'s rule). */
  moveDocument(id: string, beforeId: string | null, afterId: string | null, now: string): void {
    const validNow = validateNow(now);
    const card = this.requireLiveCard();
    this.requireDocumentLink(card.id, id);
    if (beforeId === id || afterId === id) {
      throw new EmergencyCardValidationError("A document cannot be ordered against itself.");
    }
    const rank = placeBetween(
      (other) => toDocumentRef(this.requireDocumentLink(card.id, other)).rank,
      beforeId,
      afterId,
    );
    if (rank === null) {
      throw new EmergencyCardValidationError(
        '"beforeId" and "afterId" do not describe a gap in this card.',
      );
    }
    this.updateDocumentLinkRank.run(rank, validNow, id, card.id);
  }

  /**
   * The card, its contacts and its document references as ONE versioned plain
   * JSON value. A profile with no card exports the empty shape rather than
   * nothing at all, so an archive always carries this module's key and a reader
   * can tell "never made a card" from "this build does not know the module".
   */
  exportData(): EmergencyCardExport {
    const card = this.get();
    if (card === null) {
      return { version: EMERGENCY_EXPORT_VERSION, card: null, contacts: [], documents: [] };
    }
    return {
      version: EMERGENCY_EXPORT_VERSION,
      card: {
        id: card.id,
        fullName: card.fullName,
        dateOfBirth: card.dateOfBirth,
        bloodType: card.bloodType,
        allergies: card.allergies,
        conditions: card.conditions,
        medications: card.medications,
        organDonor: card.organDonor,
        healthInsuranceNumber: card.healthInsuranceNumber,
        doctorName: card.doctorName,
        doctorPhone: card.doctorPhone,
        notes: card.notes,
        printLanguage: card.printLanguage,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
      contacts: this.listContacts().map((contact) => ({
        id: contact.id,
        personId: contact.personId,
        name: contact.name,
        phone: contact.phone,
        relation: contact.relation,
        rank: contact.rank,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      })),
      documents: this.listDocuments().map((link) => ({
        id: link.id,
        documentId: link.documentId,
        mode: link.mode,
        rank: link.rank,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      })),
    };
  }

  /**
   * Replaces this profile's card, contacts and document references with an exported
   * value, in ONE transaction and only after the WHOLE value validates - a
   * half-imported card is not a state anybody could repair by hand. An unknown
   * version is refused outright, because a newer archive may carry fields this
   * build would silently drop on the floor.
   *
   * The references the archive carries are NOT resolved against this profile's
   * People and Documents rows. An archive is a snapshot of another machine: a
   * contact may name a person this profile does not have, and refusing the import
   * for that would make a backup useless the moment it travelled - so the import
   * reproduces the reference and the card model reports it as missing.
   */
  importData(value: unknown): void {
    const imported = parseExport(value);
    this.db.transaction(() => {
      this.deleteCardContacts.run(this.profileId);
      this.deleteCardDocuments.run(this.profileId);
      this.deleteCardsForProfile.run(this.profileId);
      const card = imported.card;
      if (card === null) return;

      // A card id was minted on the ARCHIVE's machine, so reproducing it is safe
      // only while this file does not already hold that id. The one way to meet
      // this is importing an archive of a profile that still lives in THIS file:
      // one from another machine, or from a profile this file no longer has,
      // cannot collide. Named rather than left to the driver, and checked AFTER
      // the deletes above, so importing an archive over the card's OWN profile is
      // the ordinary path rather than the refused one.
      if (this.selectCardOwnerById.get(card.id) !== undefined) {
        throw new EmergencyCardValidationError(
          "This file already carries an emergency card under that id, for another profile.",
        );
      }

      this.insertCard.run(
        card.id, this.profileId, card.fullName, card.dateOfBirth, card.bloodType,
        serializedOrNull(card.allergies, serializeCardAllergies),
        serializedOrNull(card.conditions, serializeCardConditions),
        serializedOrNull(card.medications, serializeCardMedications),
        card.organDonor, card.healthInsuranceNumber, card.doctorName, card.doctorPhone,
        card.notes, card.printLanguage, card.createdAt, card.updatedAt,
      );
      for (const contact of imported.contacts) {
        this.insertContact.run(
          contact.id, card.id, contact.personId, contact.name, contact.phone,
          contact.relation, contact.rank, contact.createdAt, contact.updatedAt,
        );
      }
      for (const link of imported.documents) {
        this.insertDocumentLink.run(
          link.id, card.id, link.documentId, link.mode, link.rank,
          link.createdAt, link.updatedAt,
        );
      }
    })();
  }

  /** The live card's row or null - the ONE read every other statement is gated on. */
  private readLiveCard(): CardRow | null {
    const row = this.selectLiveCard.get(this.profileId) as CardRow | undefined;
    return row ?? null;
  }

  /** The live card's row or a refusal - the gate every child write and child read passes. */
  private requireLiveCard(): EmergencyCard {
    const row = this.readLiveCard();
    if (row === null) {
      throw new EmergencyCardNotFoundError("This profile has no live emergency card.");
    }
    return toCard(row);
  }

  /** A person who is live in THIS profile, or a refusal. */
  private requireLivePerson(personId: string): void {
    if (this.selectLivePerson.get(personId, this.profileId) === undefined) {
      throw new EmergencyCardValidationError('"personId" names no live person in this profile.');
    }
  }

  /** A document that is live in THIS profile, or a refusal. */
  private requireLiveDocument(documentId: string): void {
    if (this.selectLiveDocument.get(documentId, this.profileId) === undefined) {
      throw new EmergencyCardValidationError('"documentId" names no live document in this profile.');
    }
  }

  private requireContact(cardId: string, id: string): ContactRow {
    const row = this.selectContactById.get(id, cardId) as ContactRow | undefined;
    if (row === undefined) {
      throw new EmergencyCardNotFoundError(`This card has no contact "${id}".`);
    }
    return row;
  }

  private requireDocumentLink(cardId: string, id: string): DocumentRow {
    const row = this.selectDocumentLinkById.get(id, cardId) as DocumentRow | undefined;
    if (row === undefined) {
      throw new EmergencyCardNotFoundError(`This card has no document "${id}".`);
    }
    return row;
  }

  /** The largest rank in one child scope, or null while it is empty - what an append follows. */
  private maxRank(statement: Database.Statement, cardId: string): string | null {
    const row = statement.get(cardId) as { rank: string } | undefined;
    return row === undefined ? null : row.rank;
  }

  private rowCount(statement: Database.Statement, cardId: string): number {
    return (statement.get(cardId) as { n: number }).n;
  }

  /** Inserts a document reference, turning the one unique index into a sentence. */
  private insertDocumentLinkOrRefuse(
    id: string,
    cardId: string,
    documentId: string,
    mode: CardDocumentMode,
    rank: string,
    now: string,
  ): void {
    try {
      this.insertDocumentLink.run(id, cardId, documentId, mode, rank, now, now);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new EmergencyCardValidationError("That document is already on the card.");
      }
      throw error;
    }
  }
}

function toCard(row: CardRow): EmergencyCard {
  return {
    id: row.id,
    profileId: row.profile_id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    bloodType: row.blood_type as CardBloodType | null,
    allergies: parseStoredList(row.allergies, validateCardAllergies, row.id, "allergies"),
    conditions: parseStoredList(row.conditions, validateCardConditions, row.id, "conditions"),
    medications: parseStoredList(row.medications, validateCardMedications, row.id, "medications"),
    organDonor: row.organ_donor as OrganDonor | null,
    healthInsuranceNumber: row.health_insurance_number,
    doctorName: row.doctor_name,
    doctorPhone: row.doctor_phone,
    notes: row.notes,
    printLanguage: row.print_language as CardPrintLanguage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toContact(row: ContactRow): EmergencyCardContact {
  return {
    id: row.id,
    cardId: row.card_id,
    personId: row.person_id,
    name: row.name,
    phone: row.phone,
    relation: row.relation,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocumentRef(row: DocumentRow): EmergencyCardDocumentRef {
  return {
    id: row.id,
    cardId: row.card_id,
    documentId: row.document_id,
    mode: row.mode as CardDocumentMode,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A stored JSON list back as the values it holds, or null for the column's own
 * null (unanswered). A column that fails to validate is CORRUPTION and throws
 * rather than reading as an empty list: an empty list means "the user says there
 * are none", and repairing a damaged one into it would invent that answer ON an
 * emergency card.
 */
function parseStoredList<T>(
  text: string | null,
  validate: (value: unknown) => T[] | null,
  cardId: string,
  field: string,
): T[] | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const items = validate(parsed);
  if (items === null) {
    throw new EmergencyCardValidationError(
      `Emergency card "${cardId}" carries a stored "${field}" list that is not valid.`,
    );
  }
  return items;
}

/** The column text of a nullable list, through the module's own canonical serializer. */
function serializedOrNull<T>(
  items: readonly T[] | null,
  serialize: (items: readonly T[]) => string,
): string | null {
  return items === null ? null : serialize(items);
}

/** The card's fields with every default applied and every rule checked - the ONE place a card is resolved. */
function resolveCard(
  fields: EmergencyCardFieldsInput,
  current: EmergencyCard | null,
  now: string,
): ResolvedCard {
  return {
    fullName:
      "fullName" in fields
        ? optionalText(fields.fullName, MAX_CARD_FULL_NAME_LENGTH, "fullName")
        : (current?.fullName ?? null),
    dateOfBirth:
      "dateOfBirth" in fields
        ? resolveDateOfBirth(fields.dateOfBirth, now)
        : (current?.dateOfBirth ?? null),
    bloodType:
      "bloodType" in fields ? resolveBloodType(fields.bloodType) : (current?.bloodType ?? null),
    allergies:
      "allergies" in fields
        ? resolveList(fields.allergies, validateCardAllergies, "allergies")
        : (current?.allergies ?? null),
    conditions:
      "conditions" in fields
        ? resolveList(fields.conditions, validateCardConditions, "conditions")
        : (current?.conditions ?? null),
    medications:
      "medications" in fields
        ? resolveList(fields.medications, validateCardMedications, "medications")
        : (current?.medications ?? null),
    organDonor:
      "organDonor" in fields ? resolveOrganDonor(fields.organDonor) : (current?.organDonor ?? null),
    healthInsuranceNumber:
      "healthInsuranceNumber" in fields
        ? optionalText(
            fields.healthInsuranceNumber,
            MAX_CARD_INSURANCE_NUMBER_LENGTH,
            "healthInsuranceNumber",
          )
        : (current?.healthInsuranceNumber ?? null),
    doctorName:
      "doctorName" in fields
        ? optionalText(fields.doctorName, MAX_CARD_DOCTOR_NAME_LENGTH, "doctorName")
        : (current?.doctorName ?? null),
    doctorPhone:
      "doctorPhone" in fields
        ? optionalText(fields.doctorPhone, MAX_CARD_PHONE_LENGTH, "doctorPhone")
        : (current?.doctorPhone ?? null),
    notes:
      "notes" in fields
        ? optionalText(fields.notes, MAX_CARD_NOTES_LENGTH, "notes")
        : (current?.notes ?? null),
    printLanguage:
      "printLanguage" in fields
        ? resolvePrintLanguage(fields.printLanguage)
        : (current?.printLanguage ?? "sr"),
  };
}

/**
 * The person-or-text pair, settled. Refused rather than repaired: a caller that
 * cleared the person of a linked contact without saying what the contact is now
 * has lost the name, and this store is not going to invent one.
 */
function resolveContactIdentity(
  personId: string | null,
  name: string | null,
): ResolvedContactIdentity {
  if (personId !== null) {
    if (name !== null) {
      throw new EmergencyCardValidationError(
        "A contact names a person or carries its own name, never both.",
      );
    }
    return { personId: requiredId(personId, "personId"), name: null };
  }
  const trimmed = optionalText(name, MAX_CARD_CONTACT_NAME_LENGTH, "name");
  if (trimmed === null) {
    throw new EmergencyCardValidationError("A contact needs a person or a name of its own.");
  }
  return { personId: null, name: trimmed };
}

function resolveBloodType(value: CardBloodType | null): CardBloodType | null {
  if (value === null) return null;
  if (!isBloodType(value)) {
    throw new EmergencyCardValidationError(`"${String(value)}" is not a blood type.`);
  }
  return value;
}

function resolveOrganDonor(value: OrganDonor | null): OrganDonor | null {
  if (value === null) return null;
  if (!isOrganDonor(value)) {
    throw new EmergencyCardValidationError(`"${String(value)}" is not an organ-donor answer.`);
  }
  return value;
}

function resolvePrintLanguage(value: CardPrintLanguage): CardPrintLanguage {
  if (!isCardPrintLanguage(value)) {
    throw new EmergencyCardValidationError(`"${String(value)}" is not a card language.`);
  }
  return value;
}

function resolveDocumentMode(value: CardDocumentMode): CardDocumentMode {
  if (!isCardDocumentMode(value)) {
    throw new EmergencyCardValidationError(`"${String(value)}" is not a card document mode.`);
  }
  return value;
}

/**
 * A date of birth: a real bare day, and not in the future of the moment the write
 * is stamped with. That second half catches the typo that matters - a patient born
 * in 2027 - and is deliberately the only bound: a lower one tight enough to catch
 * a mistyped year would be a guess about how long people live.
 */
function resolveDateOfBirth(value: string | null, now: string): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!isBareDate(trimmed)) {
    throw new EmergencyCardValidationError('"dateOfBirth" must be a real day (YYYY-MM-DD).');
  }
  if (trimmed > now.slice(0, 10)) {
    throw new EmergencyCardValidationError('"dateOfBirth" cannot lie in the future.');
  }
  return trimmed;
}

/** A nullable list column, validated and canonicalised; null and absent are both "unanswered". */
function resolveList<T>(
  value: unknown,
  validate: (value: unknown) => T[] | null,
  field: string,
): T[] | null {
  if (value === undefined || value === null) return null;
  const items = validate(value);
  if (items === null) {
    throw new EmergencyCardValidationError(`"${field}" is not a valid list.`);
  }
  return items;
}

/** Trims an optional text column; absent, null and blank all become null. An over-long one is refused, never truncated. */
function optionalText(value: unknown, maxLength: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new EmergencyCardValidationError(`"${field}" must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new EmergencyCardValidationError(
      `"${field}" must not exceed ${maxLength} characters after trimming.`,
    );
  }
  return trimmed;
}

/** A non-empty id under the product-wide bound (`MAX_ID_LENGTH`). */
function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new EmergencyCardValidationError(`"${field}" must be a non-empty id.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new EmergencyCardValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these own keys, no more and no fewer - the rule this module's core validators keep. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

const EXPORT_KEYS = ["version", "card", "contacts", "documents"] as const;
const EXPORT_CARD_KEYS = [
  "id",
  "fullName",
  "dateOfBirth",
  "bloodType",
  "allergies",
  "conditions",
  "medications",
  "organDonor",
  "healthInsuranceNumber",
  "doctorName",
  "doctorPhone",
  "notes",
  "printLanguage",
  "createdAt",
  "updatedAt",
] as const;
const EXPORT_CONTACT_KEYS = [
  "id",
  "personId",
  "name",
  "phone",
  "relation",
  "rank",
  "createdAt",
  "updatedAt",
] as const;
const EXPORT_DOCUMENT_KEYS = [
  "id",
  "documentId",
  "mode",
  "rank",
  "createdAt",
  "updatedAt",
] as const;

/**
 * The whole imported value, validated before a single row is written. Strict on
 * purpose: an unexpected key means the value did not come from `exportData`, and
 * dropping it silently is how a newer build's field disappears on an older one.
 */
function parseExport(value: unknown): EmergencyCardExport {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_KEYS)) {
    throw new EmergencyCardValidationError(
      "An emergency-card export must carry a version, a card and its two lists.",
    );
  }
  if (value["version"] !== EMERGENCY_EXPORT_VERSION) {
    throw new EmergencyCardValidationError(
      `Unsupported emergency-card export version "${String(value["version"])}".`,
    );
  }
  const rawContacts = value["contacts"];
  const rawDocuments = value["documents"];
  if (!Array.isArray(rawContacts) || !Array.isArray(rawDocuments)) {
    throw new EmergencyCardValidationError("An emergency-card export must carry two lists.");
  }
  return {
    version: EMERGENCY_EXPORT_VERSION,
    card: value["card"] === null ? null : parseExportedCard(value["card"]),
    contacts: rawContacts.map(parseExportedContact),
    documents: rawDocuments.map(parseExportedDocument),
  };
}

function parseExportedCard(value: unknown): ExportedEmergencyCard {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_CARD_KEYS)) {
    throw new EmergencyCardValidationError("An exported emergency card is not a whole card.");
  }
  const bloodType = value["bloodType"];
  if (bloodType !== null && !isBloodType(bloodType)) {
    throw new EmergencyCardValidationError(`"${String(bloodType)}" is not a blood type.`);
  }
  const organDonor = value["organDonor"];
  if (organDonor !== null && !isOrganDonor(organDonor)) {
    throw new EmergencyCardValidationError(`"${String(organDonor)}" is not an organ-donor answer.`);
  }
  const printLanguage = value["printLanguage"];
  if (!isCardPrintLanguage(printLanguage)) {
    throw new EmergencyCardValidationError(`"${String(printLanguage)}" is not a card language.`);
  }
  // No future check on the date of birth here, deliberately: an import reproduces
  // a stored row, and the archive's own `createdAt` - not the importing machine's
  // clock - is the moment it was written against.
  const dateOfBirth = optionalText(value["dateOfBirth"], 10, "dateOfBirth");
  if (dateOfBirth !== null && !isBareDate(dateOfBirth)) {
    throw new EmergencyCardValidationError('"dateOfBirth" must be a real day (YYYY-MM-DD).');
  }
  return {
    id: requiredId(value["id"], "id"),
    fullName: optionalText(value["fullName"], MAX_CARD_FULL_NAME_LENGTH, "fullName"),
    dateOfBirth,
    bloodType: bloodType === null ? null : bloodType,
    allergies: resolveList(value["allergies"], validateCardAllergies, "allergies"),
    conditions: resolveList(value["conditions"], validateCardConditions, "conditions"),
    medications: resolveList(value["medications"], validateCardMedications, "medications"),
    organDonor: organDonor === null ? null : organDonor,
    healthInsuranceNumber: optionalText(
      value["healthInsuranceNumber"],
      MAX_CARD_INSURANCE_NUMBER_LENGTH,
      "healthInsuranceNumber",
    ),
    doctorName: optionalText(value["doctorName"], MAX_CARD_DOCTOR_NAME_LENGTH, "doctorName"),
    doctorPhone: optionalText(value["doctorPhone"], MAX_CARD_PHONE_LENGTH, "doctorPhone"),
    notes: optionalText(value["notes"], MAX_CARD_NOTES_LENGTH, "notes"),
    printLanguage,
    createdAt: requireDateTime(value["createdAt"], "createdAt"),
    updatedAt: requireDateTime(value["updatedAt"], "updatedAt"),
  };
}

function parseExportedContact(value: unknown): ExportedEmergencyCardContact {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_CONTACT_KEYS)) {
    throw new EmergencyCardValidationError("An exported emergency contact is not a contact.");
  }
  const personId = value["personId"] === null ? null : requiredId(value["personId"], "personId");
  const name = optionalText(value["name"], MAX_CARD_CONTACT_NAME_LENGTH, "name");
  if (personId === null && name === null) {
    throw new EmergencyCardValidationError("An exported contact names neither a person nor a name.");
  }
  if (personId !== null && name !== null) {
    throw new EmergencyCardValidationError("An exported contact names both a person and a name.");
  }
  const rank = value["rank"];
  if (!isRank(rank)) {
    throw new EmergencyCardValidationError(`"${String(rank)}" is not a rank.`);
  }
  return {
    id: requiredId(value["id"], "id"),
    personId,
    name,
    phone: optionalText(value["phone"], MAX_CARD_PHONE_LENGTH, "phone"),
    relation: optionalText(value["relation"], MAX_CARD_CONTACT_RELATION_LENGTH, "relation"),
    rank,
    createdAt: requireDateTime(value["createdAt"], "createdAt"),
    updatedAt: requireDateTime(value["updatedAt"], "updatedAt"),
  };
}

function parseExportedDocument(value: unknown): ExportedEmergencyCardDocument {
  if (!isRecord(value) || !hasExactKeys(value, EXPORT_DOCUMENT_KEYS)) {
    throw new EmergencyCardValidationError("An exported emergency document is not a document.");
  }
  const mode = value["mode"];
  if (!isCardDocumentMode(mode)) {
    throw new EmergencyCardValidationError(`"${String(mode)}" is not a card document mode.`);
  }
  const rank = value["rank"];
  if (!isRank(rank)) {
    throw new EmergencyCardValidationError(`"${String(rank)}" is not a rank.`);
  }
  return {
    id: requiredId(value["id"], "id"),
    documentId: requiredId(value["documentId"], "documentId"),
    mode,
    rank,
    createdAt: requireDateTime(value["createdAt"], "createdAt"),
    updatedAt: requireDateTime(value["updatedAt"], "updatedAt"),
  };
}

function requireDateTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new EmergencyCardValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
