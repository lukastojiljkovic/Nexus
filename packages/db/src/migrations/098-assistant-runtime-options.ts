import type { Migration } from "./migrations.js";

/**
 * Migration 98 - how the assistant runs its chat model (Nexus 2.5): the context
 * it is loaded with, four sampling values, and how long it stays in memory with
 * nothing to do.
 *
 * **NULL is "the model's own", and it is the shipped state.** A sampling value
 * nobody measured for a model is a guess (`catalogue.ts` says why the bundled
 * catalogue states none), so a profile that has not set one leaves the model's
 * and the library's own defaults alone; a column per value, rather than one
 * JSON blob, lets each be reset on its own and lets SQLite say what each holds.
 *
 * **`idle_unload_minutes` has a default, and `0` is "never".** A loaded model
 * holds gigabytes of RAM or VRAM while nobody is asking it anything, so it is
 * unloaded after a quiet spell unless the profile says otherwise. Fifteen
 * minutes is a policy choice, not a measurement: long enough that a
 * conversation with pauses in it does not reload between questions, short
 * enough that a model left behind gives its memory back within the hour.
 *
 * **On `assistant_settings`, per profile, and device data.** The same row the
 * tier and the chosen model are on (migration 92), with the same
 * absent-means-defaults reading. The values are tuned to this machine's memory
 * and its models, so the archive does not carry them, as it does not carry
 * `chat_model_id`.
 */
export const migration098: Migration = {
  version: 98,
  up(db) {
    db.exec(`
      ALTER TABLE assistant_settings ADD COLUMN context_tokens INTEGER;
      ALTER TABLE assistant_settings ADD COLUMN temperature REAL;
      ALTER TABLE assistant_settings ADD COLUMN top_p REAL;
      ALTER TABLE assistant_settings ADD COLUMN top_k INTEGER;
      ALTER TABLE assistant_settings ADD COLUMN repeat_penalty REAL;
      ALTER TABLE assistant_settings ADD COLUMN idle_unload_minutes INTEGER NOT NULL DEFAULT 15;
    `);
  },
};
