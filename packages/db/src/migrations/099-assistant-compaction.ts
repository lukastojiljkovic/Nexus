import type { Migration } from "./migrations.js";

/**
 * Migration 99 - compacting a long conversation (Nexus 2.5): a thread's summary
 * of its own first messages, and whether a turn may write one by itself.
 *
 * **The summary stands for a head of the thread; the messages stay.**
 * `summary_through` counts the leading messages the summary replaces in what the
 * model reads, and `0` is "no summary". Every message is still stored and still
 * shown: compaction changes what a turn sends to the model, not what the thread
 * holds. Messages are only ever appended, so a count of leading messages names
 * the same messages for as long as the thread exists.
 *
 * **Before this, a long thread lost its start without a word.** The context
 * budget drops the oldest turns that do not fit (`budget.ts` in `@nexus/core`);
 * a summary keeps what they said in a few hundred tokens.
 *
 * **`auto_compact` is on unless a profile turns it off.** A turn that would
 * not fit the window compacts first, which costs one extra model call; a
 * profile on slow hardware may prefer the old silent drop, and the switch is
 * the same row's (migration 92), device data like the rest of it.
 */
export const migration099: Migration = {
  version: 99,
  up(db) {
    db.exec(`
      ALTER TABLE assistant_conversations ADD COLUMN summary TEXT;
      ALTER TABLE assistant_conversations ADD COLUMN summary_through INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assistant_settings ADD COLUMN auto_compact INTEGER NOT NULL DEFAULT 1;
    `);
  },
};
