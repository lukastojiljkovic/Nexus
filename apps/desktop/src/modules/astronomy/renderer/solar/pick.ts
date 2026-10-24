/**
 * A body the pointer can hit: where it is on screen, how large it is drawn, and
 * how far it is from the camera. CSS pixels, as the view projects them.
 */
export interface PickAnchor<Id> {
  readonly id: Id;
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** Distance from the camera, so the body in front wins an overlap. */
  readonly depth: number;
}

/**
 * The smallest disc a body can be hit in. In true scale a planet is a pixel or
 * less across, and a click on what the user sees — its dot and its name — has to
 * land on it anyway.
 */
export const MIN_PICK_RADIUS_PX = 12;

/**
 * The body under the pointer, or `null`. Each body's hit disc is its drawn radius
 * or `minRadiusPx`, whichever is larger; when discs overlap, the one nearest the
 * camera is the one the user is pointing at.
 */
export function pickAnchor<Id>(
  anchors: readonly PickAnchor<Id>[],
  x: number,
  y: number,
  minRadiusPx: number,
): Id | null {
  let hit: PickAnchor<Id> | null = null;
  for (const anchor of anchors) {
    const reach = Math.max(anchor.radiusPx, minRadiusPx);
    if (Math.hypot(x - anchor.x, y - anchor.y) > reach) continue;
    if (hit === null || anchor.depth < hit.depth) hit = anchor;
  }
  return hit === null ? null : hit.id;
}
