/**
 * ZIM paths: what one is, what may appear in a URL, and the two conversions
 * between them.
 *
 * A ZIM entry's name is `namespace + "/" + path`: one namespace character
 * (`A` articles, `C` the format-6 article namespace, `I` images, `M` metadata,
 * `X` listings and indexes, `-` layout assets, `W` full-text index), then the
 * path the file itself carries — which may contain slashes of its own
 * (`I/m/115a…png` is one image in one subdirectory of the `I` namespace).
 *
 * **Everything here is one-directional on purpose.** This module turns a
 * *page-supplied* string into a ZIM path and back into a URL; it never guesses
 * a namespace, never repairs a path and never decodes twice, because the two
 * things it is between are a URL that a page can write and a file lookup that
 * must land on exactly one entry. A path with `..` in it, a path with a
 * backslash (a separator on this platform and not in the format), a path with a
 * control character or an over-long one is refused — the same classes
 * `packPathProblem` refuses for a pack, for the same reason.
 *
 * **Why the encoder exists at all.** `nx-zim://` is registered `standard`, so
 * Chromium parses it as a URL: a Serbian or Cyrillic title in an `src` has to be
 * percent-encoded or the request arrives mangled. Each SEGMENT is encoded and
 * the separators are left alone, which is the shape `decodeURIComponent` reverses
 * exactly once.
 */

/** The namespace characters the format defines; anything else is not a ZIM path. */
export const ZIM_NAMESPACES = ["-", "A", "B", "C", "I", "M", "X", "W"] as const;

/** The longest ZIM path this app will accept, in characters. Longest real path in the fixture: 60. */
export const MAX_ZIM_PATH_CHARS = 512;

export type ZimPathProblem =
  | "not-a-string"
  | "empty"
  | "too-long"
  | "control"
  | "backslash"
  | "no-namespace"
  | "bad-namespace"
  | "empty-path"
  | "dot-segment";

/** The rule `value` breaks, or `null` when it is a ZIM path. */
export function zimPathProblem(value: unknown): ZimPathProblem | null {
  if (typeof value !== "string") return "not-a-string";
  if (value === "") return "empty";
  if (value.length > MAX_ZIM_PATH_CHARS) return "too-long";
  // eslint-disable-next-line no-control-regex -- the C0 range IS the point of this check.
  if (/[\u0000-\u001f\u007f]/.test(value)) return "control";
  if (value.includes("\\")) return "backslash";
  if (value.startsWith("/")) return "no-namespace";
  const separator = value.indexOf("/");
  if (separator !== 1) return "no-namespace";
  const namespace = value.slice(0, 1);
  if (!(ZIM_NAMESPACES as readonly string[]).includes(namespace)) return "bad-namespace";
  const path = value.slice(separator + 1);
  if (path === "") return "empty-path";
  // `..` anywhere is refused, in any position: a ZIM path is looked up in a
  // file, never joined onto a directory, so the only thing a dot segment can do
  // here is confuse the layer above this one (which DOES join it onto a URL).
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "..") return "dot-segment";
  }
  return null;
}

export function isZimPath(value: unknown): boolean {
  return zimPathProblem(value) === null;
}

/**
 * A ZIM path as its two parts. Only ever called after {@link isZimPath} has
 * answered `null`: it splits, it does not validate.
 */
export function splitZimPath(path: string): { namespace: string; path: string } {
  const separator = path.indexOf("/");
  return { namespace: path.slice(0, separator), path: path.slice(separator + 1) };
}

export function joinZimPath(namespace: string, path: string): string {
  return `${namespace}/${path}`;
}

/**
 * A ZIM path as the path part of an `nx-zim://` URL — leading slash, each
 * segment percent-encoded, separators kept.
 */
export function zimUrlPath(path: string): string {
  return `/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The reverse: the path part of a request, back to a ZIM path, or `null` when
 * the URL is not one this app will serve.
 *
 * The single `decodeURIComponent` call is the whole point of the function's
 * existence: a caller that decoded and then split would accept `%2f` as a
 * separator, and `%2e%2e` as a dot segment, which is how a path rule is
 * defeated by the encoding rather than by the shape. So the decode happens
 * FIRST and the rules are then applied to the decoded string — which is the
 * string the file lookup will use.
 */
export function zimPathFromUrlPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const trimmed = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  return isZimPath(trimmed) ? trimmed : null;
}
