/**
 * Reading a map style as a list of addresses.
 *
 * **Why the app re-checks a style at all.** The pack's style is written by our
 * own builder and is signed, so in the ordinary case there is nothing here to
 * find. What this closes is the case the ordinary one hides: a style is DATA,
 * every address in it is a request the renderer will make, and the one promise
 * the whole module makes is that the map works with the network off. A style
 * that named `https://tiles.example.com/...` would be a map that is blank on an
 * offline machine and apparently fine on the developer's, which is the worst
 * possible failure mode for this feature. So the page reads the list this file
 * produces and refuses to draw when it is not empty.
 *
 * The positions below are the whole of the style specification's address-bearing
 * fields (`https://maplibre.org/maplibre-style-spec/`, read 2026-10-10): a
 * vector source's `url` or `tiles`, a raster source's `tiles`, a GeoJSON
 * source's `data`, the `glyphs` template, and `sprite` in either of its two
 * shapes. A layer names a sprite IMAGE, never a URL, which is why no layer is
 * read here.
 */

/** One address found in a style, with the path it sits at, so a refusal can name it. */
export interface StyleUrl {
  /** A dotted path inside the style, e.g. `sources.protomaps.url`. */
  readonly at: string;
  readonly url: string;
}

/** True for an address that would leave this machine: `http`, `https`, or protocol-relative. */
export function isRemoteStyleUrl(url: string): boolean {
  return /^\s*(https?:)?\/\//i.test(url);
}

/**
 * Every address a style asks the renderer to fetch, in document order.
 *
 * A malformed style - a `sources` that is an array, a `sprite` that is a number
 * - yields no address rather than throwing: this function's answer is fed to a
 * refusal, and a refusal that threw would be a blank page with a stack trace
 * instead of a sentence. A style that cannot be read at all is refused by the
 * renderer, which is the component that owns what a style IS.
 */
export function styleUrls(style: unknown): readonly StyleUrl[] {
  if (typeof style !== "object" || style === null) return [];
  const record = style as Record<string, unknown>;
  const found: StyleUrl[] = [];

  for (const url of stringsOf(record.glyphs)) {
    found.push({ at: "glyphs", url });
  }
  const sprite = record.sprite;
  if (typeof sprite === "string") found.push({ at: "sprite", url: sprite });
  else if (Array.isArray(sprite)) {
    for (const [index, entry] of sprite.entries()) {
      if (typeof entry === "string") found.push({ at: `sprite[${String(index)}]`, url: entry });
      else if (typeof entry === "object" && entry !== null) {
        for (const url of stringsOf((entry as Record<string, unknown>).url)) {
          found.push({ at: `sprite[${String(index)}].url`, url });
        }
      }
    }
  }

  const sources = record.sources;
  if (typeof sources === "object" && sources !== null && !Array.isArray(sources)) {
    for (const [id, value] of Object.entries(sources as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const source = value as Record<string, unknown>;
      for (const url of stringsOf(source.url)) {
        found.push({ at: `sources.${id}.url`, url });
      }
      if (Array.isArray(source.tiles)) {
        for (const [index, tile] of source.tiles.entries()) {
          if (typeof tile === "string") {
            found.push({ at: `sources.${id}.tiles[${String(index)}]`, url: tile });
          }
        }
      }
      for (const url of stringsOf(source.data)) {
        found.push({ at: `sources.${id}.data`, url });
      }
    }
  }
  return found;
}

/** The addresses that would reach the network. Empty is the only acceptable answer for a pack's style. */
export function remoteStyleUrls(style: unknown): readonly StyleUrl[] {
  return styleUrls(style).filter((entry) => isRemoteStyleUrl(entry.url));
}

/** One string, or the strings of an array; anything else contributes nothing. */
function stringsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}
