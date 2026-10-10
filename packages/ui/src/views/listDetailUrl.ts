import { useCallback, useEffect, useState } from "react";

/**
 * The selection a master-detail surface keeps in the URL, in the only place an
 * Electron renderer has one: the fragment.
 *
 * WHY THE URL AT ALL. A selection that lives only in component state is lost
 * the moment the page is reloaded, and — more to the point — it cannot be
 * named. `#sel=n-1043` is a row somebody can be sent back to; a `useState` is
 * not. The house had no URL state before this module (the renderer has no
 * router, and every page so far has kept its selection in `useState`), so this
 * states the convention rather than reading one: ONE key per surface, appended
 * to whatever fragment is already there, left alone by every other part of the
 * app.
 *
 * THE FRAGMENT, NOT THE QUERY. Only the fragment can change under `file://`
 * without a navigation, which is what the packaged app loads — so a query
 * string would work in development and fail in the one build that ships.
 */

/** `#key=value`, `&`-separated, with both halves percent-encoded. */

/**
 * The selection `hash` holds under `key`, or `null` when it holds none.
 *
 * A pair with an EMPTY value is read as "no selection" rather than as the empty
 * string, because an empty id is not a row: `#sel=` is what is left behind when
 * a selection is cleared by hand, and reading it as an id would send a lookup
 * after a row that cannot exist.
 */
export function readSelection(hash: string, key: string): string | null {
  const pairs = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of pairs.split("&")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    if (decode(pair.slice(0, at)) !== key) continue;
    const value = decode(pair.slice(at + 1));
    return value === "" ? null : value;
  }
  return null;
}

/**
 * `hash` with the selection under `key` set to `id`, or with the pair removed
 * when `id` is `null`.
 *
 * Every other pair keeps its place and its spelling: this function edits one
 * key of somebody else's state, so a page that also keeps a filter here does
 * not lose it and a fragment written by hand is not reformatted. Appending is
 * the fallback, which is why a surface's key appears at the end of the fragment
 * the first time it is used.
 */
export function writeSelection(hash: string, key: string, id: string | null): string {
  const pairs: string[] = [];
  let written = false;
  for (const pair of (hash.startsWith("#") ? hash.slice(1) : hash).split("&")) {
    // An empty piece is what a trailing or doubled `&` leaves behind. A piece
    // with no `=` at all is not one of this module's pairs — it is somebody
    // else's fragment (`#/route`, a hand-typed word) — and it is kept verbatim.
    const at = pair.indexOf("=");
    if (pair === "" || at === -1 || decode(pair.slice(0, at)) !== key) {
      if (pair !== "") pairs.push(pair);
      continue;
    }
    // The first pair under this key takes the new value in the place the old
    // one stood; a second copy of the key collapses into it, so a fragment that
    // somehow holds the pair twice cannot keep reading back the stale side.
    if (!written && id !== null) {
      pairs.push(`${encode(key)}=${encode(id)}`);
      written = true;
    }
  }
  if (!written && id !== null) pairs.push(`${encode(key)}=${encode(id)}`);
  return pairs.length === 0 ? "" : `#${pairs.join("&")}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A fragment somebody typed can hold a stray `%` — `#a=100%` — and
    // `decodeURIComponent` throws on it. The raw text is still the best answer
    // available, and throwing would take the whole page down over a URL.
    return value;
  }
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The selection, backed by the fragment: the URL is read once, followed on
 * `hashchange` (so back and forward work, and a link pasted into a second
 * window lands on the same row), and written with `replaceState` — replacing
 * rather than pushing, because walking a list is not navigating and a history
 * entry per arrow key would make the back button useless.
 */
export function useListDetailSelection(key: string): readonly [string | null, (id: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readSelection(window.location.hash, key),
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onHashChange = () => {
      setSelectedId(readSelection(window.location.hash, key));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [key]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (typeof window === "undefined") return;
      const next = writeSelection(window.location.hash, key, id);
      const url = `${window.location.pathname}${window.location.search}${next}`;
      try {
        window.history.replaceState(null, "", url);
      } catch {
        // Some hosts refuse `replaceState` on an opaque origin. The hash is
        // still the page's own, so the assignment below is the same statement
        // one API further down — and unlike `replaceState` it cannot throw.
        window.location.hash = next;
      }
    },
    [key],
  );

  return [selectedId, select] as const;
}
