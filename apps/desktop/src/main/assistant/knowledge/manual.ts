import { contentMarker, parseMarkdownUnits, parsePage } from "./markup.js";
import type { IndexedDocument, ManualPage } from "./types.js";

/**
 * The app manual as a source: the Markdown pages that ship inside this build.
 *
 * **Bundled, not read from disk.** The pages are the application's own
 * documentation, versioned with the code, so they arrive the way every other
 * compiled-in asset does - through a `?raw` glob that Vite (and Vitest, which
 * resolves the same glob) turns into the text at build time. Nothing at runtime
 * opens a file, which is what lets the manual be explained by an assistant that
 * is not allowed to read arbitrary paths, and what makes "which manual is this
 * page from" a question with exactly one answer: the one in the binary.
 *
 * **The front matter is the citation.** `id` names the page, `title` is what a
 * citation reads as, and `location` is where opening it takes the user - the
 * whole point of explaining the app from inside the app is that a page can end
 * in "open Settings > Data". A page whose front matter is missing or incomplete
 * is still indexed, under the file's own name and its first heading: a manual
 * page that has not been finished is a page the assistant should be able to
 * point at, not a page that vanishes from the answer.
 *
 * **The id carries the locale, and that is not cosmetic.** `Citation` has no
 * locale field, and the manual ships every page in `sr` and `en`, so the only
 * way a citation stays unambiguous about which page it means is for the id to
 * say so (`sr/podesavanja`). It is also the storage identity, which is what makes
 * re-indexing the Serbian page leave the English one alone.
 */

/**
 * The pages Vite inlined. The value's shape is Vite's: an eager `?raw` glob
 * yields the module namespace (whose `default` is the text) unless the caller
 * asked for the default import, and both have been seen in this tree - so this
 * one helper reads either rather than a cast asserting one.
 */
const BUNDLED_MANUAL: Record<string, unknown> = import.meta.glob("../manual/*/*.md", {
  query: "?raw",
  eager: true,
});

/** The text of one glob entry, whichever of the two shapes Vite produced. */
function rawText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const fallback = (value as { default?: unknown }).default;
    if (typeof fallback === "string") return fallback;
  }
  return null;
}

/** The locales the manual ships, and the only directory names it may have. */
const MANUAL_LOCALES: readonly string[] = ["sr", "en"];

/**
 * The bundled pages, sorted by path.
 *
 * The sort is not decoration: the indexing pass walks these in order, and a
 * directory listing is not required to be stable. Sorted, the same build
 * produces the same passages at the same ordinals on every machine.
 */
export function bundledManualPages(): ManualPage[] {
  return Object.entries(BUNDLED_MANUAL)
    .map(([path, value]) => {
      const text = rawText(value);
      return text === null ? null : { path: path.replace(/^\.\.\//, "assistant/"), text };
    })
    .filter((page): page is ManualPage => page !== null)
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** The file's own name without its extension - the fallback id for a page whose front matter is incomplete. */
function stemOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/**
 * One page as a document, or `null` when the path is not a manual page this
 * build reads (a stray directory under `manual/`, a file that is not `.md`).
 */
export function manualDocument(page: ManualPage): IndexedDocument | null {
  const segments = page.path.split("/");
  const locale = segments.length >= 2 ? (segments[segments.length - 2] ?? "") : "";
  if (!MANUAL_LOCALES.includes(locale)) return null;

  const parsed = parsePage(page.text);
  const scalars = parsed.frontMatter?.scalars;
  const lists = parsed.frontMatter?.lists;
  const id = scalars?.get("id") ?? stemOf(page.path);
  const heading = parseMarkdownUnits(parsed.body)[0]?.headings[0];
  const title = scalars?.get("title") ?? heading ?? id;
  const module = scalars?.get("location.module");
  const settings = scalars?.get("location.settings");
  const keywords = lists?.get("keywords") ?? [];

  const document: {
    kind: "app-manual";
    id: string;
    locale: "sr" | "en";
    title: string;
    text: string;
    keywords?: readonly string[];
    location?: { module: string; settings?: string };
    marker: string;
  } = {
    kind: "app-manual",
    id: `${locale}/${id}`,
    locale: locale === "en" ? "en" : "sr",
    title,
    text: parsed.body,
    marker: contentMarker([page.text]),
  };
  if (keywords.length > 0) document.keywords = keywords;
  if (module !== undefined) {
    document.location = settings === undefined ? { module } : { module, settings };
  }
  return document;
}
