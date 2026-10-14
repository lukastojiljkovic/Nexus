import type { Migration } from "./migrations.js";

/**
 * Migration 92 - the assistant's chosen chat model (ADR-106): the one installed
 * model this profile answers with, when its user picked one by hand.
 *
 * **One nullable column on `assistant_settings`, and NULL is a real answer.**
 * `chat_model_id` NULL means "the tier decides", which is what every profile
 * meant before this column existed and what choosing a tier again returns to.
 * There is no default because there is nothing to default to: a shipped model
 * id would name a file this machine may never have downloaded, and the two
 * states a row can be in here are "a model was chosen" and "no model was
 * chosen" rather than "a model, or an arbitrary one".
 *
 * **Per profile, like `default_tier`, because it is the same question.** "What
 * answers a new turn here" has exactly two answers - a tier's recommendation or
 * one named model - and they are written on the same row so they cannot
 * disagree; a second table would let a profile hold a choice and a cleared tier
 * at once, which is a state nothing in this module can act on. The row is
 * `assistant_settings`' ordinary one-row-per-profile, absent-means-defaults
 * shape (migration 009's idiom, carried by 91).
 *
 * **A model ID, never a path.** The runtime's own registry is what maps an id to
 * a file on this disk, and every other name this module writes for a model is
 * that id - migration 91's `assistant_conversations.model_id`, the wire's
 * `modelId`, and the ids `downloadModel` and `removeModel` are called with. A
 * path kept here would be a second copy of that mapping, one `userData` move,
 * re-download or rename away from pointing at nothing; an id that no longer
 * resolves is a state `chatModelEntry` can read and fall back from.
 *
 * **The column is device data and does not travel.** The chosen model is a file
 * on THIS machine, so the archive carries the tier and leaves this NULL
 * (`ConversationStore.exportData` / `importData` say so), and a reset that
 * deletes the settings row clears it with the row.
 */
export const migration092: Migration = {
  version: 92,
  up(db) {
    db.exec(`
      ALTER TABLE assistant_settings ADD COLUMN chat_model_id TEXT;
    `);
  },
};
