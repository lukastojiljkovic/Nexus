import { BODY_ORDER } from "./bodies.js";
import type { PlanetTextures } from "./textures.js";

/**
 * The credit lines a texture pack asks to be shown with itself.
 *
 * A pack's `textures.json` carries one `credit` per body (Solar System Scope's
 * CC BY 4.0 attribution, or NASA's public-domain statement), and a screen that
 * DRAWS the textures is the screen the licence's "attribution" clause is about
 * — which is why the solar view draws this line rather than leaving it to the
 * Packs card two clicks away.
 *
 * **Distinct, in body order, and nothing invented.** Several bodies share one
 * credit line (every Solar System Scope map does too), so a per-body list would
 * print the same sentence eight times; the set collapses them, and the order is
 * the contract's own body order, so the line is stable between openings. A
 * layout with no credits at all — every body absent, or a hand-made layout —
 * answers an empty list rather than a placeholder, and the caller draws nothing.
 */
export function textureCredits(textures: PlanetTextures | null): readonly string[] {
  if (textures === null) return [];
  const seen = new Set<string>();
  for (const id of BODY_ORDER) {
    const credit = textures.bodies[id]?.credit;
    if (typeof credit === "string" && credit.trim().length > 0) seen.add(credit);
  }
  return [...seen];
}
