import type { Migration } from "./migrations.js";

/**
 * Migration 91 - the assistant's conversations (ADR-106), the one place the
 * assistant REMEMBERS anything.
 *
 * **It lives in the encrypted profile database.** A conversation is the user's
 * own words and the assistant's answers, cited from notes, tasks, events,
 * attachments and installed packs - material the database is encrypted to
 * protect. A chat log kept in a plain file beside it would be a second, plainer
 * copy of everything the first one is encrypted for, so this is the same rule
 * `search_entries` (migration 017) and the knowledge index (migration 090)
 * follow, and it is the reason the assistant's model files may live in
 * `userData` while its conversations never do.
 *
 * **Two tables, and the message is the unit.** A conversation is a title and
 * the two instants a list sorts and shows by; everything a turn produces is a
 * message row, in the order the turn produced it (`ordinal`, unique inside its
 * conversation). Storing the finished turn as rows rather than as one JSON blob
 * is what lets a page read a long thread a page at a time later, and it is what
 * makes a restore's payload a set of rows rather than a document the store would
 * have to re-parse to answer anything.
 *
 * **The JSON columns are the contract's own shapes, serialised.** `citations`
 * is the `Citation[]` the message event carried and `tool_calls` the
 * `ToolCall[]` an assistant message asked for - both are data about a turn, and
 * neither is a table: a citation has no identity of its own, and a tool call is
 * meaningful only beside the message that made it. They are stored as text
 * because SQLite has no list type, and the store validates every one of them
 * through its own reader on the way in and on the way out of an archive, so a
 * hand-edited row is refused rather than rendered.
 *
 * **`safety` is denormalised on purpose.** An answer whose citations include a
 * passage from a safety pack must carry the disclaimer, and the page learns that
 * from the row rather than by re-reading every citation of every message - the
 * same flag migration 090 stores on a passage, carried to the message it was
 * cited from.
 *
 * **No sync journal triggers, deliberately**, for the knowledge index's reason:
 * migration 063's journal is for content and sync is on hold permanently
 * (CLAUDE.md, 2026-08-31). `ON DELETE CASCADE` is what takes a profile's
 * conversations with the profile, and a conversation's messages with it.
 *
 * Nothing here reads a source table, and there is no backfill: a fresh table has
 * no rows to fill.
 */
export const migration091: Migration = {
  version: 91,
  up(db) {
    db.exec(`
      CREATE TABLE assistant_conversations (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        -- The model the conversation was last answered with, or NULL before the
        -- first answer: a thread's own record of what wrote it, which a model
        -- swap must not rewrite for the messages already in it.
        model_id    TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- The list's own read: newest first, scoped to one profile.
      CREATE INDEX assistant_conversations_recent
        ON assistant_conversations (profile_id, updated_at DESC);

      CREATE TABLE assistant_messages (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL
          REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        -- The message's position in the thread. Unique inside its conversation,
        -- because two messages cannot both be the fourth one.
        ordinal         INTEGER NOT NULL,
        -- 'system' is deliberately absent: the loop owns the system prompt and
        -- refuses a system message that arrived in a history, so a row that
        -- carried one would be a promise no reader could keep.
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        text            TEXT NOT NULL,
        -- The Citation[] the message event carried, as JSON.
        citations_json  TEXT NOT NULL DEFAULT '[]',
        -- The ToolCall[] an assistant message asked for; NULL on every other role.
        tool_calls_json TEXT,
        -- On a tool message: the call it answers. A model's own call id, never a
        -- row of this database.
        tool_call_id    TEXT,
        -- 1 when a citation of this message came from a pack whose notice is
        -- "safety": the page draws the disclaimer beside such an answer.
        safety          INTEGER NOT NULL DEFAULT 0 CHECK (safety IN (0, 1)),
        created_at      TEXT NOT NULL,
        UNIQUE (conversation_id, ordinal)
      );

      -- Reading a thread: one conversation's messages, in order.
      CREATE INDEX assistant_messages_thread
        ON assistant_messages (profile_id, conversation_id, ordinal);

      -- The module's own profile preferences: the tier a new turn loads, and
      -- nothing else - the web-search consent is DEVICE-level (web/gate.ts
      -- records why) and the knowledge index is migration 090's.
      CREATE TABLE assistant_settings (
        profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        -- 'intelligence' | 'balance' | 'speed': which of the three
        -- recommendations a new turn takes its model from.
        default_tier TEXT NOT NULL
          CHECK (default_tier IN ('intelligence', 'balance', 'speed')),
        updated_at   TEXT NOT NULL
      );
    `);
  },
};
