// No shebang, for the reason every other gate in this directory has none: this
// module is both a CLI (`node scripts/check-manual.mjs`) and an import target
// for its own tests.
//
// WHAT THIS GATE ENFORCES.
//
// The app manual is the assistant's knowledge of Nexus itself: one Markdown page
// per module, built-in page, Settings category and common task, in Serbian and
// English, read by the knowledge service and quoted back to the user as a
// citation. Three of its properties are structural and none of them is visible
// from the pages themselves:
//
//   - **The two languages are the SAME manual.** A page with an `sr` half and no
//     `en` half is a page half the users cannot read, and nothing about either
//     file says so; the ids are what pair them, so a pair that no longer matches
//     is the finding.
//   - **A `location` is a promise the app can keep.** `{ module: tasks }` means
//     the assistant may say "here it is" and open it. A module id that no
//     manifest declares — a typo, a module renamed by a later slice — promises a
//     place that does not open, and the user is the one who finds out.
//   - **A `related` id is a link.** An id that no page carries is a dead end in
//     the one surface whose whole job is finding your way.
//
// THE SHAPE, stated once (the format the knowledge run parses):
//
//     ---
//     id: tasks-recurring
//     title: Ponavljajući zadaci
//     location: { module: tasks }
//     keywords: [ponavljanje, recurring, svaki dan]
//     ---
//     Body text. ...
//
//   Povezano: tasks, calendar          (sr)
//   Related: tasks, calendar           (en)
//
// The related line is the LAST non-empty line of the body, and it is the one
// piece of the body this gate reads. It is in the body rather than the front
// matter on purpose: the front-matter keys are the contract the knowledge run
// parses, and a gate that added a sixth key to them would be changing somebody
// else's format to make its own check convenient.
//
// WHY THE VOCABULARY IS DERIVED, NOT LISTED. The two things a `location` may
// name — the module ids and the Settings categories — already exist in the tree
// as source: the manifests in `shared/modules.ts` and `modules/<id>/shared/`,
// and the `CategoryId` union in `shared/settingsSections.ts`. A hand-kept copy
// here would be right until the day a module is renamed, and a gate that fires
// on a stale list teaches people to ignore it. The one list this file does hold
// is `BUILT_IN_PAGES`, because the shell's non-module page ids exist as a single
// constant in `App.tsx` and nowhere as data; the test beside this file pins that
// list to the constant so it cannot quietly go stale either.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stripComments } from "./strip-comments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root — the same definition every gate in this directory uses. */
export const REPO_ROOT = join(HERE, "..");

/** Serbian first: it is the source locale, and the one the other is read against. */
export const MANUAL_LOCALES = ["sr", "en"];

/** Where the pages live, relative to the root. POSIX, because every finding is reported as a path. */
export const MANUAL_DIR = "apps/desktop/src/main/assistant/manual";

/**
 * The shell's pages that are not modules, and therefore the only non-module
 * values a `location.module` may carry.
 *
 * `search` is the whole list: it is `SEARCH_PAGE_ID` in `App.tsx`, a surface
 * with an id of its own that no manifest declares. The other shell screens — the
 * lock screen, the onboarding flow, the account picker — have no page of their
 * own and therefore no `location`, which is why a page about one omits the key
 * rather than naming a place the assistant cannot open.
 */
export const BUILT_IN_PAGES = ["search"];

/** The heading a page's last line uses to list the ids it is related to. */
export const RELATED_HEADINGS = { sr: "Povezano", en: "Related" };

/** Every id in this file — page ids and location values alike — is kebab-case. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The module ids `apps/desktop/src/shared/modules.ts` declares for the
 * compiled-in modules.
 *
 * The scan is bracketed to the `V0_MODULES` array rather than run over the whole
 * file, and that is the load-bearing half: every widget contract in that file
 * carries an `id` too (`danas`, `hitno-kasni`, `naplate`), and a whole-file scan
 * would report a dozen widget ids as modules. Inside the array the discriminator
 * is `prefix`, which a module declares and a widget never does — and it is the
 * discriminator rather than an indent, because one entry (`settings`) is written
 * on a single line and an indent-based rule would silently miss exactly the
 * module the Settings pages themselves name.
 */
export function compiledInModuleIds(source) {
  const text = stripComments(source);
  const start = text.indexOf("const V0_MODULES: ModuleManifest[] = [");
  if (start === -1) return [];
  const end = text.indexOf("\n];", start);
  const block = text.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/\bid: "([a-z0-9-]+)",\s*prefix:/g)].map((match) => match[1]);
}

/** The id a discovered module's manifest declares, or `null` for a file that declares none. */
export function kitModuleId(source) {
  // `prefix` beside the id, for `compiledInModuleIds`'s reason: a manifest's own
  // widget contracts carry ids of their own and appear above its declaration.
  // Comments are stripped first, because the house style puts one between the two.
  return /\bid: "([a-z0-9-]+)",\s*prefix:/.exec(stripComments(source))?.[1] ?? null;
}

/** The eight Settings categories, read off the `CategoryId` union the page itself is typed by. */
export function settingsCategoryIds(source) {
  const union = /export type CategoryId =([\s\S]*?);/.exec(source)?.[1] ?? "";
  return [...union.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
}

/** Every id a `location` may name, in the tree the gate is pointed at. */
export function knownVocabulary(root = REPO_ROOT) {
  const modulesSource = readFileSync(join(root, "apps", "desktop", "src", "shared", "modules.ts"), "utf8");
  const moduleIds = new Set(compiledInModuleIds(modulesSource));

  const kitRoot = join(root, "apps", "desktop", "src", "modules");
  for (const entry of readdirSync(kitRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(kitRoot, entry.name, "shared", "manifest.ts");
    if (!statSync(manifest, { throwIfNoEntry: false })?.isFile()) continue;
    const id = kitModuleId(readFileSync(manifest, "utf8"));
    if (id !== null) moduleIds.add(id);
  }

  const sectionsSource = readFileSync(
    join(root, "apps", "desktop", "src", "shared", "settingsSections.ts"),
    "utf8",
  );

  return {
    moduleIds,
    builtInPages: new Set(BUILT_IN_PAGES),
    settingsCategories: new Set(settingsCategoryIds(sectionsSource)),
  };
}

/** `{ module, settings }` from a `location:` value, or a message for a value that is not one. */
function parseLocation(value) {
  const inner = /^\{\s*(.*?)\s*\}$/.exec(value)?.[1];
  if (inner === undefined) return { error: "location must be `{ module: <id> }` or `{ module: <id>, settings: <category> }`" };
  const fields = new Map();
  for (const part of inner.split(",")) {
    const pair = /^\s*([a-z]+):\s*([a-z0-9-]+)\s*$/.exec(part);
    if (pair === null) return { error: `location entry \`${part.trim()}\` is not \`key: value\`` };
    if (pair[1] !== "module" && pair[1] !== "settings") {
      return { error: `location key \`${pair[1]}\` is neither \`module\` nor \`settings\`` };
    }
    fields.set(pair[1], pair[2]);
  }
  if (!fields.has("module")) return { error: "location has no `module`" };
  const settings = fields.get("settings");
  return { module: fields.get("module"), settings: settings ?? null };
}

/**
 * One page, parsed. Answers `{ page, findings }` and never throws: a malformed
 * page is the finding this gate exists to report, and a parser that threw would
 * turn the first bad page into a stack trace instead of a line in the list.
 */
export function parseManualPage(locale, source, file = "<memory>") {
  const findings = [];
  const fail = (line, message) => findings.push({ file, locale, line, message });
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") {
    return { page: null, findings: [...findings, { file, locale, line: 1, message: "the first line must be exactly `---`" }] };
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    return { page: null, findings: [...findings, { file, locale, line: 1, message: "the front matter is never closed by `---`" }] };
  }

  const fields = new Map();
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const pair = /^([a-z]+):\s*(.+?)\s*$/.exec(line);
    if (pair === null) {
      fail(index + 1, `\`${line.trim()}\` is not \`key: value\``);
      continue;
    }
    if (fields.has(pair[1])) {
      fail(index + 1, `\`${pair[1]}\` appears twice`);
      continue;
    }
    fields.set(pair[1], pair[2]);
  }

  for (const key of fields.keys()) {
    if (!["id", "title", "location", "keywords"].includes(key)) {
      fail(1, `unknown front-matter key \`${key}\``);
    }
  }

  const id = fields.get("id");
  if (id === undefined) fail(1, "no `id`");
  else if (!KEBAB.test(id)) fail(1, `id \`${id}\` is not kebab-case`);

  const title = fields.get("title");
  if (title === undefined || title === "") fail(1, "no `title`");

  let location = null;
  const rawLocation = fields.get("location");
  if (rawLocation !== undefined) {
    const parsed = parseLocation(rawLocation);
    if ("error" in parsed) fail(1, parsed.error);
    else location = { module: parsed.module, settings: parsed.settings };
  }

  const keywords = [];
  const rawKeywords = fields.get("keywords");
  const inner = rawKeywords === undefined ? undefined : /^\[(.*)\]$/.exec(rawKeywords)?.[1];
  if (rawKeywords === undefined) fail(1, "no `keywords`");
  else if (inner === undefined) fail(1, "`keywords` must be an inline list: `[a, b]`");
  else {
    for (const keyword of inner.split(",")) {
      const trimmed = keyword.trim();
      if (trimmed !== "") keywords.push(trimmed);
    }
    if (keywords.length === 0) fail(1, "`keywords` is empty");
  }

  const bodyStart = closing + 2;
  const body = lines.slice(closing + 1).join("\n").trim();
  if (body === "") fail(closing + 2, "the body is empty");

  // The related line is the last non-empty line of the body. Its heading is the
  // page's own language, so a Serbian page that says `Related:` is a finding —
  // the two halves are read by different readers, and the copy is not shared.
  const related = [];
  const bodyLines = lines.slice(closing + 1).filter((line) => line.trim() !== "");
  const last = bodyLines[bodyLines.length - 1];
  const heading = RELATED_HEADINGS[locale];
  if (last === undefined) {
    // Already reported as an empty body.
  } else if (!last.startsWith(`${heading}:`)) {
    fail(lines.length, `the body's last line must be \`${heading}: <id>, <id>\``);
  } else {
    for (const entry of last.slice(heading.length + 1).split(",")) {
      const relatedId = entry.trim().replace(/\.$/, "");
      if (relatedId === "") continue;
      if (!KEBAB.test(relatedId)) fail(bodyStart, `related id \`${relatedId}\` is not kebab-case`);
      else related.push(relatedId);
    }
    if (related.length === 0) fail(bodyStart, `\`${heading}:\` lists no id`);
  }

  return {
    page: { locale, file, id: id ?? null, title: title ?? null, location, keywords, related, body },
    findings,
  };
}

/** Every page under one locale's folder, in file order. A missing folder is one finding. */
export function readManualLocale(root, locale) {
  const findings = [];
  const dir = join(root, ...MANUAL_DIR.split("/"), locale);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return { pages: [], findings: [{ file: `${MANUAL_DIR}/${locale}`, locale, line: 1, message: "no pages" }] };
  }
  if (names.length === 0) {
    findings.push({ file: `${MANUAL_DIR}/${locale}`, locale, line: 1, message: "no pages" });
  }
  const pages = [];
  for (const name of names) {
    const file = `${MANUAL_DIR}/${locale}/${name}`;
    const parsed = parseManualPage(locale, readFileSync(join(dir, name), "utf8"), file);
    findings.push(...parsed.findings);
    if (parsed.page !== null) pages.push(parsed.page);
  }
  return { pages, findings };
}

/** Every page of both locales. */
export function readManual(root = REPO_ROOT) {
  const findings = [];
  const pages = [];
  for (const locale of MANUAL_LOCALES) {
    const read = readManualLocale(root, locale);
    findings.push(...read.findings);
    pages.push(...read.pages);
  }
  return { pages, findings };
}

/**
 * The four cross-page rules, over pages that already parsed: unique ids, ids
 * paired across the two languages, a location the app can honour, and related
 * ids that exist.
 */
export function validateManual(pages, vocabulary) {
  const findings = [];
  const byLocale = new Map(MANUAL_LOCALES.map((locale) => [locale, new Map()]));
  for (const page of pages) {
    if (page.id === null) continue;
    const seen = byLocale.get(page.locale);
    if (seen.has(page.id)) {
      findings.push({ file: page.file, locale: page.locale, line: 1, message: `id \`${page.id}\` appears twice in \`${page.locale}\`` });
      continue;
    }
    seen.set(page.id, page);
  }

  const [sr, en] = MANUAL_LOCALES.map((locale) => byLocale.get(locale));
  for (const [id, page] of sr) {
    if (!en.has(id)) findings.push({ file: page.file, locale: "sr", line: 1, message: `\`${id}\` has no \`en\` page` });
  }
  for (const [id, page] of en) {
    if (!sr.has(id)) findings.push({ file: page.file, locale: "en", line: 1, message: `\`${id}\` has no \`sr\` page` });
  }

  const everyId = new Set([...sr.keys(), ...en.keys()]);
  for (const page of pages) {
    if (page.location !== null) {
      const { module, settings } = page.location;
      if (!vocabulary.moduleIds.has(module) && !vocabulary.builtInPages.has(module)) {
        findings.push({ file: page.file, locale: page.locale, line: 1, message: `location.module \`${module}\` is not a module id or built-in page` });
      }
      if (settings !== null && !vocabulary.settingsCategories.has(settings)) {
        findings.push({ file: page.file, locale: page.locale, line: 1, message: `location.settings \`${settings}\` is not a Settings category` });
      }
    }
    for (const relatedId of page.related) {
      if (!everyId.has(relatedId)) {
        findings.push({ file: page.file, locale: page.locale, line: 1, message: `related id \`${relatedId}\` is not a page` });
      }
    }
  }

  return findings;
}

/** The whole run: parse both locales, then apply the cross-page rules. */
export function scanRepo(root = REPO_ROOT) {
  const { pages, findings } = readManual(root);
  const vocabulary = knownVocabulary(root);
  const all = [...findings, ...validateManual(pages, vocabulary)];
  return {
    findings: all,
    census: {
      pages: MANUAL_LOCALES.map((locale) => pages.filter((page) => page.locale === locale).length),
      ids: new Set(pages.map((page) => page.id)).size,
      relatedEdges: pages.reduce((total, page) => total + page.related.length, 0),
      moduleIds: vocabulary.moduleIds.size,
      settingsCategories: vocabulary.settingsCategories.size,
    },
  };
}

function main() {
  const { findings, census } = scanRepo();
  const [srPages, enPages] = census.pages;
  const line =
    `check-manual: ${srPages} sr + ${enPages} en page(s), ${census.ids} paired id(s), ` +
    `${census.relatedEdges} related link(s), against ${census.moduleIds} module id(s) and ` +
    `${census.settingsCategories} Settings categor(y|ies).`;
  if (findings.length > 0) {
    console.error(`check-manual: ${findings.length} finding(s).\n`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  [${finding.locale}]  ${finding.message}`);
    }
    console.error(
      "\nThe manual is read by the assistant and quoted back as a citation, so a page\n" +
        "that names a place, an id or a category the app does not have teaches the user\n" +
        "something false. Fix the page, or add the missing module to the tree.",
    );
    process.exit(1);
  }
  console.log(line);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
