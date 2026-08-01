import { serializeRecurrenceRule, serializeTaskViewConfig } from "@nexus/core";
import type { RecurrenceRule, TaskViewConfig } from "@nexus/core";

/**
 * The four value-to-column conversions both archive-apply paths share —
 * `RestoreStore.replaceProfileData` (ADR-023) and
 * `ForeignImportStore.insertPlanned` (ADR-043). They live here rather than in
 * either store because a difference between them would be invisible: two
 * stores writing the same column in two canonical forms is exactly the drift
 * `TaskStore`/`EventStore` are entitled to read as corruption.
 */

/**
 * A parsed rule as the column stores it. `parseImportArchive` already returned
 * the rule in canonical form, so this re-serialization is the same text the
 * store itself would have written — which is what lets `TaskStore`/`EventStore`
 * treat any non-canonical value they later read as corruption.
 */
export function recurrenceText(rule: RecurrenceRule | null): string | null {
  return rule === null ? null : serializeRecurrenceRule(rule);
}

/**
 * A subscription's rule as `fin_recurring.recurrence` stores it (migration 053).
 * `recurrenceText` without the nullable half: that column is NOT NULL, because a
 * subscription IS its schedule — unlike a task, whose rule is genuinely
 * optional. Same serializer, so a restored subscription is indistinguishable
 * from one `FinRecurringStore` wrote itself.
 */
export function requiredRecurrenceText(rule: RecurrenceRule): string {
  return serializeRecurrenceRule(rule);
}

/**
 * An event's recurrence exceptions as the column stores them: ascending, which
 * `EventStore` documents as the column's canonical form and its own writes
 * always produce. The parser accepts an archive that lists them in any order
 * (order carries no meaning), so sorting here is what keeps a restored master
 * indistinguishable from one the store wrote itself. Day keys are fixed-width,
 * so a plain lexicographic sort IS chronological.
 */
export function exdatesText(exdates: readonly string[]): string {
  return JSON.stringify([...exdates].sort());
}

/**
 * A reminder ladder as its column stores it — an event's whole minutes
 * (CAL-006) or a task's whole days (ADR-028), one function because the shape is
 * the same: ascending, for exactly the reason `exdatesText` sorts — the parser
 * accepts any order (order carries no meaning in an archive), and
 * `EventStore`/`TaskStore` read back only what they would have written
 * themselves. Lead times are numbers, so this needs a numeric comparator where
 * day keys got the default lexicographic one.
 */
export function offsetsText(offsets: readonly number[]): string {
  return JSON.stringify([...offsets].sort((a, b) => a - b));
}

/**
 * A task list's view preferences as the column stores them (ADR-050, migration
 * 038) — the same `serializeTaskViewConfig` the store itself writes through, so
 * a restored list is indistinguishable from one the user configured here, and a
 * config that asks for nothing lands as NULL rather than as an empty object.
 * The parser has already validated the shape; an absent one is `null`, exactly
 * as an archive written before ADR-050 leaves it.
 */
export function viewConfigText(config: TaskViewConfig | null | undefined): string | null {
  return serializeTaskViewConfig(config ?? null);
}
