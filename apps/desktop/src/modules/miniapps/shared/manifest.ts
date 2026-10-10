import type { ModuleManifest } from "@nexus/core";

/**
 * The MINI-APPS module's manifest - the whole of what the shell knows about this
 * module before its page loads (ADR-090), and the discovery contract
 * `shared/modules.ts` globs.
 *
 * **Why the words live here.** The rail draws the module's name and the settings
 * gallery its one line before any chunk of the module has loaded, so the words
 * the shell needs travel as `{ sr, en }` pairs
 * (`ModuleCopyDeclaration`) while everything the page itself draws lives in
 * `renderer/copy.sr.ts`/`copy.en.ts`.
 *
 * **No settings card and no widget, and neither is an omission.** Every
 * preference this module has is really a tool's own remembered state - which
 * tile was open, which cities are on the clock, which lesson was drilled - and
 * all of it is already kept per profile and travels in the profile archive. A
 * settings card would need a knob the user could turn that is not a tool's own
 * state, and there is none: a checkbox for the sake of having a card is what
 * SET-006 warns about, and the module's own pages are where each tool's choices
 * belong. No dashboard card either: `shared/ipc.ts` has no fact a home-screen
 * row could answer with, because the module's kept state is nine tools' manners
 * rather than one subject.
 */
export const manifest: ModuleManifest = {
  id: "miniapps",
  // UTIL is shared with `focus`, `tools` and `timers`, and this module joins
  // that sharing rather than taking a prefix of its own: a drawer of small
  // tools is exactly what PRD 29 („Utility Belt") is a section about, which is
  // the same argument the timers module makes for joining it. The sharing is
  // stated in `modules.test.ts`'s prefix map, so any OTHER duplicate still
  // fails.
  prefix: "UTIL",
  group: "make",
  defaultEnabled: true,
  // After every compiled-in module and after `timers` (order 100); a round
  // number with room either side, so a later kit module can sort above or below
  // this one without renumbering it.
  order: 210,
  copy: {
    name: { sr: "Mini aplikacije", en: "Mini apps" },
    description: {
      sr: "Devet sitnih alata na jednom mestu: metronom, kockice, brojači, semafor, kucanje, datumi, svetski sat, svetlo ekrana i QR čitač.",
      en: "Nine small tools in one place: a metronome, dice, counters, a scoreboard, typing, dates, a world clock, a screen light and a QR reader.",
    },
  },
};
