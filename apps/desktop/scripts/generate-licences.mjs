// Regenerates `src/renderer/src/data/licences.json` — the third-party notices
// the shipped product owes, and the only thing the „Licence" settings card
// reads. Run it with `pnpm --filter @nexus/desktop licences`.
//
// WHY A GENERATOR. Every permissive licence Nexus depends on (MIT, BSD,
// Apache-2.0, OFL) imposes one obligation that actually binds a CLOSED-SOURCE
// product: reproduce the notice. A hand-written list pays that obligation once
// and then rots on the next `pnpm update`. So no character of a notice is ever
// typed here: each is READ from a file that exists on disk, and the file is
// regenerated whenever the dependency set moves. `licences.test.ts` is the gate
// that a regenerated file is still fit to ship.
//
// SCOPING RULE — what a user receives, and nothing else:
//   1. Every transitive PRODUCTION dependency of `@nexus/desktop`, as
//      `pnpm licenses list --prod --json --filter @nexus/desktop...` reports
//      it. The trailing `...` is what makes it transitive across the
//      workspace: without it pnpm stops at `@nexus/core` and `@nexus/db`, and
//      their own dependencies (bundled into the app all the same) get no
//      notice. `@nexus/desktop` is the only app packaged; `@nexus/gallery` is
//      the design-review surface and never ships.
//      Over-inclusive on purpose: a module that Vite tree-shakes out of the
//      bundle still gets its notice, because proving absence per module is not
//      something a build can honestly assert.
//   2. MINUS type-only packages (`@types/*`), whose `.d.ts` files are erased by
//      the compiler and reach no artifact — the one exclusion where absence IS
//      provable.
//   3. MINUS the `@nexus/*` workspace packages, which are ours.
//   4. PLUS the Electron runtime. It is declared as a devDependency, so the
//      rule above misses it, yet electron-builder copies the whole runtime into
//      the installer — it demonstrably ships, so it demonstrably owes a notice.
//   5. PLUS the font families `electron.vite.config.ts` copies into the built
//      renderer. They are files in an installer, not npm packages, and nothing
//      in the dependency graph knows they exist.
// Build and test tooling (vite, vitest, eslint, typescript, electron-builder,
// turbo) is excluded: it never reaches a user, so no notice is owed.
//
// WHERE FONT NOTICES COME FROM. Excalidraw ships no licence file — not for
// itself and not for the eight font families it bundles — so the fonts' notices
// are read out of the shipped `.woff2` files themselves: the OpenType `name`
// table carries the copyright (ID 0), the licence text (ID 13) and the licence
// URL (ID 14). Two families keep no licence text of their own but the package's
// TypeScript source does (a cn-font-split header preserved in the dev source
// map), which is read as a second on-disk source. Where a family declares OFL
// but carries no copy of it, the standard OFL 1.1 text is taken from
// `Virgil-Regular.woff2`'s own name table — verified byte-identical to the copy
// in `fonts/Excalifont/index.ts`, two independent copies inside the same
// package. Every entry records exactly which file it was read from.
//
// DETERMINISM. Same node_modules in, byte-identical file out: entries are
// keyed and sorted by codepoint, every text is normalised to LF with the BOM
// stripped, and nothing observes the clock, the platform or the filesystem's
// directory order.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const require = createRequire(import.meta.url);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SCRIPTS_DIR, "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");
const OUTPUT = join(APP_ROOT, "src", "renderer", "src", "data", "licences.json");

/** LF, no BOM, no trailing blank — the shape every notice is stored in. */
function normalise(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
}

/**
 * A provenance string is always relative to the PACKAGE it names, never to the
 * repository: pnpm's store directory carries a peer-dependency hash that moves
 * between installs, and an entry's own name and version already say which
 * package the path is inside.
 */
function within(packageDir, absolutePath) {
  return relative(packageDir, absolutePath).split(sep).join("/");
}

// --- 1. the npm packages ------------------------------------------------------

/**
 * pnpm's own entry point, when the process that launched this one is pnpm.
 *
 * `npm_execpath` names the package manager that STARTED this process, and it is
 * not a synonym for pnpm. Under `pnpm test` it is pnpm's `.cjs` entry, which
 * `process.execPath` executes directly — no `.cmd` and no `shell: true`, which
 * is what keeps the call identical on Windows and CI. Under `npx vitest` it is
 * npm's `cli.js`, and the call below then runs `npm licenses list --prod --json
 * --filter @nexus/desktop`: npm has no `--filter`, so it exits 1, and the
 * message that comes out accuses pnpm of a failure npm caused. Measured, not
 * reasoned — the whole scripts suite is red under `npx vitest` and green under
 * `pnpm test`, from this one branch.
 *
 * `dnpm` and `pnpmx` would pass the test below, and that is deliberate: the
 * question is which package manager is running, and a name check that demanded
 * an exact string would be a list to keep. What it must not do is accept npm.
 */
function pnpmEntry() {
  const execpath = process.env.npm_execpath;
  return execpath !== undefined && /pnpm/i.test(execpath) ? execpath : null;
}

/**
 * `pnpm licenses list --prod --json`, run through Node rather than a shell
 * whenever the launcher is pnpm (see `pnpmEntry` above), and through the `pnpm`
 * binary otherwise.
 */
function pnpmLicences() {
  const viaNode = pnpmEntry();
  const options = { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };
  const args = ["licenses", "list", "--prod", "--json", "--filter", "@nexus/desktop..."];
  const result = viaNode
    ? spawnSync(process.execPath, [viaNode, ...args], options)
    : spawnSync("pnpm", args, { ...options, shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`pnpm licenses failed (${result.status}):\n${result.stderr ?? ""}`);
  }
  return JSON.parse(normalise(result.stdout));
}

/**
 * A package's own licence files, in name order. Concatenated rather than
 * picked from, because a dual-licensed package ships LICENSE-MIT *and*
 * LICENSE-APACHE and reproducing one of them would be reproducing half a notice.
 */
const LICENCE_FILE = /^(licen[cs]es?|copying|unlicen[cs]e|notice)([-_.][a-z0-9]+)?(\.(md|txt|markdown|rst))?$/i;

function licenceFiles(packageDir) {
  return readdirSync(packageDir)
    .filter((entry) => LICENCE_FILE.test(entry))
    .filter((entry) => statSync(join(packageDir, entry)).isFile())
    .sort();
}

/** One entry per package: what it is, what it declares, and the text we can prove. */
function packageEntry(packageDir, declaredLicence) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const files = licenceFiles(packageDir);
  const notice = files
    .map((file) => normalise(readFileSync(join(packageDir, file), "utf8")))
    .filter((text) => text.length > 0)
    .join("\n\n");
  return {
    id: `npm:${manifest.name}@${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    licence: declaredLicence === "Unknown" ? "UNKNOWN" : declaredLicence,
    notice,
    // `declared-only` is an ADMITTED GAP, never a guess: the package states an
    // id in its own manifest but ships no copy of the licence, so the id is
    // reproduced and the text is not invented.
    status: notice.length > 0 ? "file" : declaredLicence === "Unknown" ? "unknown" : "declared-only",
    source:
      notice.length > 0
        ? files.join(", ")
        : `package.json ("license": ${JSON.stringify(declaredLicence)}) — the package ships no licence file`,
  };
}

function npmEntries() {
  const byId = new Map();
  for (const [declaredLicence, packages] of Object.entries(pnpmLicences())) {
    for (const pkg of packages) {
      // Type-only and our own — see the scoping rule at the top of this file.
      if (pkg.name.startsWith("@types/") || pkg.name.startsWith("@nexus/")) continue;
      for (const packageDir of pkg.paths) {
        const entry = packageEntry(packageDir, declaredLicence);
        // pnpm lists one path per peer-dependency variant, so the same
        // name@version arrives more than once; the directories are copies.
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
      }
    }
  }
  return [...byId.values()];
}

/** The Electron runtime — a devDependency that nevertheless lands in the installer. */
function electronEntry() {
  const packageDir = dirname(require.resolve("electron/package.json"));
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return packageEntry(packageDir, manifest.license);
}

// --- 2. the bundled fonts -----------------------------------------------------

/** WOFF2's 63 known table tags, in the spec's own order; index 63 means a tag follows inline. */
const KNOWN_TABLE_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function readUIntBase128(buffer, position) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[position + i];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, position + i + 1];
  }
  throw new Error("WOFF2: malformed UIntBase128");
}

function decodeUTF16BE(bytes) {
  const even = bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1);
  const swapped = Buffer.from(even);
  swapped.swap16();
  return swapped.toString("utf16le");
}

/**
 * Every `name` record of one .woff2, as `{ id: value }` keeping the first
 * spelling of each id. WOFF2 is a header, a table directory of transformed
 * lengths, then one brotli blob holding the tables back to back in directory
 * order — so the `name` table is found by summing the lengths in front of it.
 */
function fontNames(file) {
  const buffer = readFileSync(file);
  if (buffer.toString("latin1", 0, 4) !== "wOF2") throw new Error(`not a woff2: ${file}`);
  const tableCount = buffer.readUInt16BE(12);
  const compressedSize = buffer.readUInt32BE(20);
  let position = 48;
  const tables = [];
  for (let i = 0; i < tableCount; i += 1) {
    const flags = buffer[position];
    position += 1;
    const index = flags & 0x3f;
    let tag;
    if (index === 0x3f) {
      tag = buffer.toString("latin1", position, position + 4);
      position += 4;
    } else {
      tag = KNOWN_TABLE_TAGS[index];
    }
    const transformVersion = (flags >> 6) & 0x03;
    let length;
    [length, position] = readUIntBase128(buffer, position);
    // glyf/loca are transformed at version 0; every other table at any non-zero
    // version. A transformed table stores its packed length as a second value.
    const transformed =
      tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
    if (transformed) [length, position] = readUIntBase128(buffer, position);
    tables.push({ tag, length });
  }
  const font = brotliDecompressSync(buffer.subarray(position, position + compressedSize));
  let offset = 0;
  let table = null;
  for (const entry of tables) {
    if (entry.tag === "name") {
      table = font.subarray(offset, offset + entry.length);
      break;
    }
    offset += entry.length;
  }
  if (table === null) return {};

  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  const names = {};
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    const platformID = table.readUInt16BE(record);
    const nameID = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const from = stringOffset + table.readUInt16BE(record + 10);
    const bytes = table.subarray(from, from + length);
    // Platform 1 is Macintosh (single-byte); 0 and 3 are UTF-16BE.
    const value = normalise(platformID === 1 ? bytes.toString("latin1") : decodeUTF16BE(bytes));
    if (value.length > 0 && names[nameID] === undefined) names[nameID] = value;
  }
  return names;
}

/**
 * The `copyright:` / `license:` fields of the cn-font-split header that some of
 * Excalidraw's `fonts/<Family>/index.ts` files carry. The built package keeps
 * no .ts, but its DEV source map carries `sourcesContent` verbatim — which is
 * how Excalifont, whose subsets kept no licence record of their own, still has
 * an on-disk notice.
 */
function fontSourceHeaders(packageRoot) {
  const devDir = join(packageRoot, "dist", "dev");
  const headers = new Map();
  for (const file of readdirSync(devDir)) {
    if (!file.endsWith(".js.map")) continue;
    const raw = readFileSync(join(devDir, file), "utf8");
    if (!raw.includes("/fonts/")) continue;
    const map = JSON.parse(raw);
    map.sources.forEach((source, index) => {
      const family = /\/fonts\/([^/]+)\/index\.ts$/.exec(source)?.[1];
      const content = map.sourcesContent?.[index];
      if (family === undefined || typeof content !== "string") return;
      // `name: value`, where the value runs to the next line that opens a field
      // of its own — the licence is several paragraphs long, so it cannot be
      // read a line at a time.
      const field = (name) => {
        const from = content.indexOf(`\n${name}: `);
        if (from < 0) return "";
        const start = from + name.length + 3;
        const next = /\n[a-zA-Z]+: /.exec(content.slice(start));
        return next === null ? "" : normalise(content.slice(start, start + next.index));
      };
      headers.set(family, {
        copyright: field("copyright"),
        licence: field("license"),
        file: `${within(packageRoot, join(devDir, file))} → fonts/${family}/index.ts`,
      });
    });
  }
  return headers;
}

/** The families `electron.vite.config.ts` leaves out — read from that file so the two can never drift. */
function droppedFamilies() {
  const config = readFileSync(join(APP_ROOT, "electron.vite.config.ts"), "utf8");
  const literal = /DROPPED_FAMILIES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(config);
  if (literal === null) {
    throw new Error(
      "electron.vite.config.ts no longer declares DROPPED_FAMILIES as a Set literal — " +
        "the font notices cannot be scoped to what the build actually copies.",
    );
  }
  return new Set([...literal[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/** The operative OFL grant. Its presence is what says a font already carries the licence rather than a pointer to it. */
const OFL_GRANT = "Permission is hereby granted, free of charge, to any person obtaining";

function fontEntries() {
  const packageRoot = join(require.resolve("@excalidraw/excalidraw"), "..", "..", "..");
  const excalidraw = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const fontsRoot = join(packageRoot, "dist", "prod", "fonts");
  const dropped = droppedFamilies();
  const headers = fontSourceHeaders(packageRoot);

  // The standard OFL 1.1, read from the one shipped font that carries a full
  // copy in its own metadata. Reused only by families that declare OFL and
  // ship no copy — and every such entry names this file as its source.
  const oflFile = join(fontsRoot, "Virgil", "Virgil-Regular.woff2");
  const oflText = fontNames(oflFile)[13] ?? "";
  if (!oflText.includes(OFL_GRANT)) {
    throw new Error(`${within(packageRoot, oflFile)} no longer carries the SIL OFL 1.1 text.`);
  }

  const entries = [];
  for (const family of readdirSync(fontsRoot).sort()) {
    if (dropped.has(family)) continue;
    const familyDir = join(fontsRoot, family);
    const files = readdirSync(familyDir).sort();
    // Records are merged across the family's subsets: cn-font-split keeps the
    // copyright on every one but the licence text on none, and Google's subsets
    // are the other way round, so neither file alone is the whole record.
    const names = {};
    for (const file of files) {
      for (const [id, value] of Object.entries(fontNames(join(familyDir, file)))) {
        if (names[id] === undefined) names[id] = value;
      }
    }
    // The package's own TypeScript source is a SECOND on-disk record, consulted
    // only where the font file itself keeps none.
    const header = headers.get(family);
    const fromHeader = names[13] === undefined && (header?.licence ?? "") !== "";
    const copyright = names[0] ?? header?.copyright ?? "";
    const declaration = fromHeader ? header.licence : (names[13] ?? "");
    const licenceURL = names[14] ?? "";

    const evidence = `${copyright}\n${declaration}\n${licenceURL}`;
    const licence = /SIL Open Font License|scripts\.sil\.org\/OFL/i.test(evidence)
      ? "OFL-1.1"
      : /MIT License/.test(evidence)
        ? "MIT"
        : "UNKNOWN";

    // The licence-info URL joins the notice only where the licence could NOT be
    // established: there it is the last thing the font says about its own terms,
    // and beside a full OFL text it would be a footnote to a document already
    // quoted in full.
    const parts = [copyright, declaration, ...(licence === "UNKNOWN" ? [licenceURL] : [])].filter(
      (part) => part.length > 0,
    );
    const needsOfl = licence === "OFL-1.1" && !parts.join("\n").includes(OFL_GRANT);
    if (needsOfl) parts.push(oflText);

    const read = [
      `${within(packageRoot, familyDir)}/*.woff2 (OpenType name table)`,
      ...(fromHeader ? [header.file] : []),
      ...(needsOfl ? [`${within(packageRoot, oflFile)} (name ID 13, SIL OFL 1.1)`] : []),
    ];
    entries.push({
      id: `font:${family}`,
      // The font's own typographic family (ID 16) where it declares one, else
      // its family name (ID 1) — never the directory, which is Excalidraw's
      // shorthand rather than anything the foundry named.
      name: names[16] ?? names[1] ?? family,
      version: names[5] ?? "",
      licence,
      notice: parts.join("\n\n"),
      status: licence === "UNKNOWN" ? "unknown" : "file",
      source: `@excalidraw/excalidraw ${excalidraw.version} — ${read.join("; ")}`,
    });
  }
  return entries;
}

// --- 3. emit ------------------------------------------------------------------

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const payload = {
  packages: [...npmEntries(), electronEntry()].sort(byId),
  fonts: fontEntries().sort(byId),
};

mkdirSync(dirname(OUTPUT), { recursive: true });
const rendered = `${JSON.stringify(payload, null, 2)}\n`;

// `--check` is the freshness half of the obligation, and it is a SEPARATE
// question from the one `licences.test.ts` answers. That suite asks whether the
// committed file is fit to ship — every entry carries a notice, nothing is
// UNKNOWN, the fonts are all present. It cannot ask whether the file still
// describes THIS tree, because it only ever reads the file.
//
// Nothing did, and the file went stale exactly where it mattered: on 2026-08-15
// it credited dompurify 3.4.12, js-yaml 4.3.0, mermaid 11.16.0 and nanoid
// 3.3.16 while the installer shipped 3.4.13, 4.3.1, 11.16.1 and 3.3.18. Three
// of those four are the packages the security overrides in
// `pnpm-workspace.yaml` moved — so the screen was naming the OLD, vulnerable
// version of a dependency the product had already patched, which is a defective
// attribution as well as a misleading one.
//
// This is sound only because the generator is deterministic (see DETERMINISM
// above) — same node_modules in, byte-identical file out, path separators
// normalised to `/` so a Windows run and a Linux run agree.
//
// LINE ENDINGS are compared out, and that is not a nicety. The generator always
// writes LF; `.gitattributes` says `* text=auto`, so git checks this file out
// with CRLF on Windows. A byte comparison therefore answers „stale" to a file
// that is exactly current — on every Windows checkout, and never on CI, which
// is the inverse of the staleness this gate exists to catch and reads as the
// gate crying wolf until someone switches it off. The question being asked is
// whether the NOTICES still describe the tree; a carriage return is not a
// notice. `.gitattributes` also pins this file to LF so the working copy stops
// flipping, but the gate must not depend on anyone having remembered that.
const withoutLineEndings = (text) => text.replaceAll("\r\n", "\n");

if (process.argv.includes("--check")) {
  const committed = readFileSync(OUTPUT, "utf8");
  if (withoutLineEndings(committed) === withoutLineEndings(rendered)) {
    console.log(
      `check-licences: ${within(REPO_ROOT, OUTPUT)} is what this tree produces ` +
        `(${payload.packages.length} packages, ${payload.fonts.length} font families).`,
    );
    process.exit(0);
  }
  const versionOf = (text) => {
    const found = new Map();
    for (const entry of [...JSON.parse(text).packages, ...JSON.parse(text).fonts]) {
      found.set(entry.name, entry.version);
    }
    return found;
  };
  const was = versionOf(committed);
  const now = versionOf(rendered);
  console.error(
    `check-licences: ${within(REPO_ROOT, OUTPUT)} does not describe this tree. ` +
      "Run `pnpm --filter @nexus/desktop licences` and commit the result.",
  );
  for (const [name, version] of now) {
    const before = was.get(name);
    if (before !== version) console.error(`  ${name}: ${before ?? "(absent)"} -> ${version}`);
  }
  for (const name of was.keys()) if (!now.has(name)) console.error(`  ${name}: removed`);
  process.exit(1);
}

writeFileSync(OUTPUT, rendered, "utf8");

const unresolved = [...payload.packages, ...payload.fonts].filter(
  (entry) => entry.status !== "file",
);
console.log(
  `${within(REPO_ROOT, OUTPUT)}: ${payload.packages.length} packages, ${payload.fonts.length} font families` +
    `, ${unresolved.length} without a licence text on disk.`,
);
for (const entry of unresolved) console.log(`  ${entry.status}: ${entry.id} (${entry.licence})`);
