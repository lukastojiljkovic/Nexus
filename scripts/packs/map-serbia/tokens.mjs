// The design tokens, read straight out of `packages/tokens` so the map pack's
// style is painted with THIS app's palette rather than with a colour list of
// its own.
//
// WHY NOT A COPY OF THE VALUES. The tokens package is the single source of the
// app's colours: `tokens/global.json` holds the raw ramps, `tokens/themes/*.json`
// holds the semantic layer that names them (`bg`, `surfaceAlt`, `border`,
// `textMuted`), and `packages/tokens/build.mjs` turns the second into the
// `--nx-*` custom properties. A pack style with its own hex list would be a
// palette that agrees with the app on the day it was written; this reads the
// same three files the app's own stylesheet is generated from, so a contrast
// fix or a re-tuned ramp reaches the map the moment the pack is rebuilt.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every leaf of one token document, keyed by its dotted path: `color.paper.100` → `#f7f4ee`. */
export function flattenTokens(value, path = [], into = new Map()) {
  if (typeof value === "string") {
    into.set(path.join("."), value);
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenTokens(child, [...path, key], into);
    }
  }
  return into;
}

/**
 * One token value, with a `{color.paper.100}` reference resolved.
 *
 * The reference syntax is the generator's own (`tokens/themes/*.json` names a
 * ramp entry that way and `build.mjs` resolves it), and a value with no braces
 * is a literal — `shadow: "none"` is one, and so is a colour typed directly
 * into a theme.
 */
export function resolveToken(value, flat) {
  const reference = /^\{([^}]+)\}$/.exec(value);
  if (reference === null) return value;
  const target = flat.get(reference[1]);
  if (target === undefined) {
    throw new Error(`map-serbia: the token "${reference[1]}" is referenced but not defined.`);
  }
  // A reference to a reference is not a thing the generator writes; if one ever
  // appeared, resolving it once and handing back the braces would be a colour
  // MapLibre refuses silently. Refusing it here is the loud version.
  if (target.startsWith("{")) {
    throw new Error(`map-serbia: the token "${reference[1]}" points at another reference.`);
  }
  return target;
}

/** `surfaceAlt` → `surface-alt`: the name the app's stylesheet gives the custom property. */
export function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * One theme's semantic layer, keyed the way the CSS custom properties are
 * (`--nx-bg` is `bg`, `--nx-surface-alt` is `surface-alt`).
 *
 * A semantic entry that is not a colour — `shadow: "none"`, the two material
 * strings — is carried through as its literal text: this function resolves
 * REFERENCES, and it is the style's job to ask only for the colours it paints.
 */
export function semanticTokens(global, theme) {
  const flat = flattenTokens(global);
  const tokens = {};
  for (const [key, value] of Object.entries(theme.semantic ?? {})) {
    tokens[kebab(key)] = typeof value === "string" ? resolveToken(value, flat) : value;
  }
  return tokens;
}

/** The three files the app's own stylesheet is built from. */
export function readTokenFiles(repoRoot) {
  const read = (relative) => JSON.parse(readFileSync(join(repoRoot, relative), "utf8"));
  const global = read("packages/tokens/tokens/global.json");
  return {
    global,
    dan: semanticTokens(global, read("packages/tokens/tokens/themes/dan.json")),
    noc: semanticTokens(global, read("packages/tokens/tokens/themes/noc.json")),
  };
}
