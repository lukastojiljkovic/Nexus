// No shebang — same reason as the other gates: this module is a CLI and an
// import target for its own tests, and Vite does not strip a shebang from an
// `.mjs` it transforms.
//
// WHY THIS GATE EXISTS. English became the app's second locale on 2026-10-02:
// `strings.en.ts` and the `strings/*.en.ts` subtables, the compiler checking one
// key at a time, and a runtime switch that rewrites the live table in place.
// What no compiler can check is the other direction — whether every surface the
// Serbian copy reached got an English half at all. The leftovers were found the
// only way they could be: by reading screens. A demo body, a component
// catalogue, the drawer's cron refusals, the five built-in note templates and
// the Markdown mirror's own generated file names were all still Serbian under an
// English interface, and every one of them typechecked, linted, passed
// `check:address` and photographed as a correct screen — in the wrong language,
// which no geometry audit can see.
//
// TWO RULES, and they are the two halves of one property.
//
//   1. **English copy contains no Serbian.** Every place English copy is
//      written may contain neither a Serbian letter (č ć š ž đ) nor one of the
//      stoplist words below as a whole word: an `*.en.ts` table, the English
//      side of bilingual data (`nameEn`, `noteEn`, `bodyEn`, …), an `EN`/`*_EN`
//      table, a record's own `en:` half, a branch guarded by `isEnglish()` or
//      `mainLocale() === "en"`, and the third argument of the generated
//      artefacts' `pick(language, sr, en)`. The stoplist is the half that
//      catches `Bez naslova`: a Serbian sentence need not carry a diacritic, and
//      the ones that do not are exactly the ones a copy-paste leaves behind.
//
//   2. **Serbian copy lives in Serbian tables.** Outside the sources listed in
//      {@link SERBIAN_SOURCES} — the copy tables, the demo scene, the generated
//      artefacts' Serbian lines, and the data tables the brief calls out — and
//      outside a bilingual record's own `sr:` half, a string literal containing
//      a Serbian letter is a finding. This is the rule that catches the
//      component nobody gave a table to.
//
// WHAT IT CANNOT SEE, and each is why its rule is worded the way it is. A
// Serbian string WITHOUT a diacritic outside a table is rule 2's blind spot —
// `"Sacuvaj"` in a component passes, because `sacuvaj` is a stoplist word only
// for rule 1, and making it one here would fire on every id, slug and CSS class
// the app spells in Serbian (`SMART_LIST_IDS`, `MIME_FAMILIES`, `"zavrseno"`).
// A Serbian word inside a `${…}` interpolation is code, not copy, and is not
// read. And an escaped letter (`"\u010d"`) is not seen, because the literal's
// text is what the compiler will hand the user — `check:invisibles` owns the
// other direction of that.
//
// Three narrowings make the word half usable rather than noisy, and each is a
// statement about what a WORD is. A literal with no whitespace and no character
// outside `[a-z0-9._-]` is an identifier, not copy — `"rok-poslednji-dan"` is a
// tool id in `pro.en.ts`, and ids in this app are Serbian slugs by design, the
// way `SMART_LIST_IDS` and `MIME_FAMILIES` are. A token written in any other
// shape — mixed case, like `someWord` — is an identifier too: `[a-zA-Z_]` in a
// note body splits into `zA`, which is not the Serbian word `za`. And a token
// that is ALL CAPS IS matched, deliberately: `NEMA` is the motor-frame
// standard's acronym, and the two places it is written in English copy are
// allowlisted one entry at a time with that reason, rather than by weakening the
// rule for every acronym the app will ever name.
//
// SCOPE. `apps/desktop/src` and `packages/*/src`, which is where the brief
// scoped the search: `apps/web` is on hold permanently, and `apps/gallery` is a
// design harness that ships no copy. Tests are outside both rules — a test may
// assert Serbian text, and several must.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { REPO_ROOT } from "./check-address.mjs";

/** The six letters Serbian has and English does not (upper and lower case). */
export const SERBIAN_LETTERS = /[čćšžđČĆŠŽĐ]/;

/**
 * Frequent Serbian words, folded (no diacritics) — the ones a sentence is made
 * of, plus the verbs and nouns a hand-written surface reaches for first.
 *
 * Every word here was chosen to be a word ENGLISH copy has no reason to contain
 * as a whole word. That is not a stylistic preference: the rule is a whole-word
 * match over English strings, so `do`, `to`, `on`, `pre` („pre-ferment"), `red`,
 * `tip`, `status`, `video` and `datum` are deliberately ABSENT even though they
 * are frequent Serbian words, because each one is also an English one and each
 * would have needed an exemption per site — which is how an exemption list gets
 * long enough to be ignored. The list is kept at the fold of the word, because a
 * word WITH a diacritic is already caught by {@link SERBIAN_LETTERS}.
 */
export const SERBIAN_WORDS = [
  "ali", "ako", "avgust", "bez", "bih", "bila", "bilo", "bio", "broj", "cena",
  "cemu", "cetvrtak", "danas", "datoteka", "decembar", "dobar", "dodaj",
  "dodati", "dogadjaj", "fajl", "februar", "gde", "godina", "greska", "grupa",
  "ima", "izaberi", "izbor", "izmeni", "izmedju", "iznad", "izracunaj", "ispis",
  "ispod", "januar", "jedan", "jedna", "jedno", "je", "juce", "jutro", "kada",
  "kako", "kategorija", "kad", "kod", "koga", "koja", "koje", "koji", "kojih",
  "kolona", "kolicina", "kome", "kopiraj", "korisnik", "kraj", "kroz", "lista",
  "los", "mesec", "minut", "moj", "moja", "moje", "mora", "moze", "nad",
  "nalepi", "nalog", "napomena", "nas", "naziv", "nedelja", "nema", "nije",
  "nikad", "njega", "njemu", "njih", "njima", "njoj", "novi", "novo", "novembar",
  "obavestenje", "obrisi", "opis", "oktobar", "ono", "opcije", "ostalo",
  "otkazi", "otvori", "ova", "ovaj", "ovde", "ovo", "petak", "pocetak",
  "podesavanja", "podsetnik", "pokreni", "polje", "ponedeljak", "posle",
  "potvrdi", "preko", "pretrazi", "preuzmi", "prikaz", "prikazi", "prioritet",
  "proveri", "radi", "rok", "sada", "sacuvaj", "sakrij", "septembar", "sekcija",
  "slika", "snimi", "sreda", "stara", "stari", "staro", "stavka", "stavke",
  "stranica", "subota", "sutra", "sva", "svaka", "svaki", "svako", "sve",
  "svega", "svi", "svih", "svim", "svoj", "svoja", "svoje", "tabela", "taj",
  "tamo", "tim", "tom", "trajanje", "treba", "tvoj", "tvoja", "tvoje",
  "ucitaj", "ukupno", "unesi", "unos", "upozorenje", "utorak", "uvek", "vas",
  "vece", "veliki", "vrednost", "vreme", "vrsta", "zadatak", "zasto", "zaustavi",
  "zatvori", "za",
];

const SERBIAN_WORD_SET = new Set(SERBIAN_WORDS);

/**
 * Where Serbian is the copy, not a leftover — one entry per kind of place, each
 * with the reason it is allowed to be Serbian.
 *
 * Whole directories where the reason is a property of the directory (the demo
 * scene, the screenshot harness, the SQL of a migration), and single files where
 * it is a property of that file. A file that stops being one of these falls out
 * of the rule by being edited, which is the point: the next one is caught by
 * being written, not by somebody remembering this list.
 *
 * `*.en.ts` never reaches this list — rule 2 skips English tables entirely,
 * because they are rule 1's subject and reporting one string twice would make a
 * single finding look like two.
 */
export const SERBIAN_SOURCES = [
  {
    match: /^apps\/desktop\/src\/renderer\/src\/strings\.sr\.ts$/,
    reason: "the Serbian table itself, which `strings.ts` clones at import",
  },
  {
    match: /^apps\/desktop\/src\/renderer\/src\/noteTemplates\.ts$/,
    reason: "the five built-in templates, whose `bodySr` sits beside the `bodyEn` rule 1 reads and whose structure the two share heading for heading",
  },
  {
    match: /^apps\/desktop\/src\/renderer\/src\/strings\/[^/]+\.ts$/,
    reason: "a Serbian subtable (`devtools.*`, `pro.*`, `electronics`), with its English half beside it",
  },
  {
    match: /^apps\/desktop\/src\/main\/demo\/[^/]+\.ts$/,
    reason: "the demo scene's Serbian content; the English half is the `EN` map in the same file",
  },
  {
    match: /^apps\/desktop\/src\/main\/(notificationStrings|shellStrings)\.ts$/,
    reason: "main's own copy, which holds both languages in one file because a dialog is opened before any renderer exists",
  },
  {
    match: /^apps\/desktop\/src\/main\/shots\/[^/]+\.ts$/,
    reason: "the screenshot harness's own typed vocabulary — it types Serbian into create forms to photograph them, and ships to nobody",
  },
  {
    match: /^packages\/core\/src\/devtools\/(datetime|system|text)\.ts$/,
    reason: "the developer drawer's prose and data: Serbian relative times and cron readings beside their English twins, HTTP-status rows beside `noteEn`, and the transliteration tables the text tools are made of",
  },
  {
    match: /^packages\/core\/src\/electronics\/(ros|sketch)\.ts$/,
    reason: "the generated ROS package and Arduino sketch, whose Serbian lines sit beside the English one `pick(language, …)` chooses between",
  },
  {
    match: /^packages\/core\/src\/electronics\/catalogue\/[^/]+\.ts$/,
    reason: "the component catalogue, whose Serbian `name`/`summary` carries `nameEn`/`summaryEn` beside it (pinned by `catalogue.test.ts`)",
  },
  {
    match: /^packages\/core\/src\/imex\/(llmPrompts|csvImport|csvFinance)\.ts$/,
    reason: "the LLM prompt's Serbian half, and the Serbian words the two CSV importers RECOGNISE in input — a vocabulary read from the user's file, never written to one",
  },
  {
    match: /^packages\/core\/src\/pro\/(pravo|racunovodstvo|tekst)\.ts$/,
    reason: "Serbian number words, tax-form vocabulary and typographic tables — the arithmetic of tools that only make sense in Serbia (`pro/pravo.ts`, `pro/racunovodstvo.ts`), and the quote-pair table `check:quotes` exempts by design",
  },
  {
    match: /^packages\/db\/src\/migrations\/[^/]+\.ts$/,
    reason: "a migration's SQL, which is a template literal — its `--` comments are literal text to a parser and are shown to nobody (`check:quotes` skips the same directory, for the same reason)",
  },
  {
    match: /^apps\/desktop\/src\/modules\/[^/]+\/renderer\/copy\.sr\.ts$/,
    reason: "a kit module's own Serbian table, with the `copy.en.ts` rule 1 reads beside it",
  },
  {
    match: /^packages\/core\/src\/miniapps\/typing\.ts$/,
    reason: "the Serbian Latin keyboard the typing tutor drills — `š`, `đ`, `č`, `ć` and `ž` are keys of its layout and its lessons, not copy",
  },
  {
    match: /^packages\/core\/src\/cookbook\/parse\.ts$/,
    reason: "the Serbian measure words and taste phrases the ingredient parser RECOGNISES in a pasted recipe — a vocabulary read from input, never shown",
  },
  {
    match: /^apps\/desktop\/src\/modules\/[^/]+\/renderer\/[^/]+\/copy\.sr\.ts$/,
    reason: "a kit module's own Serbian table one folder DEEPER than `renderer/copy.sr.ts` — the star map's, whose component lives under `renderer/stars/` so the module's page can be assembled around it; the `copy.en.ts` rule 1 reads sits beside it",
  },
];

/**
 * English literals that a Serbian letter is legitimately part of.
 *
 * Each one is a Serbian word used AS DATA inside English copy: the language's
 * own letters named by the transliteration tool, and proper nouns — a client, a
 * venue, a garage, a dish, a mountain railway — which have no English spelling
 * to be translated into. The match is on the literal's own text, so the
 * exemption is scoped to the sentence it was written for rather than to the file.
 */
export const ENGLISH_ALLOWLIST = [
  {
    file: "apps/desktop/src/main/demo/business.ts",
    contains: "Sunčani vrt",
    reason: "the demo client's own name — a proper noun, kept as it is in both languages",
  },
  {
    file: "apps/desktop/src/main/demo/business.ts",
    contains: "Novi Sad",
    reason: "the city's name, which English spells the same way — the stoplist word here is part of the name, not a sentence",
  },
  {
    file: "apps/desktop/src/main/demo/calendar.ts",
    contains: "Salaš",
    reason: "the venue's own name, kept as a proper noun",
  },
  {
    file: "apps/desktop/src/main/demo/calendar.ts",
    contains: "Milić",
    reason: "the garage's own name, kept as a proper noun",
  },
  {
    file: "packages/core/src/imex/llmPrompts.ts",
    contains: "Novi Sad",
    reason: "the city in the LLM prompt's English few-shot example, spelled as English spells it — the stoplist word here is part of the name",
  },
  {
    file: "packages/core/src/electronics/catalogue/actuators.ts",
    contains: "NEMA 17",
    reason: "NEMA is the motor-frame standard's acronym, not the Serbian word `nema`",
  },
  {
    file: "packages/core/src/electronics/catalogue/drivers.ts",
    contains: "NEMA 23",
    reason: "the same acronym in the driver's summary",
  },
  {
    file: "apps/desktop/src/renderer/src/strings/pro.en.ts",
    contains: "dž",
    reason: "the transliteration description says which digraph is ambiguous; the letter IS the subject",
  },
  {
    file: "apps/desktop/src/renderer/src/strings/pro.tekst.en.ts",
    contains: "đ",
    reason: "the flag list names `đ` as the character it will not produce",
  },
  {
    file: "apps/desktop/src/renderer/src/strings/pro.tekst.en.ts",
    contains: "dž",
    reason: "the letter-pair table the tool reports on is spelled out",
  },
  {
    file: "apps/desktop/src/renderer/src/strings/pro.tekst.en.ts",
    contains: "ć",
    reason: "a Serbian letter is named as an example of what the case rule sees",
  },
  {
    file: "apps/desktop/src/main/demo/notes.en.ts",
    contains: "Karađorđeva",
    reason: "the dish's own name — a proper noun, kept as it is",
  },
  {
    file: "apps/desktop/src/main/demo/notes.en.ts",
    contains: "Šargan",
    reason: "the Šargan Eight is a place and a railway line; its name has no English spelling",
  },
];

/**
 * Serbian literals outside a Serbian table that are not copy.
 *
 * The smoke harness's throwaway account labels and its own console line, and the
 * query it types into the search box to prove the parser works — all of them
 * live in files that are otherwise judged, so they are exempted one literal at a
 * time rather than by allowlisting the file they sit in.
 */
export const SERBIAN_LITERAL_ALLOWLIST = [
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "Smoke nalog",
    reason: "the label `--smoke` gives its own disposable account, in `userData/smoke`; never a shipped profile's",
  },
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "Drugi smoke nalog",
    reason: "the second account the same rehearsal adds, for the multi-account check",
  },
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "DEMO OK",
    reason: "the demo harness's console line, printed to a terminal and to no surface",
  },
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "rok:danas",
    reason: "the Serbian query the smoke run types into search, which is what a Serbian reader would type",
  },
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "Rešenje za Đorđa",
    reason: "the smoke search rehearsal's own task title, Serbian on purpose: the rehearsal exists to prove a folded query finds a diacritic title",
  },
  {
    file: "apps/desktop/src/main/index.ts",
    contains: "(lični) i",
    reason: "the middle of the demo harness's console line, printed to a terminal and to no surface",
  },
  {
    file: "packages/core/src/imex/archivePaths.ts",
    contains: "Bez naslova",
    reason: "the Serbian half of the generated-name table, beside `Untitled` — both are the value the export writes",
  },
  {
    file: "packages/core/src/imex/archivePaths.ts",
    contains: "Fascikla",
    reason: "the same, for a folder whose own name sanitizes to nothing",
  },
];

/** Directory names the walk never enters. */
const SKIP_DIRS = new Set(["node_modules", "out", "dist", "shots", ".turbo"]);

const isTestFile = (relPath) => /\.test\.tsx?$/.test(relPath);
const isEnglishTable = (relPath) => relPath.endsWith(".en.ts");

/** Every `.ts`/`.tsx` under `apps/desktop/src` and each package's `src`, as repo-relative POSIX paths. */
export function scanFiles(root = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const group of ["apps", "packages"]) {
    const groupDir = join(root, group);
    try {
      if (!statSync(groupDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const app of readdirSync(groupDir, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      // See the header: `apps/web` is on hold and `apps/gallery` ships no copy.
      if (group === "apps" && app.name !== "desktop") continue;
      const src = join(groupDir, app.name, "src");
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // A package with no `src` is not this gate's problem.
      }
    }
  }
  return files.map((file) => relative(root, file).split(sep).join("/"));
}

/** The parsed file, with the TSX grammar for `.tsx` and a JSX-free grammar for `.ts`. */
function parse(relPath, source) {
  const kind = relPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind);
}

const lineOf = (sourceFile, node) =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * Every string's TEXT — delimiter-free — in source order, with the line it
 * starts on.
 *
 * JSX text is a literal too: `<p>Zatvori</p>` is copy that no `strings.ts`
 * consumer ever sees, and it is exactly the shape this gate was written for.
 * Comments are not read at all, because the compiler does not give them to a
 * visitor and because a comment is shown to nobody.
 *
 * `skip` prunes a subtree before its literals are read: rule 2 passes
 * {@link isSerbianHalf}.
 */
export function literalsOf(sourceFile, skip = () => false) {
  const out = [];
  const visit = (node) => {
    if (skip(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (typeof node.text === "string") {
        out.push({ text: node.text, line: lineOf(sourceFile, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/**
 * True for a property name whose English half this is: `nameEn`, `noteEn`,
 * `bodyEn` — and a plain `en`, which is how the two language-keyed records in
 * this tree spell their English half (`imex/llmPrompts.ts`'s
 * `Record<LlmPromptLanguage, …>` tables, and the language picker's own rows).
 */
function isEnglishPropertyName(name) {
  if (name === undefined) return false;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text === "en" || (name.text.length > 2 && name.text.endsWith("En"));
  }
  return false;
}

const isPropertyNamed = (name, text) =>
  (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === text;

/**
 * True for the `sr:` half of a bilingual record, `{ sr: …, en: … }` — the shape
 * the module kit's `ModuleText` gives every manifest name and notification
 * heading. That half is a Serbian table one entry long whose `en:` twin rule 1
 * reads, so rule 2 has nothing to say about it. A lone `sr:` with no `en:`
 * beside it is not that record, and is still judged.
 */
function isSerbianHalf(node) {
  if (!ts.isPropertyAssignment(node) || !isPropertyNamed(node.name, "sr")) return false;
  return (
    ts.isObjectLiteralExpression(node.parent) &&
    node.parent.properties.some(
      (property) => ts.isPropertyAssignment(property) && isPropertyNamed(property.name, "en"),
    )
  );
}

/** True for a variable that IS an English table: `EN`, `EN_…`, `…_EN`. */
function isEnglishTableName(name) {
  if (!ts.isIdentifier(name)) return false;
  const text = name.text;
  return text === "EN" || text.startsWith("EN_") || text.endsWith("_EN");
}

/**
 * True for a branch guard that means „main is serving English".
 *
 * `notificationStrings.ts` composes its sentences per event rather than holding
 * them in a table, so `if (isEnglish())` and `isEnglish() ? … : …` are where its
 * English half lives — and a table-only rule would read none of it. The second
 * spelling is the comparison main writes where it has no predicate:
 * `mainLocale() === "en"`.
 */
function isEnglishGuard(expression) {
  const isCall = (node, name) =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
  if (isCall(expression, "isEnglish")) return true;
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    const isEn = (node) => ts.isStringLiteral(node) && node.text === "en";
    const { left, right } = expression;
    return (isCall(left, "mainLocale") && isEn(right)) || (isEn(left) && isCall(right, "mainLocale"));
  }
  return false;
}

/**
 * True for the generated-artefact idiom `pick(language, sr, en)` — the one
 * place in this tree where the English line of a user-visible document is an
 * ARGUMENT rather than a table entry (`electronics/ros.ts` and `sketch.ts`, the
 * README and the sketch Nexus writes for the user to open outside the app).
 *
 * The third argument, because that is what the parameter list says: the two
 * files define it as `function pick(language, sr, en)`. `canvasPalette.ts` and
 * `cryptoTools.ts` have a two-argument `pick` of their own and are not this one;
 * a call with fewer than three arguments is therefore not read.
 */
function isGeneratedPick(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "pick" &&
    node.arguments.length >= 3
  );
}

/**
 * The literals a value is made of, in an object or array literal: a property's
 * KEY is skipped (an `EN` map's keys are the Serbian string it translates),
 * everything else is read.
 */
function collectValueLiterals(node, out, sourceFile) {
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) collectValueLiterals(property.initializer, out, sourceFile);
      else if (ts.isSpreadAssignment(property)) collectValueLiterals(property.expression, out, sourceFile);
    }
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) collectValueLiterals(element, out, sourceFile);
    return;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ text: node.text, line: lineOf(sourceFile, node) });
    return;
  }
  if (ts.isTemplateExpression(node)) {
    // A wrapped sentence is one sentence: `"…" + "…"` and a template's chunks
    // are read separately, which is what the finding reports anyway.
    out.push({ text: node.head.text, line: lineOf(sourceFile, node.head) });
    for (const span of node.templateSpans) {
      out.push({ text: span.literal.text, line: lineOf(sourceFile, span.literal) });
    }
    return;
  }
  ts.forEachChild(node, (child) => collectValueLiterals(child, out, sourceFile));
}

/** The English copy a file holds, as `[{ text, line }]`. */
function englishLiterals(relPath, sourceFile) {
  if (isEnglishTable(relPath)) return literalsOf(sourceFile);
  const out = [];
  const collectBranch = (node) => collectValueLiterals(node, out, sourceFile);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isEnglishPropertyName(node.name)) {
      collectBranch(node.initializer);
      return;
    }
    if (ts.isVariableDeclaration(node) && isEnglishTableName(node.name) && node.initializer) {
      collectBranch(node.initializer);
      return;
    }
    if (ts.isIfStatement(node) && isEnglishGuard(node.expression)) {
      collectBranch(node.thenStatement);
      if (node.elseStatement) visit(node.elseStatement);
      return;
    }
    if (ts.isConditionalExpression(node) && isEnglishGuard(node.condition)) {
      collectBranch(node.whenTrue);
      visit(node.whenFalse);
      return;
    }
    if (isGeneratedPick(node)) {
      collectBranch(node.arguments[node.arguments.length - 1]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** The file's copy, with the whitespace collapsed so a wrapped sentence is one line in the report. */
const brief = (text) => {
  const collapsed = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 90)}…` : collapsed;
};

/**
 * True for a literal that is an identifier or a slug rather than a sentence: one
 * lowercase token, carrying a separator or a digit (`rok-poslednji-dan`,
 * `jedinicna-cena`, `http-status`). The separator is required, so a bare
 * lowercase word stays judged — `"sacuvaj"` in an English table is a leaf
 * somebody forgot to translate, and a rule that excused it would excuse exactly
 * the shape a copy-paste leaves behind.
 */
const looksLikeIdentifier = (text) =>
  !/\s/.test(text) && /^[a-z0-9._-]+$/.test(text) && /[-_.0-9]/.test(text);

/**
 * True for a token written the way a WORD is written — all lower case,
 * capitalised, or shouted. `zA` (half of `[a-zA-Z_]`) and `someWord` are
 * identifiers rather than words, and an acronym is matched: `NEMA` is the one
 * case where a stoplist word and an English acronym collide, and it is
 * allowlisted where it is written.
 */
const looksLikeWord = (token) =>
  token === token.toLowerCase() ||
  token === token.toUpperCase() ||
  token === token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();

/**
 * Rule 1 for one file: the English copy it holds, checked for a Serbian letter
 * and for a stoplist word as a whole word.
 */
export function englishFindings(relPath, source) {
  if (isTestFile(relPath)) return [];
  const sourceFile = parse(relPath, source);
  const findings = [];
  for (const literal of englishLiterals(relPath, sourceFile)) {
    if (
      ENGLISH_ALLOWLIST.some(
        (entry) => entry.file === relPath && literal.text.includes(entry.contains),
      )
    ) {
      continue;
    }
    const letters = [...literal.text].filter((char) => SERBIAN_LETTERS.test(char));
    if (letters.length > 0) {
      findings.push({
        rule: "english-letter",
        file: relPath,
        line: literal.line,
        detail: [...new Set(letters)].join(" "),
        text: brief(literal.text),
      });
      continue;
    }
    if (looksLikeIdentifier(literal.text)) continue;
    const words = literal.text
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((token) => looksLikeWord(token) && SERBIAN_WORD_SET.has(token.toLowerCase()));
    if (words.length > 0) {
      findings.push({
        rule: "english-word",
        file: relPath,
        line: literal.line,
        detail: [...new Set(words.map((word) => word.toLowerCase()))].join(" "),
        text: brief(literal.text),
      });
    }
  }
  return findings;
}

const isSerbianSource = (relPath) =>
  SERBIAN_SOURCES.some((entry) => entry.match.test(relPath));

/** The files rule 2 actually judges — the same predicate `serbianFindings` opens with. */
const isJudgedSerbianSource = (relPath) =>
  !isTestFile(relPath) && !isEnglishTable(relPath) && isSerbianSource(relPath);

/** Rule 2 for one file: a Serbian letter in a literal that is not in a Serbian table. */
export function serbianFindings(relPath, source) {
  if (isTestFile(relPath) || isEnglishTable(relPath) || isSerbianSource(relPath)) return [];
  const findings = [];
  for (const literal of literalsOf(parse(relPath, source), isSerbianHalf)) {
    if (
      SERBIAN_LITERAL_ALLOWLIST.some(
        (entry) => entry.file === relPath && literal.text.includes(entry.contains),
      )
    ) {
      continue;
    }
    if (SERBIAN_LETTERS.test(literal.text)) {
      findings.push({
        rule: "stray-serbian",
        file: relPath,
        line: literal.line,
        detail: "Serbian letters outside a Serbian table",
        text: brief(literal.text),
      });
    }
  }
  return findings;
}

/** Both rules over the whole tree, plus the census the verdict is printed beside. */
export function scanRepo(root = REPO_ROOT) {
  const files = scanFiles(root);
  const findings = [];
  let englishTables = 0;
  let serbianSources = 0;
  for (const relPath of files) {
    const source = readFileSync(join(root, ...relPath.split("/")), "utf8");
    if (isEnglishTable(relPath)) englishTables += 1;
    if (isJudgedSerbianSource(relPath)) serbianSources += 1;
    findings.push(...englishFindings(relPath, source), ...serbianFindings(relPath, source));
  }
  return { findings, census: { files: files.length, englishTables, serbianSources } };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, census } = scanRepo();
  const censusLine =
    `${census.files} files walked, ${census.englishTables} English tables, ` +
    `${census.serbianSources} allowlisted Serbian sources`;
  if (findings.length === 0) {
    console.log(`check-english: no Serbian in English copy, and none outside a Serbian table (${censusLine}).`);
    process.exit(0);
  }
  const stray = findings.filter((finding) => finding.rule === "stray-serbian");
  const english = findings.filter((finding) => finding.rule !== "stray-serbian");
  console.error(`check-english: ${findings.length} finding(s).\n`);
  if (english.length > 0) {
    console.error(`Serbian in English copy (${english.length}) — translate it, or add it to`);
    console.error("ENGLISH_ALLOWLIST with the reason it is not copy:\n");
    for (const finding of english) {
      console.error(`  ${finding.file}:${finding.line}  [${finding.detail}]  ${finding.text}`);
    }
    console.error("");
  }
  if (stray.length > 0) {
    console.error(`Serbian literals outside a Serbian table (${stray.length}) — put the text in a`);
    console.error("table, or add the file to SERBIAN_SOURCES / the literal allowlist:\n");
    for (const finding of stray) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.text}`);
    }
    console.error("");
  }
  console.error("A user-facing string is English when English is served — both halves, the");
  console.error("English table and the English body beside a Serbian one.");
  process.exit(1);
}
