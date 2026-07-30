/**
 * Minimal JSON-Schema-shaped type used to describe per-widget and per-setting
 * config. This is documentation of shape only — no validator is bundled and it
 * is not enforced at runtime. Replaced by a real schema library if one is
 * adopted later.
 */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: readonly (string | number | boolean | null)[];
  required?: readonly string[];
}

/** Fixed size presets (PRD 02 DASH OQ#1: presets over free grid resize). */
export type WidgetSize = "S" | "M" | "L";

/**
 * A dashboard widget a module publishes. Fields mirror the widget contract in
 * PRD 02 DASH §6 (name, sizes, config schema, data query, deep link).
 *
 * A stored layout row (migration 032 / ADR-045) names a widget by its QUALIFIED
 * id — `moduleId:widgetId`, the module's registry id and the `id` below joined
 * by a colon, which is why a widget id carries no colon of its own.
 * `ModuleRegistry.findWidget` resolves one; `ModuleRegistry.widgetsOf` lists a
 * module's. Both ids are ASCII kebab slugs: an id is a key, never a label.
 */
export interface WidgetContract {
  /** Stable widget id, unique within its module. ASCII kebab-case, no colon. */
  id: string;
  /**
   * The widget's display name as an i18n KEY, never as text.
   *
   * The convention, until a real i18n layer lands: the dotted PATH into the
   * renderer's `strings` object, written as a plain string —
   * `"dashboard.today.title"` means `strings.dashboard.today.title`. That keeps
   * the Serbian copy where all the copy is (`strings.ts`, one file), keeps
   * `@nexus/core` free of user-facing prose, and makes the eventual extraction
   * to an i18n catalogue mechanical: the keys already exist and already read
   * the same way.
   */
  title: string;
  /** Size presets this widget supports; the layout may store only these. */
  sizes: WidgetSize[];
  /** Optional description of the widget's config shape. */
  configSchema?: JsonSchema;
  /** The module id whose page this widget opens (DASH-005) — a registry id, not a URL. */
  deepLink: string;
  // The data-query shape is resolved when the storage layer lands (ADR-001).
}
