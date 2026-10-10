/**
 * How strong a 2048 tile is drawn (ADR-090).
 *
 * **Four steps, not a ramp.** The design system's intensity rule - one hue at
 * four steps, never a continuous ramp - is what a tile board wants anyway: a
 * player reads "this tile is bigger" from a difference the eye notices, and a
 * value-derived alpha would end in two adjacent powers of two that look the same.
 *
 * The four bands are DOUBLINGS, so each step is twice the tile value of the one
 * below it, and the last one is open-ended: past 128 a tile is at the strongest
 * step however far it has gone, because there is nothing left to say.
 */
export function tileStep(value: number): number {
  if (value <= 4) return 0;
  if (value <= 16) return 1;
  if (value <= 64) return 2;
  return 3;
}
