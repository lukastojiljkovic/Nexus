import type { Migration } from "./migrations.js";

/**
 * Migration 1 — M0 platform tables only (no feature-module tables yet):
 * `profiles`, the per-profile `feature_flags` overrides, and a generic `meta`
 * key/value store. UUIDv7 text primary keys and ISO-8601 timestamps (ADR-001).
 */
export const migration001: Migration = {
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE profiles (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('personal', 'business')),
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE feature_flags (
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        module_id  TEXT NOT NULL,
        enabled    INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, module_id)
      );

      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
};
