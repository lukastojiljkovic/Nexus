/**
 * Where a JSX opening tag ends — which is not where a regex thinks it does.
 *
 * `/<input[^>]*>/` ends the element at the FIRST `>`, and in this codebase that
 * `>` is almost always the arrow inside `onChange={(event) => …}` — before the
 * `className` that decides whether the element is a finding. The failure is
 * silent in both directions: `check:controls` would have reported four correct
 * radios in `PrivPage.tsx`, and `check:tiers` would have MISSED any paragraph
 * whose handler is written before its class, which is a gate that reports
 * nothing and looks exactly like a gate that found nothing.
 *
 * The closing `>` is the one at brace depth zero outside a string. That also
 * makes attribute order irrelevant — `className` may sit before or after
 * `type`, and the props may be spread over nine lines, as they are in every
 * real instance.
 *
 * This lives here rather than inside either gate because both need it, and a
 * scanner copied by hand is a scanner that gets fixed in one of the two places.
 */

/**
 * Every element in `source` whose tag matches `tag`, as the text from `<` to
 * the `>` that closes that opening tag.
 *
 * `tag` is a regular expression matched against the tag name alone, so a
 * pattern of `input` takes one element type and a lowercase-initial name
 * pattern takes every intrinsic one. It is not written out here as a literal,
 * because a character class ending in a star would close this comment. A
 * capital initial is a React component, whose rendered tag this cannot see and
 * must not guess at.
 *
 * @param {string} source
 * @param {RegExp} tag
 * @returns {Generator<{ start: number, name: string, text: string }>}
 */
export function* jsxElements(source, tag) {
  const opening = new RegExp(`<(${tag.source})\\b`, "g");
  for (const match of source.matchAll(opening)) {
    const start = match.index;
    let i = start + match[0].length;
    let depth = 0;
    let quote = null;
    while (i < source.length) {
      const ch = source[i];
      if (quote !== null) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        i += 1;
        break;
      }
      i += 1;
    }
    yield { start, name: match[1], text: source.slice(start, i) };
  }
}
