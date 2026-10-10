import type { ModuleManifest } from "@nexus/core";

/**
 * The LAB module's manifest — the whole of what the shell knows about this
 * module before its page loads (ADR-090).
 *
 * **Why there is no settings card and no widget, and neither is „not yet".**
 * `SET-006` refuses a card with one checkbox for the sake of having a card, and
 * this module has no preference the shell could draw: the terminal's baud rate
 * and line ending are properties of the DEVICE the user is talking to, which the
 * page reads off the port and shows beside it, and the off-grid budget is a list
 * with three numbers that only mean anything next to the arithmetic they feed —
 * a settings card would be a form, in a place made for preferences.
 *
 * The widget is the same argument one surface over. A card draws a FACT about
 * the profile, and the two facts here are readings (a list whose honest card is
 * a chart, which the dashboard cannot draw in a cell) and a budget (a computed
 * figure with no answer until the user has filled the list in, which would be a
 * card that says „0 Wh" to somebody who has never opened the module).
 */
export const manifest: ModuleManifest = {
  id: "lab",
  // Its own PRD prefix rather than joining UTIL: „Stvaranje" holds the modules
  // that MAKE something, and this one is an instrument drawer — a second reading
  // of „Utility Belt" would be a borrowed prefix with nothing borrowing it.
  prefix: "LAB",
  group: "make",
  defaultEnabled: true,
  // After „Elektronika" (order 300 in the kit's own numbering) and after the
  // module cores that shipped before it, with room on both sides: the order is
  // what puts the row in the rail, and a round number lets a later module sort
  // above or below without renumbering this one.
  order: 330,
  copy: {
    name: { sr: "Laboratorija", en: "The Lab" },
    description: {
      sr: "Serijski port, baterija, ton i svetlo — šta laptop ume osim svog posla.",
      en: "Serial, battery, tone and light — what the laptop can do beyond its job.",
    },
  },
};
