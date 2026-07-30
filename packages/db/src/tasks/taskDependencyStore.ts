import type Database from "better-sqlite3-multiple-ciphers";
import { TaskDependencyValidationError, TaskNotFoundError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * One dependency edge: `blockerId` must finish before `blockedId` can be worked
 * on. Directed — the reverse pair is a different edge, and adding it once this
 * one exists is exactly the loop `addDependency` refuses.
 */
export interface TaskDependencyLink {
  blockerId: string;
  blockedId: string;
}

interface TaskDependencyRow {
  blocker_id: string;
  blocked_id: string;
}

/**
 * Persistence for the TASK module's dependencies (migration 029 / ADR-037):
 * the directed "finish that before this" edges between two tasks of one profile.
 * Shaped after `TaskTagStore` — one join table, a pair-keyed insert that is an
 * idempotent no-op on conflict, a silent delete, and a single profile-wide read
 * the page indexes itself — because it is the same kind of thing: a relation
 * between rows, with no identity of its own to name or time-stamp.
 *
 * Construct one per profile, reuse it, over prepared, parameterized statements
 * (SEC-API-03), every value bound, never interpolated. Inputs are revalidated
 * here because the renderer is untrusted (SEC-EL-02), and every statement is
 * scoped by `profile_id` — the edges are reached through their already-scoped
 * tasks, so one profile's graph is invisible to a store scoped to another.
 *
 * Two rules are this store's alone, because SQL cannot state either:
 *
 *  - **No self-edge and no cycle.** `CHECK` cannot walk a graph, so
 *    `addDependency` walks the prospective blocker's own blockers with a
 *    recursive CTE (the ancestor guard `TaskListStore.moveList` and
 *    `NoteOrgStore.moveFolder` already use for their parent chains) and refuses
 *    the edge if the task being blocked is reachable along it. Refusing at write
 *    time is what keeps every reader — the page, the scheduler, a future
 *    critical-path view — free of a "what if it loops" branch.
 *  - **Liveness is a READ filter, never a delete.** A task's soft delete leaves
 *    its edges standing (`listLinks` merely hides them), so `TaskStore.restore`
 *    brings a task back still blocked and still blocking — the `task_tag_links`
 *    arrangement, and the only one under which the undo bar tells the truth.
 *
 * What this store deliberately does NOT do is refuse to complete a blocked task
 * (ADR-037 section 3). "Blocked" is derived — any live, not-done blocker — and
 * is drawn as a chip, not enforced as a lock: the single completion path from
 * ADR-024 stays single, and a user who knows better than their own graph is not
 * argued with.
 */
export class TaskDependencyStore {
  private readonly selectActiveTaskById: Database.Statement;
  private readonly selectLinks: Database.Statement;
  private readonly selectBlockerReach: Database.Statement;
  private readonly insertLink: Database.Statement;
  private readonly deleteLink: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectActiveTaskById = db.prepare(
      `SELECT id FROM tasks WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectLinks = db.prepare(
      `SELECT td.blocker_id, td.blocked_id
       FROM task_dependencies td
       JOIN tasks blocker ON blocker.id = td.blocker_id
       JOIN tasks blocked ON blocked.id = td.blocked_id
       WHERE blocker.profile_id = ? AND blocker.deleted_at IS NULL
         AND blocked.profile_id = ? AND blocked.deleted_at IS NULL
       ORDER BY td.blocker_id, td.blocked_id`,
    );
    // Walks the prospective blocker's own blockers, transitively (including
    // itself as the seed); the candidate closes a loop iff the task about to be
    // blocked shows up in that reach. `TaskListStore`'s ancestor guard, over a
    // graph rather than a parent chain — hence the many-parent `JOIN` instead of
    // a single `parent_id` hop. Scoped to this profile on the way, so another
    // profile's edges can neither shorten nor lengthen the walk.
    //
    // Deliberately NOT filtered by `deleted_at`: an edge that runs through a
    // soft-deleted task is still an edge, and the task can come back (the undo
    // bar). A walk that skipped it would let a cycle be built while one link of
    // it was hidden, and the restore would then bring a loop into a table whose
    // whole invariant is that it has none. The visible consequence is that a UI
    // reading only live edges can occasionally offer a blocker this refuses —
    // which is the safe direction to be wrong in, and why callers report the
    // refusal rather than assuming their own view was complete.
    this.selectBlockerReach = db.prepare(
      `WITH RECURSIVE reach(tid) AS (
         SELECT ?
         UNION
         SELECT td.blocker_id FROM task_dependencies td
         JOIN reach ON td.blocked_id = reach.tid
         JOIN tasks t ON t.id = td.blocker_id
         WHERE t.profile_id = ?
       )
       SELECT 1 FROM reach WHERE tid = ?`,
    );
    this.insertLink = db.prepare(
      `INSERT INTO task_dependencies (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
    );
    this.deleteLink = db.prepare(
      `DELETE FROM task_dependencies
       WHERE blocker_id = ? AND blocked_id = ?
         AND blocker_id IN (SELECT id FROM tasks WHERE profile_id = ?)`,
    );
  }

  /** Every dependency of this profile whose BOTH ends are live tasks, blocker id then blocked id. */
  listLinks(): TaskDependencyLink[] {
    const rows = this.selectLinks.all(this.profileId, this.profileId) as TaskDependencyRow[];
    return rows.map((row) => ({ blockerId: row.blocker_id, blockedId: row.blocked_id }));
  }

  /**
   * Records "`blockedId` waits on `blockerId`". Both must be active tasks of
   * this profile; an edge that already exists is a no-op, a task blocking itself
   * is refused, and so is any edge that would close a loop (see the class doc).
   */
  addDependency(blockerId: string, blockedId: string): void {
    this.requireActiveTask(blockerId);
    this.requireActiveTask(blockedId);
    if (blockerId === blockedId) {
      throw new TaskDependencyValidationError("A task cannot depend on itself.");
    }
    if (this.selectBlockerReach.get(blockerId, this.profileId, blockedId)) {
      throw new TaskDependencyValidationError(
        "That dependency would close a cycle: the blocking task already waits on this one.",
      );
    }
    this.insertLink.run(blockerId, blockedId);
  }

  /** Removes one edge; silent (never throws) whether or not it existed — `detachTag`'s rule. */
  removeDependency(blockerId: string, blockedId: string): void {
    this.deleteLink.run(blockerId, blockedId, this.profileId);
  }

  /** Confirms an active task exists in this profile or throws — the gate both ends of an edge go through. */
  private requireActiveTask(id: string): void {
    const row = this.selectActiveTaskById.get(id, this.profileId);
    if (!row) {
      throw new TaskNotFoundError(`No active task "${id}" in this profile.`);
    }
  }
}
