// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both imported by `build.mjs` and driven by its own test.
//
// The half of the pack builder that is about *packs* rather than about fairy
// tales: the cache, the fetch, the folder layout, and the checks that the
// folder is the shape ADR-091's `content` layout 1 describes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { uniqueId } from "./markdown.mjs";

/** The one User-Agent every request goes out with, Wikimedia's policy included. */
export const USER_AGENT =
  "NexusPackBuilder/1.0 (https://github.com/lukastojiljkovic/Nexus; pack build; contact: repository issues)";

/** The date a source was fetched, in the one form `sources.json` records. */
export function isoDate(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * `<cache>/<pack id>/`, created on first use.
 *
 * The path is the repository's pack convention (`%TEMP%\nexus-pack-cache\<id>`),
 * which other runs' builders share, so it holds one directory per pack and
 * never a file named after the pack.
 */
export function cacheDirFor(packId, cacheRoot = join(process.env.TEMP ?? ".", "nexus-pack-cache")) {
  const dir = join(cacheRoot, packId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A source file, from the cache if it is there and from the network if it is
 * not.
 *
 * The cache is keyed by the file name `sources.json` names, not by a hash of
 * the URL: a stale entry is then a file somebody can recognise and delete, and
 * the SHA-256 in `sources.json` is what catches it changing underfoot.
 */
export async function fetchSource({ packId, cacheRoot, file, url, offline = false, delayMs = 250 }) {
  const dest = join(cacheDirFor(packId, cacheRoot), file);
  if (existsSync(dest)) {
    const bytes = readFileSync(dest);
    return { bytes, path: dest, cached: true, sha256: sha256(bytes) };
  }
  if (offline) {
    throw new Error(`tales: "${file}" is not in the cache and --offline was given.`);
  }
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`tales: ${url} answered ${String(response.status)}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, bytes);
  await new Promise((done) => setTimeout(done, delayMs));
  return { bytes, path: dest, cached: false, sha256: sha256(bytes) };
}

/**
 * One article file: its heading, the source's text, and the Source line the
 * content layout asks every article to end with.
 *
 * The line carries the URL as TEXT rather than as a markdown link: it is the
 * attribution a reader copies, not a control — the pages that draw a link do it
 * through the app's one door (ADR-107).
 */
export function articleFile({ title, markdown, sourceLine }) {
  return `# ${title}\n\n${markdown}\n\n---\n\n${sourceLine}\n`;
}

/**
 * Writes one pack folder: `content.json` and one file per article.
 *
 * Collections become the top-level entries and tales their children, which is
 * what „the TOC by collection" means in the format: the Reader draws the
 * collection as a group and each tale as an article under it.
 */
export function assemblePack({ id, language, collections, outDir }) {
  // The output folder is rebuilt from nothing, because a rebuild that only
  // overwrote what it wrote would keep the article of a tale that a corrected
  // contents list no longer names — and `checkPackShape` would then refuse the
  // pack for a file the previous run left behind. The guard is here because
  // what follows is a recursive delete: this deletes `<out>/<pack id>/articles`
  // and refuses to run unless the folder really is that pack's own.
  if (basename(outDir) !== id) {
    throw new Error(`tales: refusing to write the pack "${id}" into "${outDir}".`);
  }
  const articlesDir = join(outDir, "articles");
  rmSync(articlesDir, { recursive: true, force: true });
  mkdirSync(articlesDir, { recursive: true });
  const taken = new Set();
  const toc = [];
  const files = [];
  for (const collection of collections) {
    const children = [];
    for (const article of collection.articles) {
      const articleId = uniqueId(article.id, taken);
      const relative = `articles/${articleId}.md`;
      const body = articleFile({
        title: article.title,
        markdown: article.markdown,
        sourceLine: article.sourceLine,
      });
      writeFileSync(join(outDir, relative), body);
      files.push({ path: relative, bytes: Buffer.byteLength(body, "utf8") });
      children.push({
        id: articleId,
        title: article.title,
        file: relative,
        source: article.source,
      });
    }
    toc.push({ id: collection.id, title: collection.title, source: collection.source, children });
  }
  const content = { layout: 1, language, toc };
  const contentBytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
  writeFileSync(join(outDir, "content.json"), contentBytes);
  files.unshift({ path: "content.json", bytes: contentBytes.byteLength });
  return {
    id,
    files,
    toc,
    articles: files.length - 1,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

/**
 * Every rule of the content layout this builder can check about its own output.
 *
 * It runs on the real pack rather than only on a fixture, because a layout the
 * Reader cannot read is a pack that installs and then shows nothing, and every
 * check here is cheap.
 */
export function checkPackShape(dir) {
  const problems = [];
  const content = JSON.parse(readFileSync(join(dir, "content.json"), "utf8"));
  if (content.layout !== 1) problems.push(`content.json: layout is ${String(content.layout)}, not 1.`);
  if (content.language !== "sr" && content.language !== "en") {
    problems.push(`content.json: language is ${JSON.stringify(content.language)}.`);
  }
  if (content.notice !== undefined && content.notice !== "safety") {
    problems.push(`content.json: notice is ${JSON.stringify(content.notice)}.`);
  }
  const seen = new Set();
  const listed = new Set();
  const walk = (entries, path) => {
    for (const entry of entries) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) {
        problems.push(`${path}: id ${JSON.stringify(entry.id)} is not kebab-case.`);
      }
      if (seen.has(entry.id)) problems.push(`${path}: id ${JSON.stringify(entry.id)} repeats.`);
      seen.add(entry.id);
      if (typeof entry.title !== "string" || entry.title.trim() === "") {
        problems.push(`${path}/${String(entry.id)}: has no title.`);
      }
      if (entry.file !== undefined) checkArticle(dir, entry, path, listed, problems);
      if (Array.isArray(entry.children)) walk(entry.children, `${path}/${String(entry.id)}`);
    }
  };
  walk(content.toc, "");
  for (const name of readdirSync(join(dir, "articles"))) {
    if (!listed.has(`articles/${name}`)) problems.push(`articles/${name} is not listed in content.json.`);
  }
  if (problems.length > 0) {
    throw new Error(`tales: the pack in ${dir} breaks the content layout:\n  ${problems.join("\n  ")}`);
  }
  return { entries: seen.size, articles: listed.size };
}

/** One article: named after its id, no raw HTML, headed and footed as promised. */
function checkArticle(dir, entry, path, listed, problems) {
  listed.add(entry.file);
  const file = join(dir, entry.file);
  if (!existsSync(file)) {
    problems.push(`${path}/${String(entry.id)}: ${String(entry.file)} is missing.`);
    return;
  }
  const text = readFileSync(file, "utf8");
  if (entry.file !== `articles/${entry.id}.md`) {
    problems.push(`${path}/${String(entry.id)}: article file ${String(entry.file)} does not match its id.`);
  }
  if (/<[a-zA-Z/!?]/.test(text)) problems.push(`${path}/${String(entry.id)}: the article carries raw HTML.`);
  const lastLine = text.trimEnd().split("\n").at(-1) ?? "";
  if (!/^(\*Source:\*|\*Извор:\*)/.test(lastLine)) {
    problems.push(`${path}/${String(entry.id)}: the article does not end with a Source line.`);
  }
  if (!text.startsWith(`# ${entry.title}\n`)) {
    problems.push(`${path}/${String(entry.id)}: the article does not open with its title.`);
  }
}

/** `<out>/<id>.meta.json` beside the pack folder: what `pack-sign.mjs --meta` takes. */
export function writeMeta({ outDir, meta }) {
  const file = `${outDir}.meta.json`;
  writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return file;
}
