import type { ModuleManifest } from "@nexus/core";

/**
 * The SCANNER module's manifest (ADR-090): the two facts the rail and the
 * launcher need before any chunk of this module exists, and the words they draw
 * - the module's name and its one-line description, in both languages.
 *
 * **Why there is no widget and no settings card.** A dashboard card draws a
 * fact about the profile that is worth a home-screen row; a scan is an ACT the
 * user performs on a page, and its result leaves for the notes module the
 * moment it is saved - so a card here would draw either the same words again or
 * a list this module deliberately does not keep (see the page header: nothing
 * the scanner recognises is stored anywhere). The one preference a scanner
 * could carry - which scripts to read - is a per-scan decision, because the
 * same user scans a Latin receipt today and a Cyrillic label tomorrow; a stored
 * default would be a wrong answer that has to be undone before every scan.
 */
export const manifest: ModuleManifest = {
  id: "scanner",
  // UTIL is PRD 29 („Utility Belt"), whose section 10 names the OCR tool as a
  // future extension of that belt. The other three modules sharing this prefix
  // are the same PRD entry reached three ways (`modules.test.ts` states the
  // sharing); this is a fourth surface of it rather than a PRD entry of its
  // own, so it borrows the prefix instead of inventing one.
  prefix: "UTIL",
  group: "make",
  defaultEnabled: true,
  // After „Tajmeri" (100) and far below any number a later kit module is likely
  // to need, so two runs can both land in this range without renumbering.
  order: 300,
  copy: {
    name: { sr: "Skener", en: "Scanner" },
    description: {
      sr: "Čita tekst sa slike ili kamere i predaje ga belešci - bez interneta.",
      en: "Reads text off an image or the camera and hands it to a note - offline.",
    },
  },
};
