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
 */
export interface WidgetContract {
  /** Stable widget id, unique within its module. */
  id: string;
  /** i18n key for the widget's display name — a translation key, not text. */
  title: string;
  /** Size presets this widget supports. */
  sizes: WidgetSize[];
  /** Optional description of the widget's config shape. */
  configSchema?: JsonSchema;
  /** In-app deep link into the module view backing this widget (DASH-005). */
  deepLink: string;
  // The data-query shape is resolved when the storage layer lands (ADR-001).
}
