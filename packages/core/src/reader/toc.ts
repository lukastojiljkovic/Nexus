/**
 * The Reader's table of contents: a pack's articles as the tree their paths
 * already describe, and the reading order that tree implies.
 *
 * **A content pack's structure is its folders.** Every `.md` file in a pack is
 * an article and every folder is a chapter heading, so the pack author writes
 * the book's shape with the same two things they write everything else with. No
 * index file is needed and none is invented: an index would be a second place
 * the structure is written down, and the first thing to disagree with the files
 * beside it.
 *
 * **Order is a number when the author gave one, and the Serbian collator
 * otherwise.** A path segment may open with up to four digits (`03-treca.md`)
 * and that number is the entry's order, which is how a book that must not be
 * sorted alphabetically - a legal code, a course - says so without renaming its
 * files. Everything else is compared as it is displayed, through
 * `Intl.Collator(["sr-Latn", "sr"])`: plain `"sr"` mis-tailors š/č/ć/ž, and a
 * pack's chapter called „Šume" would sort after „Sneg" without it.
 *
 * **This module is pure.** It takes the paths and the titles and answers a tree;
 * reading the files, parsing them for their titles and caching the result is the
 * service's job.
 */

export interface ReaderArticleEntry {
  /** The article's path inside the pack, `/`-separated, exactly as the manifest lists it. */
  readonly path: string;
  /** The article's title, already read from its first heading. */
  readonly title: string;
}

export interface ReaderTocNode {
  /** `chapter` for a folder, `article` for a leaf. */
  readonly kind: "chapter" | "article";
  /**
   * The navigation key: an article's own path, or a chapter's folder path with a
   * trailing `/`. The trailing slash is what keeps a chapter and an article of
   * the same name two nodes rather than one.
   */
  readonly id: string;
  readonly title: string;
  readonly children: readonly ReaderTocNode[];
}

/** The Serbian Latin collator this whole module orders with, on the store's own terms. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

interface OrderedSegment {
  readonly order: number;
  /** The raw segment, kept only to break a tie between two entries spelt the same way once displayed. */
  readonly collated: string;
  readonly name: string;
}

/**
 * A path segment, split into its order key, its display name and the string the
 * collator compares.
 *
 * A segment with no number sorts AFTER every numbered one (`Number.POSITIVE_INFINITY`),
 * which is the honest reading of a mixed pack: the author numbered the part they
 * cared about the order of, and the rest follows it.
 */
export function readerDisplayName(segment: string): OrderedSegment {
  const match = /^(\d{1,4})[-_. ]?(.*)$/.exec(segment);
  const digits = match?.[1];
  const rest = match?.[2];
  const order = digits === undefined ? Number.POSITIVE_INFINITY : Number.parseInt(digits, 10);
  const base = (digits === undefined ? segment : (rest ?? "")).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    order,
    name: base.length === 0 ? segment : capitalise(base),
    collated: segment,
  };
}

/** The first letter upper, the rest untouched: a folder name is a file name, and a TOC row is copy. */
function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function compareEntries(left: OrderedSegment, right: OrderedSegment): number {
  if (left.order !== right.order) return left.order < right.order ? -1 : 1;
  const byName = COLLATOR.compare(left.name, right.name);
  if (byName !== 0) return byName;
  // Two entries with one display name and one order are still two entries: the
  // raw segment breaks the tie, so the tree is a total order and two runs of the
  // same pack draw the same page.
  return COLLATOR.compare(left.collated, right.collated);
}

/**
 * The tree of one pack's articles.
 *
 * Articles are inserted into the folders their paths name, deepest first, so a
 * chapter is created by the articles under it rather than by a second walk that
 * has to agree with the first. A path is assumed to be a real pack path (the
 * manifest's own rules refused everything else before it ever got here); a
 * segment that is empty is dropped rather than turned into a nameless chapter.
 */
export function buildReaderToc(entries: readonly ReaderArticleEntry[]): ReaderTocNode[] {
  interface Bucket {
    readonly name: string;
    readonly key: OrderedSegment;
    readonly folders: Map<string, Bucket>;
    readonly leaves: { readonly key: OrderedSegment; readonly node: ReaderTocNode }[];
  }

  const root: Bucket = { name: "", key: readerDisplayName(""), folders: new Map(), leaves: [] };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter((segment) => segment.length > 0);
    const file = segments.pop();
    if (file === undefined) continue;
    let bucket = root;
    for (const segment of segments) {
      let child = bucket.folders.get(segment);
      if (child === undefined) {
        child = { name: segment, key: readerDisplayName(segment), folders: new Map(), leaves: [] };
        bucket.folders.set(segment, child);
      }
      bucket = child;
    }
    bucket.leaves.push({
      key: readerDisplayName(file.replace(/\.md$/i, "")),
      node: { kind: "article", id: entry.path, title: entry.title, children: [] },
    });
  }

  const materialise = (bucket: Bucket, prefix: string): ReaderTocNode[] => {
    const children: { readonly key: OrderedSegment; readonly node: ReaderTocNode }[] = [];
    for (const child of bucket.folders.values()) {
      const path = prefix === "" ? child.name : `${prefix}/${child.name}`;
      children.push({
        key: child.key,
        node: { kind: "chapter", id: `${path}/`, title: child.key.name, children: materialise(child, path) },
      });
    }
    for (const leaf of bucket.leaves) children.push(leaf);
    children.sort((left, right) => compareEntries(left.key, right.key));
    return children.map((child) => child.node);
  };

  return materialise(root, "");
}

/** Every article path in the tree, in the order a person reads them: depth first, chapters before their leaves' siblings. */
export function readerReadingOrder(toc: readonly ReaderTocNode[]): readonly string[] {
  const order: string[] = [];
  const walk = (nodes: readonly ReaderTocNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "article") order.push(node.id);
      else walk(node.children);
    }
  };
  walk(toc);
  return order;
}

/** The article before and after `path` in reading order; `null` at either end of the pack. */
export function neighbouringArticles(
  order: readonly string[],
  path: string,
): { readonly previous: string | null; readonly next: string | null } {
  const at = order.indexOf(path);
  if (at === -1) return { previous: null, next: null };
  return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null };
}

/**
 * The articles a print scope covers: one article (`articleId` names a leaf), a
 * chapter and everything under it (`articleId` names a chapter), or the whole
 * pack (`null`). Answered from the tree rather than from a path prefix, so a
 * chapter's scope is exactly the nodes the reader can see under it.
 */
export function articlesForScope(
  toc: readonly ReaderTocNode[],
  articleId: string | null,
): readonly string[] {
  if (articleId === null) return readerReadingOrder(toc);
  const collect = (nodes: readonly ReaderTocNode[]): readonly string[] | null => {
    for (const node of nodes) {
      if (node.id === articleId) return node.kind === "article" ? [node.id] : readerReadingOrder(node.children);
      const inner = collect(node.children);
      if (inner !== null) return inner;
    }
    return null;
  };
  return collect(toc) ?? [];
}
