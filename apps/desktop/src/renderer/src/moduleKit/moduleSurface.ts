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
export type { SettingsPanelProps } from "../moduleSettingsPanels.js";
export type { DashboardWidgetBodyProps, DashboardWidgetRenderer } from "../dashboardWidgets.js";

// --- What a module needs to DRAW a value (ADR-090) ---------------------------
//
// The four above are what a module needs to be DISCOVERED and to read its own
// declared words. These are what it needs to print a number: the app has exactly
// one door to `Intl` and exactly one function that turns minor units into money,
// and a module that reached past them would be a second opinion about the
// locale's decimal mark or about how many para a dinar has. The car module is
// the first to reach for them (a service book prints dates, distances and
// prices); every module with a quantity or an amount will, which is why they
// belong on this list rather than in one module's own folder.

export { dateTimeFormat, numberFormat } from "../intl.js";
export { formatMoney, formatMoneyPlain } from "../money.js";
export { ConfirmDialog, type ConfirmDialogProps } from "../ConfirmDialog.js";
/**
 * The renderer's one door to `Intl` (`intl.ts`'s own header: every date, number
 * and collation the interface draws goes through it, so no call site spells a
 * locale tag of its own). A module that draws a ROW WITH A DATE in it needs this
 * and nothing else from that file - the calculator's history is the first such
 * surface, and the function is a factory rather than a value so it follows a
 * runtime language switch.
 */
export { dateTimeFormat } from "../intl.js";
/**
 * The house confirmation dialog (`ConfirmDialog`), for a kit module that removes
 * something the user made. It is the same component every compiled-in page's
 * destructive action goes through - without it, a module would either hand-roll a
 * second dialog (a control that drifts from the app's own) or skip the
 * confirmation on the one action that needs one.
 */
export { ConfirmDialog, type ConfirmDialogProps } from "../ConfirmDialog.js";
