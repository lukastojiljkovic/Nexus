import type Database from "better-sqlite3-multiple-ciphers";
import type { FlagState, FlagStore } from "@nexus/core";

type DatabaseHandle = Database.Database;

interface FlagRow {
  module_id: string;
  enabled: number;
}

/**
 * `FlagStore` backed by the `feature_flags` table, scoped to a single profile.
 * Every access goes through prepared, parameterized statements (SEC-API-03,
 * baseline "parameterized queries only"). The driver is synchronous; the async
 * signatures satisfy the platform-neutral `@nexus/core` contract.
 */
export class SqliteFlagStore implements FlagStore {
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectAll = db.prepare(
      "SELECT module_id, enabled FROM feature_flags WHERE profile_id = ?",
    );
    this.upsert = db.prepare(
      `INSERT INTO feature_flags (profile_id, module_id, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, module_id)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    );
  }

  async get(): Promise<FlagState> {
    const rows = this.selectAll.all(this.profileId) as FlagRow[];
    const state: FlagState = {};
    for (const row of rows) {
      state[row.module_id] = row.enabled === 1;
    }
    return state;
  }

  async set(moduleId: string, enabled: boolean): Promise<void> {
    this.upsert.run(this.profileId, moduleId, enabled ? 1 : 0, new Date().toISOString());
  }
}
