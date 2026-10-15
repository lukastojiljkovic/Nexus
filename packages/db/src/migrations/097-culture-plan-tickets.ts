import type { Migration } from "./migrations.js";

/**
 * Migration 97 - a programme entry's tickets: the files a concert or a play was
 * bought with, attached to the plan (migration 073 is the module's storage).
 *
 * **An index row, the `culture_visit_photos` arrangement one table over.** A
 * ticket is a name, a mime, a size and a hash, and the bytes live content-addressed
 * in the same blob store every other attachment uses (ADR-014). The hash index
 * is what main's blob reference count asks, so a file a plan still names is never
 * collected while somebody else shows it.
 *
 * **A ticket belongs to a plan, not to a visit.** A plan that became a visit keeps
 * its tickets: the ticket is the proof of the thing that was planned, and the
 * visit is a separate fact the plan points at (`culture_plans.visit_id`).
 *
 * **Soft-deleting a plan keeps its tickets**, exactly as a visit keeps its
 * photos: the rows stay, they come back with the plan, and their blobs stay
 * named. Only an explicit removal, or a hard delete of the plan, takes them.
 *
 * **Tickets are not in the profile archive yet, and that is a gap.** The culture
 * archive is a versioned value (`CULTURE_EXPORT_VERSION`), and a field added to a
 * plan changes what an older build refuses to read, so it needs a version bump
 * with a reader for the old one. Until that lands, a restore that replaces the
 * culture corner drops the tickets with the plans they belong to.
 */
export const migration097: Migration = {
  version: 97,
  up(db) {
    db.exec(`
      CREATE TABLE culture_plan_tickets (
        id         TEXT PRIMARY KEY,
        plan_id    TEXT NOT NULL REFERENCES culture_plans(id) ON DELETE CASCADE,
        file_name  TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX culture_plan_tickets_plan ON culture_plan_tickets (plan_id);
      CREATE INDEX culture_plan_tickets_sha ON culture_plan_tickets (sha256);
    `);
  },
};
