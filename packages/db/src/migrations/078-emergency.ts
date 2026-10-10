import type { Migration } from "./migrations.js";

/**
 * Migration 78 - the EMERGENCY module's storage: the card, and the two ordered
 * lists it owns.
 *
 * **One card per profile, and the schema says so.** `emergency_cards_profile_live`
 * is a PARTIAL unique index over `profile_id` where `deleted_at IS NULL`, not a
 * `UNIQUE` column constraint, for the reason the soft delete exists at all: a
 * user who clears their card and starts again must be able to, while a second
 * LIVE card is unrepresentable rather than merely refused by the store (migration
 * 055's posture - an index has to be right once, a guard has to be right every
 * time).
 *
 * **The card's three lists are JSON columns and its two ORDERED lists are rows.**
 * Allergies, conditions and medications are lists of text the user typed and read
 * as a block; they travel as canonical JSON - the arrangement `habits.schedule`
 * (migration 055) and `canvas_boards.scene` (059) already have, validated by
 * `@nexus/core` on the way in AND on the way out, so anything else the column
 * holds is corruption rather than input to coerce. Contacts and documents are
 * rows instead, for two reasons JSON could not serve: each carries a
 * `person_id`/`document_id` pointing at another module, and each is reordered by
 * hand - which migration 062 settled once for the whole database as a fractional
 * `rank`, not an integer position.
 *
 * **`null` and an empty list are two different answers, and both are stored.**
 * `NULL` in `allergies` is "the user has not said"; `'[]'` is "the user says
 * there are none". The same pair exists for `blood_type`, where `'unknown'` is an
 * answer and `NULL` is the absence of one. Collapsing either pair would print a
 * card that is silent exactly where it matters most (`cardFields.ts` carries the
 * reasoning).
 *
 * **`person_id` and `document_id` carry NO foreign key, deliberately.** They name
 * rows in the People and Documents modules, and both of those modules soft-delete:
 * a person or a document can stop being live while this card still points at it,
 * which is a state this module must be able to READ and report (`missing: true`)
 * rather than a state the database should refuse or quietly repair. A cascade
 * would delete the user's contact because somebody tidied their address book, and
 * an `ON DELETE SET NULL` would silently erase which person the contact was -
 * both are worse than a dangling reference that the card model names out loud.
 * The store still refuses a reference that does not resolve AT THE MOMENT OF THE
 * WRITE, which is the half that catches a typo; the other half - a row that
 * leaves afterwards - is the model's to report. `focus_sessions` deliberately
 * keeps no foreign key to the task it names (migration 057) for the same reason,
 * one module over.
 *
 * **The contact's two identity columns are a pair, and the CHECKs make the
 * ambiguous contact unrepresentable.** A contact names either a person or its own
 * text: `person_id IS NOT NULL OR name IS NOT NULL` refuses the contact that
 * names nobody, and `person_id IS NULL OR name IS NULL` refuses the contact that
 * names both - a row whose printed name would depend on which of the two the
 * renderer happened to prefer.
 *
 * **`emergency_documents` holds one row per document.** The unique index is
 * `(card_id, document_id)`: printing the same passport twice with two print modes
 * is a mistake, not a feature, and making it unrepresentable is what lets the
 * store report it as a sentence ("that document is already on the card") rather
 * than letting it arrive as a second line on the page.
 *
 * **Child rows are hard-deleted and carry no `deleted_at`.** Removing a contact
 * or a document from the card is an edit to a list, not the destruction of
 * something the user made - the arrangement the attachment and tag-link tables
 * already have. What IS soft-deleted is the card itself, and its rows go out of
 * every read with it and come back with it, because they are scoped THROUGH the
 * card: `emergency_contacts` and `emergency_documents` reach a profile only by
 * joining `emergency_cards`, which is also why neither carries `profile_id` of
 * its own.
 *
 * **No sync journal triggers, on purpose.** Sync is on hold permanently, and
 * migration 063's triggers are what journal an object once it is switched on.
 * Adding a table there is a decision with a wire format behind it, and this
 * module's tables are not synced: they are deliberately outside
 * `RESTORE_WIPE_TABLES` too, because the module's own `exportData`/`importData`
 * is what stage 2 plugs into the profile archive (the exemption is recorded, with
 * its reason, in `restoreStore.test.ts`'s ledger).
 */
export const migration078: Migration = {
  version: 78,
  up(db) {
    db.exec(`
      CREATE TABLE emergency_cards (
        id                       TEXT PRIMARY KEY,
        profile_id               TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        full_name                TEXT,
        date_of_birth            TEXT,
        blood_type               TEXT
                                   CHECK (blood_type IS NULL OR blood_type IN
                                     ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+',
                                      'unknown')),
        allergies                TEXT,
        conditions               TEXT,
        medications              TEXT,
        organ_donor              TEXT CHECK (organ_donor IS NULL OR organ_donor IN ('yes', 'no')),
        health_insurance_number  TEXT,
        doctor_name              TEXT,
        doctor_phone             TEXT,
        notes                    TEXT,
        print_language           TEXT NOT NULL DEFAULT 'sr'
                                   CHECK (print_language IN ('sr', 'en', 'both')),
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL,
        deleted_at               TEXT
      );

      -- One LIVE card per profile. See the file doc for why this is partial.
      CREATE UNIQUE INDEX emergency_cards_profile_live
        ON emergency_cards (profile_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE emergency_contacts (
        id          TEXT PRIMARY KEY,
        card_id     TEXT NOT NULL REFERENCES emergency_cards(id) ON DELETE CASCADE,
        person_id   TEXT,
        name        TEXT,
        phone       TEXT,
        relation    TEXT,
        rank        TEXT NOT NULL DEFAULT 'i0',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        -- A contact names a person or it carries its own text, never neither and
        -- never both: see the file doc.
        CHECK (person_id IS NOT NULL OR name IS NOT NULL),
        CHECK (person_id IS NULL OR name IS NULL)
      );

      -- The only contact read there is: one card's contacts in the user's order.
      CREATE INDEX emergency_contacts_card_rank ON emergency_contacts (card_id, rank, id);

      CREATE TABLE emergency_documents (
        id          TEXT PRIMARY KEY,
        card_id     TEXT NOT NULL REFERENCES emergency_cards(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL,
        mode        TEXT NOT NULL CHECK (mode IN ('number', 'number_image')),
        rank        TEXT NOT NULL DEFAULT 'i0',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX emergency_documents_card_rank ON emergency_documents (card_id, rank, id);

      -- The same document twice on one card is a mistake: see the file doc.
      CREATE UNIQUE INDEX emergency_documents_card_document
        ON emergency_documents (card_id, document_id);
    `);
  },
};
