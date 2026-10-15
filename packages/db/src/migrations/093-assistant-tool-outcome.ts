import type { Migration } from "./migrations.js";

/**
 * Migration 93 - whether a tool row's tool DID the thing (ADR-106), as a column
 * of the row rather than as a mark inside its text.
 *
 * **The question the column answers.** A turn's tool calls answer with their own
 * sentence, and that sentence can say nothing happened: the user declined, an
 * argument did not fit the schema, there is no task with that id. A model that
 * then writes "I did it" is the failure the assistant page states the outcome
 * for by itself (`renderer/thread.ts` draws it, `main/register.ts` writes it) -
 * and a finished turn is read back out of `assistant_messages` (migration 91),
 * so the row is where that outcome has to live.
 *
 * **Why not in the row's `text`.** An outcome spelled into the text as a
 * `[nx-not-done] ` prefix is in-band data: it travels into the profile archive
 * (`ExportedAssistantMessage`), into a backup of one, and into every later
 * reader of the row - each of which would then have to know the mark to read the
 * row at all. A column is read by the readers that want it, and is NULL for the
 * ones that do not.
 *
 * **NULL is a real answer, and it is deliberately two of them.** The column's
 * question belongs to a tool result, so a user's question, an assistant's reply
 * and an assistant's request for calls all leave it NULL - absence is the answer
 * there. On a tool row NULL means "this row recorded no outcome", which is every
 * row written before this column existed, and the module reads such a row as a
 * tool that was done, which is what the page showed for it all along. The two
 * cannot be folded into one value and must not be: a NOT NULL column defaulting
 * to 0 would have said that every tool called before this migration did nothing.
 *
 * **The CHECK is this schema's boolean.** Every flag column here is an INTEGER
 * holding 0 or 1 (`safety` a few lines up in migration 91), and a CHECK is what
 * holds when a row arrives through a restore rather than through the store,
 * whose own reader refuses a value that is not a boolean by field. `IS NULL OR`
 * spells the three states out where the column is declared.
 *
 * `ALTER TABLE ... ADD COLUMN` and not a table rebuild: the column is nullable
 * with no default, so every existing row gains exactly the NULL this migration's
 * own header says it means, and SQLite rewrites no rows to add it.
 */
export const migration093: Migration = {
  version: 93,
  up(db) {
    db.exec(`
      ALTER TABLE assistant_messages ADD COLUMN ok INTEGER CHECK (ok IS NULL OR ok IN (0, 1));
    `);
  },
};
