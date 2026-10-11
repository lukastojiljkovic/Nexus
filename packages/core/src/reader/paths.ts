/**
 * Where a relative link or image inside one article points (ADR-100).
 *
 * A pack's article is a file whose neighbours are the pack's other files, and the
 * address inside it is written the way a person writes one: relative to the page
 * it sits on. Two surfaces have to answer that question with the same rule - the
 * page, which draws the image, and main, which prints the document - so the rule
 * lives here rather than in either of them.
 *
 * **Why this refuses rather than clamping.** `../../../.ssh/id_rsa` under a `sub/`
 * folder is a path that leaves the pack, and a resolver that "safely" folded it
 * back into the pack root would be showing a file the author did not name. The
 * answer is nothing: the caller renders the link as its text and the image as its
 * alt. A fragment (`#odeljak`) answers `null` too - it names a place in this
 * article rather than a file - and so does an absolute path, which a pack has no
 * way to mean.
 *
 * The arithmetic is over the `/`-separated paths the manifest uses, deliberately
 * NOT `node:path`: a pack path's meaning may not depend on which platform is
 * reading it (ADR-091 §2).
 */

/** The path inside the pack a relative target names, or `null` when it names none. */
export function resolvePackPath(articlePath: string, target: string): string | null {
  // A query string names the same file; a fragment names a place in this article.
  const clean = target.split("?")[0] ?? "";
  if (clean.length === 0 || clean.startsWith("#") || clean.startsWith("/")) return null;
  const segments = articlePath.split("/");
  segments.pop();
  for (const segment of clean.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}
