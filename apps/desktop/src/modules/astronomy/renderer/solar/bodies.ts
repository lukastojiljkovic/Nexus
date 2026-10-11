import type { BodyId } from "@nexus/core";

import { activeLocale, type Locale } from "../../../../renderer/src/strings.js";

/**
 * The eleven bodies of the contract, in the order the system is read in — the
 * Sun, then outwards, with the Moon beside its planet.
 *
 * `BODY_ORDER` is also the order of the texture pack's layout and of the
 * manifest's body list, so the number that decides what "after" means is written
 * once, here, and the pack builder holds the same list in its own file because a
 * Node script cannot import this one.
 *
 * **Why the names are here rather than in the module's copy table.** A body's
 * name is the view's own vocabulary: two words per body, both shipped in the
 * same file the geometry is, so the label layer cannot draw a planet it has no
 * word for. The module's `copy.sr.ts`/`copy.en.ts` (assembled around this view)
 * owns the sentences — the hints, the scale warning, the time controls — and if
 * it ever wants these names under its own roof, this table is the one place they
 * move out of.
 */

export const BODY_ORDER: readonly BodyId[] = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

export const BODY_LABELS: Readonly<Record<BodyId, { readonly sr: string; readonly en: string }>> = {
  sun: { sr: "Sunce", en: "Sun" },
  mercury: { sr: "Merkur", en: "Mercury" },
  venus: { sr: "Venera", en: "Venus" },
  earth: { sr: "Zemlja", en: "Earth" },
  moon: { sr: "Mesec", en: "Moon" },
  mars: { sr: "Mars", en: "Mars" },
  jupiter: { sr: "Jupiter", en: "Jupiter" },
  saturn: { sr: "Saturn", en: "Saturn" },
  uranus: { sr: "Uran", en: "Uranus" },
  neptune: { sr: "Neptun", en: "Neptune" },
  pluto: { sr: "Pluton", en: "Pluto" },
};

/** A body's name in the interface's language — read at call time, so a language switch reaches it. */
export function bodyLabel(id: BodyId, locale: Locale = activeLocale()): string {
  return BODY_LABELS[id][locale];
}
