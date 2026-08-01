/**
 * The third-party notices this product owes, and the only thing the „Licence"
 * card reads.
 *
 * **Nexus is closed-source, which is precisely why this file exists.** MIT,
 * BSD, Apache-2.0 and the OFL all give a commercial product everything it needs
 * — except silence: each one requires the copyright notice and the licence text
 * to travel WITH the distribution. Nothing else in the repository discharges
 * that. A screen that lists them does.
 *
 * **Not written — generated.** `scripts/generate-licences.mjs` reads every
 * notice off disk (a package's own `LICENSE`, a font's own OpenType `name`
 * table) and writes `data/licences.json` wholesale. Nobody types a licence, a
 * copyright line or a version here, because a notice somebody retyped is a
 * notice that can be subtly wrong, and a wrong notice is worse than a missing
 * one: it looks paid.
 *
 * **A gap is recorded, never rounded away.** `status` is the honest half of the
 * data. `"file"` means the text below was read from a file; `"declared-only"`
 * means the package states a licence id in its manifest and ships no copy of
 * the licence, so the id is reproduced and the text is not invented; and
 * `"unknown"` means the licence itself could not be established from anything
 * on disk. The screen says which of the three each entry is, and
 * `licences.test.ts` is what keeps the three from blurring.
 *
 * **Nothing imports this module eagerly.** The JSON below is ~650 KB, so the
 * „Licence" card reaches for it with `import()` and this file becomes a chunk of
 * its own — read when somebody opens Settings, never at startup. Anything that
 * imports it with a plain `import` moves all of that back into the eager bundle;
 * `licences.test.ts` is the one exception, because a test bundles nothing.
 */

import licencesJson from "./data/licences.json";

/** How much of an entry could be proved from a file, and therefore what the screen may claim. */
export type LicenceStatus = "file" | "declared-only" | "unknown";

export interface LicenceEntry {
  /** Stable key — `npm:<name>@<version>` or `font:<family directory>`. Unique across both groups. */
  readonly id: string;
  /** The package's own name, or the font's own declared family. */
  readonly name: string;
  /** The installed version, or the font's own version string. */
  readonly version: string;
  /** The SPDX id the package declares, or the one the font's metadata establishes; `"UNKNOWN"` when neither does. */
  readonly licence: string;
  /** The reproduced notice, verbatim. Empty only for `"declared-only"`. */
  readonly notice: string;
  readonly status: LicenceStatus;
  /** Exactly which file every character above was read from, relative to the package that owns it. */
  readonly source: string;
}

/**
 * Every npm package that reaches a user, plus the Electron runtime, sorted by
 * id. The assertion is the one place this module trusts the generated file, and
 * its warrant is `licences.test.ts`, which checks every entry's shape before a
 * build can ship it — the same arrangement `@nexus/core`'s food catalogue uses.
 */
export const LICENCE_PACKAGES = licencesJson.packages as readonly LicenceEntry[];

/** The font families the build copies into the installer — their own group, because they are files rather than dependencies. */
export const LICENCE_FONTS = licencesJson.fonts as readonly LicenceEntry[];
