import type { WidgetConfigField, WidgetContract } from "./widgets.js";

/**
 * The one reader and the one writer's gate over `WidgetContract.configFields`
 * (DASH-004 / ADR-059) — `dashboard_widgets.config`, until now opaque JSON
 * carried verbatim, finally read against the contract that declares it.
 *
 * **Two readings of one grammar, on purpose** — `taskViewConfig.ts`'s
 * discipline, applied to the widget vocabulary:
 *
 *  - `validateWidgetConfig` is STRICT: an unknown key, a count outside its
 *    closed range, a choice outside its options, a malformed selection — any
 *    of them makes the whole value `null`, "this is not a config". The posture
 *    a WRITE needs (SEC-EL-02: the renderer is untrusted; main revalidates
 *    against the SAME declaration before the store writes).
 *  - `parseWidgetConfig` is LENIENT and TOTAL: every declared field comes back,
 *    an unreadable value falls back PER FIELD to the field's `default`, and the
 *    default is TODAY'S behaviour — so a stored config can only ever cost the
 *    user a fallback to how the widget ships, never a broken card.
 *
 * Neither ever returns part of its input: every accepted value is copied into
 * a freshly built object, so no extra key and no aliased array rides along.
 */

/** One field's stored/parsed value: a count, a choice id, or a task-list selection. */
export type WidgetConfigValue = number | string | string[];

/**
 * A widget's configuration as key → value. From `parseWidgetConfig` it is
 * TOTAL over the declared fields; from `validateWidgetConfig` it is CANONICAL —
 * only the fields that differ from their defaults, so stored config and
 * "absent means today's behaviour" can never disagree.
 */
export type WidgetConfig = Record<string, WidgetConfigValue>;

/** Everything this module needs of a contract — main can hand in `{}` for a widget this build does not publish. */
type ConfigContract = Pick<WidgetContract, "configFields">;

/** How `parseWidgetConfig` reads — the live set, when the caller has one, is what dead selections are dropped against. */
export interface ParseWidgetConfigOptions {
  liveTaskListIds?: ReadonlySet<string>;
}

/**
 * The most task lists one selection may name. A profile with more lists than
 * this is filtering with something other than a dashboard card; the cap is a
 * write-side guard (SEC-EL-02), and the lenient reader truncates to it.
 */
export const WIDGET_CONFIG_MAX_TASK_LISTS = 100;

/** Thrown internally by the strict pass and never escapes this module — `validateWidgetConfig` turns it into `null`. */
class RejectedError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A count within its declared closed range — integers only, so `Infinity` can never be stored. */
function isValidCount(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * A task-list selection read leniently: string entries only, deduplicated in
 * order, dropped against the live set when one is given, truncated to the cap.
 */
function lenientTaskLists(value: unknown, live: ReadonlySet<string> | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) continue;
    if (live !== undefined && !live.has(entry)) continue;
    seen.add(entry);
    kept.push(entry);
    if (kept.length === WIDGET_CONFIG_MAX_TASK_LISTS) break;
  }
  return kept;
}

/** The strict pass's reading of a selection: exactly the canonical shape, or a rejection. */
function strictTaskLists(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > WIDGET_CONFIG_MAX_TASK_LISTS) {
    throw new RejectedError();
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) {
      throw new RejectedError();
    }
    seen.add(entry);
  }
  return [...(value as string[])];
}

/** One field's value out of the raw record, or `undefined` when the field falls back to (parse) or stays at (validate) its default. */
function strictField(field: WidgetConfigField, value: unknown): WidgetConfigValue | undefined {
  // An explicit null counts as absent: a writer that cleared one knob and one
  // that never set it mean the same thing here (`taskViewConfig`'s rule).
  if (value === undefined || value === null) return undefined;
  switch (field.kind) {
    case "count": {
      if (!isValidCount(value, field.min, field.max)) throw new RejectedError();
      return value === field.default ? undefined : value;
    }
    case "choice": {
      if (typeof value !== "string" || !field.options.some((option) => option.id === value)) {
        throw new RejectedError();
      }
      return value === field.default ? undefined : value;
    }
    case "taskLists": {
      const lists = strictTaskLists(value);
      return lists.length === 0 ? undefined : lists;
    }
  }
}

function lenientField(
  field: WidgetConfigField,
  value: unknown,
  options: ParseWidgetConfigOptions,
): WidgetConfigValue {
  switch (field.kind) {
    case "count":
      return isValidCount(value, field.min, field.max) ? value : field.default;
    case "choice":
      return typeof value === "string" && field.options.some((option) => option.id === value)
        ? value
        : field.default;
    case "taskLists":
      return lenientTaskLists(value, options.liveTaskListIds);
  }
}

/**
 * The stored column read leniently and TOTALLY: whatever `raw` holds — `null`,
 * junk, another build's keys — every declared field comes back, each falling
 * back on its own to the field's default. Never `null`, never a throw.
 */
export function parseWidgetConfig(
  contract: ConfigContract,
  raw: string | null,
  options: ParseWidgetConfigOptions = {},
): WidgetConfig {
  let stored: unknown = null;
  if (raw !== null) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const record = isRecord(stored) ? stored : {};
  const config: WidgetConfig = {};
  for (const field of contract.configFields ?? []) {
    config[field.key] = lenientField(field, record[field.key], options);
  }
  return config;
}

/**
 * Structural validation of an untrusted value into a CANONICAL config, or
 * `null` when it is not one. Canonical means minimal: a field equal to its
 * default (an empty selection included) is dropped, so what gets stored is
 * exactly the fields that differ from today's behaviour — and `{}` therefore
 * reads as "clear it". Absent input (`undefined`/`null`) is that same clear;
 * garbage is `null` — the caller's two questions get two answers.
 */
export function validateWidgetConfig(contract: ConfigContract, value: unknown): WidgetConfig | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;
  const fields = contract.configFields ?? [];
  try {
    for (const key of Object.keys(value)) {
      if (!fields.some((field) => field.key === key)) throw new RejectedError();
    }
    const config: WidgetConfig = {};
    for (const field of fields) {
      const kept = strictField(field, value[field.key]);
      if (kept !== undefined) config[field.key] = kept;
    }
    return config;
  } catch (error) {
    if (error instanceof RejectedError) return null;
    throw error;
  }
}

/** The column value for a canonical config: its JSON, or `null` when it asks for nothing. */
export function serializeWidgetConfig(config: WidgetConfig): string | null {
  return Object.keys(config).length === 0 ? null : JSON.stringify(config);
}

/**
 * The three typed readers a widget body uses over a PARSED config. Each throws
 * on a key of another kind: `parseWidgetConfig` is total over the declaration,
 * so a miss here is a programmer naming a field the contract does not declare —
 * a bug to surface, never a state to fall back from.
 */
export function widgetCount(config: WidgetConfig, key: string): number {
  const value = config[key];
  if (typeof value !== "number") {
    throw new Error(`"${key}" is not a count field of this widget's config.`);
  }
  return value;
}

export function widgetChoice(config: WidgetConfig, key: string): string {
  const value = config[key];
  if (typeof value !== "string") {
    throw new Error(`"${key}" is not a choice field of this widget's config.`);
  }
  return value;
}

export function widgetTaskLists(config: WidgetConfig, key: string): readonly string[] {
  const value = config[key];
  if (!Array.isArray(value)) {
    throw new Error(`"${key}" is not a task-lists field of this widget's config.`);
  }
  return value;
}
