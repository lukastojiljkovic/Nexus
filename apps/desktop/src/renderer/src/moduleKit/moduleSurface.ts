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
// The house's one door to `Intl` (a memoised factory per locale and options), so
// a module that writes a size, a date or a number follows the language being
// read without spelling a tag of its own.
export { numberFormat, dateTimeFormat, collator } from "../intl.js";
export { declaredText } from "./labels.js";
// The shell's `Intl` factories are the line above: `collator()` with no arguments
// is `Intl.Collator(["sr-Latn", "sr"])` for a Serbian reader, which is the
// collation rule this repository states.
export type { SettingsPanelProps } from "../moduleSettingsPanels.js";
export type { DashboardWidgetBodyProps, DashboardWidgetRenderer } from "../dashboardWidgets.js";

// --- What a module needs to DRAW a value (ADR-090) ---------------------------
//
// The app has exactly one function that turns minor units into money, and a
// module that reached past it would be a second opinion about how many para a
// dinar has. The car module is the first to reach for it (a service book prints
// prices); every module with an amount will.
export { formatMoney, formatMoneyPlain } from "../money.js";
/**
 * The house confirmation dialog (`ConfirmDialog`), for a kit module that removes
 * something the user made. It is the same component every compiled-in page's
 * destructive action goes through - without it, a module would either hand-roll a
 * second dialog (a control that drifts from the app's own) or skip the
 * confirmation on the one action that needs one.
 */
export { ConfirmDialog, type ConfirmDialogProps } from "../ConfirmDialog.js";
