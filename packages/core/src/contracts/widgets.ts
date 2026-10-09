import type { LabelText } from "./labels.js";

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
 * The closed vocabulary a widget's configuration is declared in (DASH-004 /
 * ADR-059). Three kinds and no fourth: a ROW CAP, a CLOSED CHOICE, and a
 * multi-select over the profile's task lists. A widget states its knobs as
 * `WidgetContract.configFields`; `widgetConfig.ts` beside this file is the one
 * reader and the one writer's gate over that declaration, so every widget's
 * fallback discipline is identical by construction.
 *
 * `key`s are ASCII slugs, unique within one widget's declaration. They are the
 * property names of the stored JSON (`dashboard_widgets.config`, migration 032)
 * AND the lookup keys the renderer resolves field labels by
 * (`strings.dashboard.config.fields.<key>`), so a key shared across widgets —
 * `count`, say — deliberately reads as one label everywhere.
 */
export interface WidgetCountField {
  kind: "count";
  key: string;
  /** Inclusive bounds of what a writer may store — always integers. */
  min: number;
  max: number;
  /**
   * What an absent (or unreadable) value means — TODAY'S behaviour of the
   * widget, pinned by tests. May legitimately sit OUTSIDE `min..max`: a widget
   * that ships uncapped declares `Number.POSITIVE_INFINITY`, which no write
   * ever stores (the writer accepts integers in range only), so the value can
   * only ever mean "unconfigured".
   */
  default: number;
}

/** One answer of a closed choice; `labelKey` resolves through the renderer's `strings` tree, exactly as `WidgetContract.title` does. */
export interface WidgetChoiceOption {
  id: string;
  labelKey: LabelText;
}

export interface WidgetChoiceField {
  kind: "choice";
  key: string;
  /** The closed domain, in the order the UI offers it. */
  options: WidgetChoiceOption[];
  /** One of `options`' ids — and, as everywhere here, today's behaviour. */
  default: string;
}

/**
 * A multi-select over the profile's LIVE task lists. Its default needs no
 * declaring: an empty selection means "all lists", which is also what a
 * selection loses itself back into when every list it named is gone — a dead
 * id is dropped on read, never an error (ADR-059).
 */
export interface WidgetTaskListsField {
  kind: "taskLists";
  key: string;
}

export type WidgetConfigField = WidgetCountField | WidgetChoiceField | WidgetTaskListsField;

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
   *
   * A module discovered from its own folder declares a `{ sr, en }` pair
   * instead (`LabelText`), because the shell draws a widget's title before any
   * of that module's page chunk has loaded.
   */
  title: LabelText;
  /** Size presets this widget supports; the layout may store only these. */
  sizes: WidgetSize[];
  /** Optional description of the widget's config shape. */
  configSchema?: JsonSchema;
  /**
   * The knobs this widget exposes (DASH-004 / ADR-059), in the order the
   * „Podesi…" form draws them. Absent (or empty) means the widget configures
   * NOTHING — no entry appears in its edit-mode menu, and the one write
   * channel refuses any keyed config for it.
   */
  configFields?: WidgetConfigField[];
  /** The module id whose page this widget opens (DASH-005) — a registry id, not a URL. */
  deepLink: string;
  // The data-query shape is resolved when the storage layer lands (ADR-001).
}
