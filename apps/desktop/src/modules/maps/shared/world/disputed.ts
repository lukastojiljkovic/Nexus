import disputedFile from "./disputed.json";
import type { WorldGeometry, WorldPosition } from "./outline.js";

/**
 * The disputed areas the map marks, built by `scripts/maps/world-outline.mjs`
 * from Natural Earth's 1:10m disputed layer and admin-1 boundaries.
 *
 * The build stores every containing outline id in `within`. The renderer never
 * repeats point-in-polygon work: a territory card is a lookup in this table.
 */

export type DisputedGeometry =
  | WorldGeometry
  | { readonly type: "Point"; readonly coordinates: WorldPosition };

export interface DisputedArea {
  /** A stable kebab-case slug of the English name. */
  readonly id: string;
  readonly name: string;
  /** Outline region ids, or `self` for the area itself, in a stable order. */
  readonly parties: readonly string[];
  /** Whether no state claims the area, rather than a normal two-or-more-party dispute. */
  readonly note: "unclaimed" | null;
  /** Outline ids whose shapes contain the area's label or one of its vertices. */
  readonly within: readonly string[];
  readonly geometry: DisputedGeometry;
}

interface DisputedFile {
  readonly features: readonly {
    readonly id: string;
    readonly properties: Omit<DisputedArea, "id" | "geometry">;
    readonly geometry: DisputedGeometry;
  }[];
}

/** Every disputed area, in the build's stable source order. */
export const disputedAreas: readonly DisputedArea[] = (disputedFile as unknown as DisputedFile).features.map(
  ({ id, properties, geometry }) => ({ id, ...properties, geometry }),
);

/** Every disputed area whose label or a vertex lies in the outline territory. */
export function disputesWithin(regionId: string): readonly DisputedArea[] {
  return disputedAreas.filter((area) => area.within.includes(regionId));
}
