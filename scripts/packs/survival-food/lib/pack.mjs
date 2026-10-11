// The pack on disk: `content.json` and its articles, `recipes.json` and its
// recipes, and the metadata `scripts/pack-sign.mjs` signs.
//
// ADR-091 fixes the shape and this module does not invent any of it: the folder
// holds `pack.json` and `pack.json.sig` (written by the signing tool, never
// here) plus the files the manifest lists. What is written here is only the
// content half, and `collectFiles` in the signing tool is what computes the
// hashes, so there is no second opinion about what a pack contains.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A `content` pack (layout 1).
 *
 * `toc` is the Reader's tree; `articles` maps an id to `{ markdown, figures }`,
 * where a figure is `{ name, data }` and is written under `images/`. The pack's
 * own `language` is `en`: every article is the English text of an English
 * source, and the pack says so rather than letting the Reader guess. The Serbian
 * safety notice a `"safety"` pack must show is the shell's, not this folder's.
 */
export function writeContentPack({ dir, articles, toc, notice, language = "en" }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "articles"), { recursive: true });
  mkdirSync(join(dir, "images"), { recursive: true });
  const content = { layout: 1, language, toc };
  if (notice !== undefined) content.notice = notice;
  writeFileSync(join(dir, "content.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
  const written = [];
  for (const [id, article] of Object.entries(articles)) {
    const file = `articles/${id}.md`;
    writeFileSync(join(dir, file), article.markdown, "utf8");
    written.push(file);
    for (const figure of article.figures ?? []) {
      writeFileSync(join(dir, "images", figure.name), figure.data);
      written.push(`images/${figure.name}`);
    }
  }
  return written;
}

/**
 * A `dataset` pack (layout 1): the Cookbook's `recipes.json`.
 *
 * `steps` are the guide's own sentences, in the guide's own order and with the
 * guide's own words; `ingredients` are the guide's own ingredient lines. Nothing
 * here is a rewrite — the licence beside the recipe is provenance and the
 * attribution is the sentence the licence obliges.
 */
export function writeDatasetPack({ dir, recipes }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipes.json"),
    `${JSON.stringify({ layout: 1, recipes }, null, 2)}\n`,
    "utf8",
  );
  return ["recipes.json"];
}

/** The `--meta` file `scripts/pack-sign.mjs` reads: everything except `files`. */
export function writeMetadata(file, meta) {
  writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
