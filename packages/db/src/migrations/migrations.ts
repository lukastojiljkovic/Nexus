import type Database from "better-sqlite3-multiple-ciphers";
import { SchemaVersionError } from "../errors.js";
import { migration001 } from "./001-initial.js";
import { migration002 } from "./002-tasks.js";
import { migration003 } from "./003-events.js";
import { migration004 } from "./004-documents.js";
import { migration005 } from "./005-study.js";
import { migration006 } from "./006-flashcards.js";
import { migration007 } from "./007-study-plans.js";
import { migration008 } from "./008-focus-sessions.js";
import { migration009 } from "./009-notifications.js";
import { migration010 } from "./010-notes.js";
import { migration011 } from "./011-notes-organization.js";
import { migration012 } from "./012-note-links.js";
import { migration013 } from "./013-note-attachments.js";
import { migration014 } from "./014-note-versions.js";
import { migration015 } from "./015-note-templates.js";
import { migration016 } from "./016-note-cards.js";
import { migration017 } from "./017-search-index.js";
import { migration018 } from "./018-recurrence.js";
import { migration019 } from "./019-event-reminders.js";
import { migration020 } from "./020-people.js";
import { migration021 } from "./021-task-reminders.js";
import { migration022 } from "./022-task-lists.js";
import { migration023 } from "./023-task-tags.js";
import { migration024 } from "./024-task-attachments.js";
import { migration025 } from "./025-task-attachment-search.js";
import { migration026 } from "./026-notification-appetite.js";
import { migration027 } from "./027-task-templates.js";
import { migration028 } from "./028-note-folder-prefs.js";
import { migration029 } from "./029-task-dependencies.js";
import { migration030 } from "./030-dashboard-settings.js";
import { migration031 } from "./031-cloze-cards.js";
import { migration032 } from "./032-dashboard-widgets.js";
import { migration033 } from "./033-problem-cards.js";
import { migration034 } from "./034-study-settings.js";
import { migration035 } from "./035-subject-materials.js";
import { migration036 } from "./036-event-templates.js";
import { migration037 } from "./037-security-notifications.js";
import { migration038 } from "./038-task-list-views.js";
import { migration039 } from "./039-note-folder-views.js";
import { migration040 } from "./040-profile-picture.js";
import { migration041 } from "./041-snooze-default.js";
import { migration042 } from "./042-calendar-settings.js";
import { migration043 } from "./043-dashboard-sets.js";
import { migration044 } from "./044-backup-settings.js";
import { migration045 } from "./045-private-notes.js";
import { migration046 } from "./046-exam-topics.js";
import { migration047 } from "./047-cloze-numbers.js";
import { migration048 } from "./048-attachment-text-search.js";
import { migration049 } from "./049-note-categories.js";
import { migration050 } from "./050-search-history.js";

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
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
  migration041,
  migration042,
  migration043,
  migration044,
  migration045,
  migration046,
  migration047,
  migration048,
  migration049,
  migration050,
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
