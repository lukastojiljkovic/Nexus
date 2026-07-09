import type Database from "better-sqlite3-multiple-ciphers";
import { SchemaVersionError } from "../errors.js";
import { migration001 } from "./001-initial.js";
import { migration002 } from "./002-tasks.js";
import { migration003 } from "./003-events.js";
import { migration004 } from "./004-documents.js";
import { migration005 } from "./005-study.js";
import { migration006 } from "./006-flashcards.js";

type DatabaseHandle = Database.Database;

/** A single forward-only schema step. `up` runs inside a transaction. */
export interface Migration {
  version: number;
  up(db: DatabaseHandle): void;
}

/** All known migrations, ascending by version. */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
];

/**
 * Applies every migration whose version is greater than the file's current
 * `PRAGMA user_version`, each in its own transaction, stamping `user_version`
 * as it goes. Refuses a file written by a newer schema (forward-only rule,
 * ADR-001 / SET-011). `version` is a trusted integer from our own migration
 * table — never user input — so interpolating it into the pragma is safe;
 * `PRAGMA user_version` does not accept bound parameters.
 */
export function runMigrations(
  db: DatabaseHandle,
  migrations: readonly Migration[] = MIGRATIONS,
): void {
  const latest = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > latest) {
    throw new SchemaVersionError(
      `Database schema version ${current} is newer than this build supports ` +
        `(latest known migration is ${latest}). Update Nexus to open this file.`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
