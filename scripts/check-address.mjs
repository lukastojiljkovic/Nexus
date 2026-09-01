// No shebang — same reason as the other gates: this module is a CLI and an
// import target for its own tests, and Vite does not strip a shebang from an
// `.mjs` it transforms.
//
// WHY THIS GATE EXISTS. Serbian has no genderless past tense. The l-participle
// agrees with its subject, so the moment a sentence addresses the reader in the
// past — „šta si uneo", „nisi izabrao", „granica koju si uneo" — it has picked
// the reader's gender, and the only gender it ever picked here was masculine.
// Forty such lines shipped, and several were a documented HOUSE CONVENTION that
// six file headers told the next author to copy. Thirty-eight of the forty were
// there for the first version of this rule to find; the last two are why it has
// the two widenings below (one adjective, one sentence split across a `+`).
//
// Nothing else in the tree can see this. It is valid Serbian, valid TypeScript
// and correct-looking in every screenshot; the screenshot sweep measures
// geometry, `check:strings` measures when a read happens, and the suites assert
// keys rather than grammar. Review missed it across every pass this drawer has
// had — which is the test a gate has to pass before it earns its keep.
//
// THE RULE. A Serbian user-facing string may not contain a second-person marker
// („si" / „nisi") together with an l-participle. The fixes are ordinary Serbian
// and read better than what they replace:
//
//     „Granica koju si uneo"          → „Tvoja granica"        (possessive)
//     „vrednosti koje si uneo"        → „vrednosti koje uneseš" (present)
//     „Nisi ništa izabrao"            → „Bez odgovora…"         (impersonal)
//     „Proveri da si nalepio ceo…"    → „Proveri da li je nalepljen ceo…" (passive)
//
// SCOPE. Only string LITERALS — the gate parses with the TypeScript compiler
// rather than reading lines, so a comment that names the banned phrasing in
// order to forbid it does not trip it. It reads the Serbian copy tables and
// everything in `OTHER_COPY` below: main's native-dialog strings, and the one
// package that GENERATES Serbian into files the user opens outside Nexus.
// „Only the copy tables" was true until a code generator started writing a
// README, which is the shape of hole this gate was built to close.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

const STRINGS_DIR = join("apps", "desktop", "src", "renderer", "src", "strings");

/**
 * Serbian that reaches a person from somewhere other than a copy table.
 *
 * `shellStrings.ts` is main's — native dialog titles and filter names, which
 * the renderer's tables cannot hold because a native dialog is opened before
 * any renderer exists. `electronics/` is the one package that *generates*
 * Serbian: ADR-085 E4 writes a README, a Python docstring and a manifest
 * description into files the user opens outside Nexus, and the catalogue's 153
 * component summaries are read on screen.
 *
 * Whole directories rather than named files, deliberately (DC-61: a rule over a
 * reachability set permits everything outside it). A fourth generator or a new
 * catalogue shelf is covered without anyone remembering this line exists — and
 * scanning an English-only file costs nothing, because the gate fires on
 * Serbian trigger words and there are none in it.
 */
const OTHER_COPY = [
  join("apps", "desktop", "src", "main", "shellStrings.ts"),
  join("packages", "core", "src", "electronics"),
];

/** The second-person markers. „si" is also the auxiliary in „nisi", spelled out. */
const ADDRESS = new Set(["si", "nisi"]);

/**
 * Words that end in a participle's letters and are not participles: ordinary
 * nouns and adjectives that would otherwise fire whenever „si" is in the same
 * sentence. Kept deliberately short — every addition is a word the gate stops
 * watching, so it belongs here only when the word cannot BE a participle.
 */
export const NOT_PARTICIPLES = new Set([
  "kao", // the comparative particle, and the commonest word that ends this way
  "ceo", // adjective — „ceo odgovor"
  "deo", // noun — „deo teksta"
  "posao", // noun — „tvoj posao"
  "radio", // noun (the device); the verb „raditi" makes „radio" too, but the
  // noun is what this tree uses and a participle beside it needs „si"
  "studio",
  "portfolio",
  "scenario",
  "video", // noun — „slika, zvuk i video"
  "kakao",
  "zreo",
  "veo",
  "trio",
  "duo",
]);

/**
 * Predicative adjectives, masculine singular — the OTHER way a sentence picks
 * the reader's gender, and one no participle rule can see.
 *
 * „proveri ako nisi siguran" shipped in `pro.trening.ts` under the first
 * version of this gate, in a sentence about women's barbells. `siguran` is an
 * adjective, not an l-participle, and Serbian adjectives agree with what they
 * describe exactly as participles do; the gate was written for one of the two
 * constructions the class covers.
 *
 * A LIST rather than a pattern, because a masculine adjective ends in a
 * consonant and so does most of the language — „slobodan prostor" and „naziv je
 * obavezan" are two dozen honest lines in this tree, all agreeing with a NOUN.
 * What makes the pair precise is the `si`/`nisi` beside it, so this holds only
 * words a person can be TOLD they are.
 */
export const MASCULINE_PREDICATES = new Set([
  "siguran",
  "spreman",
  "zadovoljan",
  "slobodan",
  "umoran",
  "svestan",
  "voljan",
  "dužan",
  "sposoban",
  "obavezan",
  "saglasan",
  "upoznat",
  "prijavljen",
  "ulogovan",
  "primoran",
  "zainteresovan",
  "gotov",
]);

/** Serbian, Latin script: the letters a word may be made of. */
const LETTERS = /[^\p{L}]+/u;

/**
 * The l-participle test, masculine singular: a word of three letters or more
 * ending in a vowel + „o" (uneo, rekao, izabrao, video, mogao, umro is „o"
 * after a consonant and deliberately NOT matched — it cannot appear with „si"
 * in this product's copy without one of the matched forms beside it).
 */
export function isParticiple(word) {
  const lower = word.toLowerCase();
  return lower.length >= 3 && /[aieu]o$/u.test(lower) && !NOT_PARTICIPLES.has(lower);
}

/** Does one Serbian sentence tell the reader what gender they are? */
export function offendingWord(text) {
  const words = text.split(LETTERS).filter((word) => word.length > 0);
  if (!words.some((word) => ADDRESS.has(word.toLowerCase()))) return null;
  return (
    words.find((word) => isParticiple(word) || MASCULINE_PREDICATES.has(word.toLowerCase())) ?? null
  );
}

const isQuoted = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** A `"…" + "…"` chain — how a sentence longer than 100 columns is written here. */
const isConcat = (node) =>
  node !== undefined &&
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.PlusToken;

/**
 * The chain's operands left to right: the static text of each literal, and one
 * space for anything else, so an interpolated name cannot fuse the word before
 * it to the word after.
 */
function concatParts(node, text, leaves) {
  if (isConcat(node)) {
    concatParts(node.left, text, leaves);
    concatParts(node.right, text, leaves);
    return;
  }
  if (isQuoted(node)) {
    text.push(node.text);
    leaves.push(node);
    return;
  }
  text.push(" ");
}

/**
 * Every string literal in a source file, with the line it sits on. Template
 * literals count: their static spans are copy exactly as a quoted string is.
 *
 * **A concatenation is scanned as ONE sentence, not as its pieces.** The copy
 * is hand-wrapped near 100 columns, so a line long enough to need `+` puts its
 * words either side of the operator by pure accident of length — and „…proveri
 * ako " + "nisi siguran." is one sentence to the reader and two literals to a
 * parser. Scanning the pieces separately makes the trigger and the word it
 * governs invisible to each other, which is a hole shaped exactly like the
 * defect this gate exists for. The chain replaces its own leaves in the output
 * rather than adding to them, so a sentence is reported once.
 */
export function literalsOf(relPath, source) {
  const parsed = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const out = [];
  const joined = new Set();
  const visit = (node) => {
    if (isConcat(node) && !isConcat(node.parent)) {
      const text = [];
      const leaves = [];
      concatParts(node, text, leaves);
      if (leaves.length > 0) {
        for (const leaf of leaves) joined.add(leaf);
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        out.push({ line: line + 1, text: text.join("") });
      }
    }
    if (
      (isQuoted(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      !joined.has(node)
    ) {
      const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      out.push({ line: line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return out;
}

export function scanSource(relPath, source) {
  const findings = [];
  for (const { line, text } of literalsOf(relPath, source)) {
    const word = offendingWord(text);
    if (word !== null) findings.push({ file: relPath, line, word, text });
  }
  return findings;
}

/**
 * Every file that can put a Serbian sentence in front of a person: the copy
 * tables — the facade and the per-pack files it pulls in — plus {@link
 * OTHER_COPY}.
 */
export function scanFiles(root = REPO_ROOT) {
  const files = [join(root, "apps", "desktop", "src", "renderer", "src", "strings.sr.ts")];
  for (const entry of readdirSync(join(root, STRINGS_DIR)).sort()) {
    if (entry.endsWith(".ts")) files.push(join(root, STRINGS_DIR, entry));
  }
  for (const entry of OTHER_COPY) files.push(...sourcesUnder(join(root, entry)));
  return files;
}

/** One `.ts` file, or every non-test `.ts` beneath a directory, sorted. */
function sourcesUnder(path) {
  if (!statSync(path).isDirectory()) return [path];
  const found = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(child));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(child);
  }
  return found;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const file of scanFiles(root)) {
    const rel = relative(root, file).split(sep).join("/");
    findings.push(...scanSource(rel, readFileSync(file, "utf8")));
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `Serbian address audit FAILED — ${findings.length} line(s) address the reader as a man:\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  „${f.word}“\n    ${f.text}`);
    }
    console.error(
      "\nSerbian l-participles AND predicative adjectives agree with the person\n" +
        "addressed, so „šta si uneo“ and „ako nisi siguran“ have both chosen a\n" +
        "gender. Rewrite as a possessive („tvoja granica“), the present\n" +
        "(„vrednosti koje uneseš“), the impersonal („proveri za svaki slučaj“) or\n" +
        "the passive („da li je nalepljen ceo odgovor“) — each is ordinary Serbian\n" +
        "and none of them picks a gender.\n" +
        "If a flagged word genuinely is a noun rather than a participle, add it to\n" +
        "NOT_PARTICIPLES in scripts/check-address.mjs.",
    );
    process.exit(1);
  }
  console.log("Serbian address audit OK");
}
