/**
 * THE shell surface a kit module's renderer half reaches for (ADR-090), in one
 * import.
 *
 * A module's page and its settings card are drawn by the same shell a
 * compiled-in module's are, so they need the same few things: the language the
 * interface is being read in (`activeLocale` — a manifest's `{ sr, en }` pair is
 * NOT rewritten in place the way a copy table is, so a module that renders one
 * has to ask), the filter's entry id (`settingsEntryId`, SET-014), the class the
 * settings page marks a matched name with (`labelClass`), and the reader for one
 * of a module's own declared pairs (`declaredText`).
 *
 * **Why a facade and not four deep paths.** Each of these otherwise arrives as a
 * `../../../renderer/src/…` path from inside a module, which says nothing about
 * why it is there; one file that says what they are is a smaller thing to keep
 * true than four call sites that each guess. Nothing here is new behaviour — it
 * is the shell's own surface, re-exported — and a kit with ONE place a module
 * reaches the shell through is what makes this the list to read when the
 * question is "what does a module actually need from the shell".
 */
export { settingsEntryId } from "../moduleSettings.js";
export { labelClass } from "../settingsSearch.js";
export { activeLocale } from "../strings.js";
export { declaredText } from "./labels.js";
export type { SettingsPanelProps } from "../moduleSettingsPanels.js";
export type { DashboardWidgetBodyProps, DashboardWidgetRenderer } from "../dashboardWidgets.js";
