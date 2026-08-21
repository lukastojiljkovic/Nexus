import { describe, expect, it } from "vitest";
import { ARCHIVE_MODULE_IDS } from "@nexus/core";

import { strings } from "./strings.js";

/**
 * The interchange's module vocabulary and the copy the settings surfaces render
 * are the SAME SET — asked here because nothing else can ask it.
 *
 * **The defect this exists for.** „Šta se izvozi" is driven by a list of module
 * ids in `SettingsPage.tsx`, and that list used to be `ARCHIVE_MODULE_IDS`
 * typed out a second time. ELEC made the interchange vocabulary eleven members
 * and the copy stayed at ten, so the picker offered ten boxes, ticking all of
 * them meant ten, and a full export left every circuit out of the archive — in
 * silence, because the array the export actually sends is that same short list.
 * A list that is merely SHORT is a perfectly valid list: no type, no lint and
 * no test could see it.
 *
 * The picker now IS `ARCHIVE_MODULE_IDS`, which closes the copy. What remains
 * is the half a type genuinely cannot check: whether every member of that
 * vocabulary has a Serbian name to render. The counts table is declared
 * `satisfies Record<keyof RestoreModuleCounts, string>`, so its runtime keys
 * are exactly the counts the restore preview carries — which makes this one
 * assertion a check on all three at once: the interchange list, the counts
 * interface and the copy.
 *
 * Sorted rather than compared in order on purpose. Order is a presentation
 * decision the picker owns and may change; being the same SET is the invariant,
 * and a test that also pinned the order would fail for a reason that is not a
 * defect.
 */
describe("the archive module vocabulary", () => {
  it("has a Serbian name for every module the interchange carries, and names nothing it does not", () => {
    expect([...ARCHIVE_MODULE_IDS].sort()).toEqual(
      Object.keys(strings.settings.restore.modules).sort(),
    );
  });
});
