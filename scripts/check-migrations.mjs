/**
 * The server migration series is well-formed, and every citation of it resolves.
 *
 * ─── THE TWO SERIES, AND WHY THAT IS THE WHOLE REASON THIS EXISTS ───────────
 *
 * This repository has TWO migration series and both number from 001:
 *
 *   packages/db/src/migrations/NNN-slug.ts   the LOCAL SQLite schema, 001–068
 *   supabase/migrations/<timestamp>_slug.sql the SERVER schema, 001–013
 *
 * A bare „migration 006" is therefore ambiguous in principle, and on
 * 2026-09-22 it was wrong in fact: `packages/sync-transport/src/signal.ts`
 * cited „migration 006's policies" for `realtime.topic()`, and the realtime
 * policies are in the server's 004. The server series carries no 006 at all —
 * the only 006 in the tree is the local flashcards migration — so the citation
 * resolved to nothing, and a reader who grepped it found a table about Anki
 * decks. That is the defect class: **a sentence that names its evidence by a
 * number the evidence does not carry**, which is the same shape as the stale
 * `devices.platform` column comment: prose whose whole job is to point at a
 * fact, pointing at nothing.
 *
 * ─── WHAT THIS GATE DOES *NOT* COVER, SAID OUT LOUD ─────────────────────────
 *
 * It does not cover `signal.ts`, and it could not have. Which series a citation
 * means is a property of what the citing FILE is about, and that is not
 * derivable: `packages/sync/src/push.ts` cites the server (NX0xx codes, the
 * `sync_objects` guard) while its sibling `packages/sync/src/collections.ts`
 * cites the local schema (note tags, task tags), in the same directory, in the
 * same idiom. A directory-scoped rule would fire on one of them and need an
 * exception list within a month, and an exception list beside a generated set
 * fails by omission — [[DC-109]].
 *
 * What IS unambiguous is the `supabase/` tree: it holds one series, everything
 * under it that cites a number means that series, and there is nothing to
 * exempt. So the rule is scoped there. Its value is in that tree, which is
 * where the convention is written down and where a header copy-pasted from an
 * older migration is the ordinary way a number gets duplicated.
 *
 * ─── THE THREE CLAUSES, ALL ABOUT THE ONE SUBJECT ───────────────────────────
 *
 *   1. Every file in the series DECLARES a number, on its first line. A file
 *      that declares none cannot be cited, and a citation of it can never be
 *      checked by anything.
 *   2. No two files declare the SAME number. Migrations are written by copying
 *      the last one and editing it, which is exactly how a duplicate arrives.
 *   3. The numbers INCREASE with the filenames. `apply` order is the filename
 *      timestamp and the number is the logical step, so a file applied later
 *      and numbered earlier is a claim about the series that is false.
 *
 *   4. Every citation `migration NNN[a-z]` UNDER `supabase/` names a declared
 *      number.
 *
 *   5. Every file in the series is NAMED in the tree listing in `README.md`.
 *      That listing is how someone reads what the server holds without opening
 *      thirteen files, and it is hand-kept beside a directory that is not, which
 *      is the shape that fails by omission — and had: four migrations were added
 *      and the listing kept saying nine. [[DC-109]]'s reason, one document over.
 *
 * This gate reads COMMENTS — a citation is prose, so blanking them would blank
 * the subject. That is the inverse of every other gate in this directory.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

import { walk } from "./check-rows.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const SUPABASE = join(REPO_ROOT, "supabase");
export const SERIES_DIR = join(SUPABASE, "migrations");

/** The extensions a citation can be written in, including the ones that are only prose. */
const ENDINGS = [".sql", ".ts", ".mjs", ".md", ".toml", ".json"];

/**
 * `migration 003b`, and not a slice of a longer run. Both guards are load-bearing
 * and both were earned:
 *
 *   the trailing `(?![\d_])` — the advice this gate's own message gives is to
 *   cite a migration by FILENAME, and a filename here begins with a fourteen-
 *   digit timestamp. `20260808090000_sync_core_tables.sql` ends in `000`, and
 *   without the guard that is read as a citation of „migration 000".
 *
 *   the leading `(?<![\d_])` — with only the trailing guard, `0010` does not
 *   match at all but `010` does, from its second digit. A number has to be the
 *   whole number, not a window onto one.
 */
const CITATION = /(?<![\d_])migration\s+(\d{3}[a-z]?)(?![\d_])/gi;

/** The declaration, which has to be on the FIRST line: a header says what the file is. */
const DECLARATION = /(?<![\d_])migration\s+(\d{3}[a-z]?)(?![\d_])/i;

/** `003b` sorts after `003` and before `004`: numbers numerically, then sub-letters. */
export function order(key) {
  const [, digits = "", letter = ""] = /^(\d{3})([a-z]?)$/.exec(key) ?? [];
  return [Number(digits), letter];
}

/**
 * Every number the series declares, in filename order, with the file that
 * declares it. The census, and clause 1, from the same pass.
 */
export function declared(seriesDir = SERIES_DIR) {
  let names;
  try {
    names = readdirSync(seriesDir).filter((name) => name.endsWith(".sql")).sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const first = readFileSync(join(seriesDir, name), "utf8").split(/\r?\n/, 1)[0] ?? "";
    const match = DECLARATION.exec(first);
    return { file: name, key: match?.[1].toLowerCase() ?? null, header: first.trim() };
  });
}

/**
 * Every citation under `root`, with the line it sits on. `text` is the original
 * line.
 *
 * Paths are relative to `root`, not to the repository — so the function means
 * the same thing on a tree of the test's own as it does on `supabase/`, which is
 * the only way a fake tree can assert anything about it. The first version read
 * paths against `REPO_ROOT` whatever it was given and answered
 * `../../../../AppData/Local/Temp/…`; `main()` is what puts the `supabase/`
 * prefix back on for a human.
 *
 * A migration file's own header line is matched here too, and that is not a
 * quirk to filter: a file does cite itself, and a series whose numbers did not
 * resolve would be reported by its own first line.
 */
export function citations(root = SUPABASE) {
  const found = [];
  for (const full of walk(root, ENDINGS)) {
    const rel = relative(root, full).split(sep).join("/");
    const source = readFileSync(full, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      CITATION.lastIndex = 0;
      let match;
      while ((match = CITATION.exec(line)) !== null) {
        found.push({ file: rel, line: index + 1, key: match[1].toLowerCase(), text: line.trim() });
      }
    });
  }
  return found;
}

/**
 * Every defect in the series, in one list. `files` is `declared()`'s output and
 * `cited` is `citations()`'s, so a test can drive both from a fake tree.
 */
export function findings(files, cited) {
  const out = [];

  for (const entry of files) {
    if (entry.key === null) {
      out.push({
        kind: "undeclared",
        file: entry.file,
        line: 1,
        text: entry.header,
        what: "declares no `migration NNN` on its first line, so nothing can cite it verifiably",
      });
    }
  }

  const byKey = new Map();
  for (const entry of files) {
    if (entry.key === null) continue;
    const seen = byKey.get(entry.key);
    if (seen === undefined) byKey.set(entry.key, entry);
    else {
      out.push({
        kind: "duplicate",
        file: entry.file,
        line: 1,
        text: entry.header,
        what: `declares „migration ${entry.key}", which ${seen.file} already declares`,
      });
    }
  }

  let previous = null;
  for (const entry of files) {
    if (entry.key === null) continue;
    const [number, letter] = order(entry.key);
    if (previous !== null) {
      const [pNumber, pLetter] = previous;
      // Strictly increasing: an equal pair is the duplicate clause's finding, and
      // reporting one defect twice makes a count of findings a lie.
      if (number < pNumber || (number === pNumber && letter < pLetter)) {
        out.push({
          kind: "order",
          file: entry.file,
          line: 1,
          text: entry.header,
          what: "is applied after a migration numbered at or above its own",
        });
      }
    }
    previous = [number, letter];
  }

  for (const cite of cited) {
    if (!byKey.has(cite.key)) {
      out.push({
        kind: "dangling",
        file: cite.file,
        line: cite.line,
        text: cite.text,
        what: `cites „migration ${cite.key}", which no file in the series declares`,
      });
    }
  }

  return out;
}

export function scanRepo(root = SUPABASE, seriesDir = SERIES_DIR) {
  return findings(declared(seriesDir), citations(root));
}

/** The project README that carries the tree listing. */
export const README = join(SUPABASE, "README.md");

/**
 * The files the tree listing in `README` does not name. Its form is `…090000`,
 * the last six digits of the timestamp, and it is a hand-kept index beside a
 * directory that is not — which is the shape that fails by omission, and did:
 * four migrations were added and the listing kept saying nine. [[DC-109]]'s
 * reason, one document over.
 */
export function missingFromIndex(files, readme) {
  return files
    .filter((entry) => entry.key !== null)
    .filter((entry) => !readme.includes(`…${entry.file.slice(8, 14)}`))
    .map((entry) => entry.file);
}

function main() {
  const files = declared();
  const cited = citations();
  const problems = findings(files, cited);

  if (files.length === 0) {
    console.error(
      "check-migrations: the series declares nothing at all — no file in\n" +
        `  ${relative(REPO_ROOT, SERIES_DIR)}\n` +
        "matched. Either the directory moved or the header convention changed;\n" +
        "both make every citation in the repository unverifiable, so this is\n" +
        "reported as a failure rather than as an empty pass.\n",
    );
    process.exit(1);
  }

  let readme;
  try {
    readme = readFileSync(README, "utf8");
  } catch {
    console.error(
      `check-migrations: cannot read ${relative(REPO_ROOT, README).split(sep).join("/")}.\n` +
        "The tree listing lives there and is checked below; without it the run\n" +
        "cannot say whether the series is described, so it does not pass.\n",
    );
    process.exit(1);
  }

  const missing = missingFromIndex(files, readme);

  if (missing.length > 0) {
    console.error(
      `check-migrations: ${missing.length} migration(s) missing from the tree listing in\n` +
        `  ${relative(REPO_ROOT, README).split(sep).join("/")}\n`,
    );
    for (const file of missing) console.error(`  …${file.slice(8, 14)}  (${file})`);
    console.error(
      "\nThat listing is how someone reads what the server holds without opening\n" +
        "thirteen files, and it is hand-kept beside a directory that is not — so it\n" +
        "fails the way hand-kept lists do, by omission, and already has once. Add the\n" +
        "line. This is not a formatting rule: the migration is invisible until it is\n" +
        "written down where the tree is described.",
    );
    process.exit(1);
  }

  if (problems.length > 0) {
    const prefix = relative(REPO_ROOT, SUPABASE).split(sep).join("/");
    console.error(
      `check-migrations: ${problems.length} problem(s) in the server migration series.\n`,
    );
    for (const p of problems) {
      console.error(`  ${prefix}/${p.file}:${p.line}  ${p.what}\n    ${p.text}`);
    }
    console.error(
      "\nThe series is numbered by LOGICAL STEP, not by file: 003 spans three\n" +
        "files (003, 003b, 003c) and 006 and 007 were never written, so the\n" +
        "numbers a file carries are not contiguous. What they must be is\n" +
        "declared, unique, in filename order, and the only numbers anything may\n" +
        "cite. Cite the file by NAME where the two series could both be meant —\n" +
        "this repository numbers its local SQLite migrations from 001 as well,\n" +
        "so a bare number in a package outside `supabase/` may resolve to a\n" +
        "table an ocean away from the one in mind.",
    );
    process.exit(1);
  }

  const numbers = files.map((f) => f.key).join(" ");
  console.log(
    `check-migrations: ${files.length} declared (${numbers}), ` +
      `${cited.length} citation(s), all resolving.`,
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
