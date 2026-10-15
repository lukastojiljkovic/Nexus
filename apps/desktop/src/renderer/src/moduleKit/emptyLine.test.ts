import { describe, expect, it } from "vitest";

/**
 * „There is nothing here" is drawn one way (UXB-02): `EmptyState variant="inline"`.
 *
 * A module that writes its empty sentence as a bare `<p className="nx-hint">`
 * draws the same words in a different ink, spacing and bullet from the page
 * next to it. This reads every module view and fails on a copy leaf whose key
 * is an empty state, rendered inside a bare hint paragraph or span.
 *
 * The allowlist names the files that still do it when this test was written.
 * Each one converts when its page is adopted, and an entry whose file no longer
 * does it fails the second test, so the entry is removed rather than kept.
 */

const sources = import.meta.glob("../../../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MODULES_PREFIX = "../../../modules/";

/** A hint element whose only child is a copy leaf named like an empty state. */
const BARE_EMPTY_LINE = /<(?:p|span) className="nx-hint">\s*\{[^}]*copy\.[\w.]*[Ee]mpty/;

/** Module views (`.tsx`) that still draw an empty sentence as a bare hint line. */
const ALLOWLIST: readonly string[] = [
  "assistant/renderer/ModelPanel.tsx",
  "assistant/renderer/Page.tsx",
  "boards/renderer/panels.tsx",
  "calculator/renderer/Page.tsx",
  "cards/renderer/Page.tsx",
  "chess/renderer/Page.tsx",
  "culture/renderer/Page.tsx",
  "emergency/renderer/ContactsEditor.tsx",
  "lab/renderer/BatteryCard.tsx",
  "library/renderer/Page.tsx",
  "maps/renderer/Page.tsx",
  "miniapps/renderer/apps/DiceApp.tsx",
  "miniapps/renderer/apps/QrApp.tsx",
  "miniapps/renderer/apps/ScoreboardApp.tsx",
  "miniapps/renderer/apps/TallyApp.tsx",
  "miniapps/renderer/apps/TypingApp.tsx",
  "miniapps/renderer/apps/WorldClockApp.tsx",
  "pantry/renderer/Page.tsx",
  "reader/renderer/Page.tsx",
  "signals/renderer/AsciiTab.tsx",
  "timers/renderer/Page.tsx",
  "translator/renderer/Page.tsx",
  "wiki/renderer/Page.tsx",
  "workshop/renderer/Page.tsx",
  "workshop/renderer/Settings.tsx",
  "workshop/renderer/images/ImageTools.tsx",
  "workshop/renderer/pdf/PdfTools.tsx",
];

/** The module views, keyed by their path under `modules/`, that draw a bare empty line. */
function bareEmptyLines(): Set<string> {
  const found = new Set<string>();
  for (const [path, source] of Object.entries(sources)) {
    if (BARE_EMPTY_LINE.test(source)) found.add(path.slice(MODULES_PREFIX.length));
  }
  return found;
}

describe("an empty list is drawn by EmptyState, never by a bare hint line", () => {
  it("finds the module views, so the rule below is not checking nothing", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("fails on a new bare empty line outside the allowlist", () => {
    const offenders = [...bareEmptyLines()].filter((path) => !ALLOWLIST.includes(path));
    expect(offenders).toEqual([]);
  });

  it("fails on an allowlist entry that no longer draws a bare empty line, so the entry is removed", () => {
    const found = bareEmptyLines();
    expect(ALLOWLIST.filter((path) => !found.has(path))).toEqual([]);
  });
});
