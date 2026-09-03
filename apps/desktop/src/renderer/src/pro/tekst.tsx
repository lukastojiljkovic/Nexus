import {
  bracketBalance,
  glossaryCheck,
  hiddenCharacters,
  type ScriptName,
  type HiddenKind,
  isbnCheck,
  type IsbnKind,
  mojibakeRepair,
  type MojibakeEncoding,
  numberCheck,
  numberToSerbianWords,
  type ThousandForm,
  type DecimalsMode,
  readingTime,
  sentenceLength,
  transliterate,
  subtitleAudit,
  subtitleRetime,
  parseTimecode,
  FRAME_RATES,
  translationVolume,
  type ChargeUnit,
  typographyCleanup,
  type QuoteStyle,
  unwrapParagraphs,
  wordFrequency,
} from "@nexus/core/pro/tekst";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Tekst i prevod" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/tekst.ts`'s: every tool here holds
 * `useState` strings, parses them with `proParse` where a field is numeric, and
 * prints what the core function returns. Nothing in this file divides, rounds,
 * counts code points or matches a regular expression — that is what made the
 * core module testable against hand-worked vectors in the first place, and a
 * second copy here would be a second, untested answer to the same question.
 *
 * **None of these sixteen tools carries `life-safety` or `food-safety` risk**,
 * so the strict „print the quantity, never a verdict" rule is not what shapes
 * this file — nothing here compares a measurement to a building code or a
 * temperature. Three tools (`number-check`, `number-to-serbian-words`,
 * `translation-volume`) are `financial`: a wrong digit or a wrong word is money,
 * not a fall, and the discipline that still applies is the ordinary one — show
 * the formula, echo the inputs, never silently invent a separator or a rate.
 *
 * **A short, non-destructive preview for the input echo.** Several tools here
 * take a paste of up to half a million code points as their one input; showing
 * it back in full inside `ToolInputEcho` would defeat the point of an echo (a
 * glance, not a second copy of the field), so this trims for DISPLAY only — it
 * is never read by a core function and never feeds a result.
 */
function preview(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** „Uključeno" / „Isključeno" as a two-way choice — the kit has no switch. */
type OnOff = "on" | "off";

const ON_OFF_OPTIONS = (
  onLabel: string,
  offLabel: string,
): readonly { readonly id: OnOff; readonly label: string }[] => [
  { id: "off", label: offLabel },
  { id: "on", label: onLabel },
];

// ---------------------------------------------------------------------------
// bracket-balance — Zagrade i navodnici
// ---------------------------------------------------------------------------

/**
 * Every unclosed opener, every closer with nothing to match, the deepest
 * nesting, and every paragraph whose straight quotes do not come in pairs.
 * `bracketBalance` takes only the pasted text — the two ambiguous quote pairs
 * (U+201C, U+2018) resolve off the bracket stack itself and need no choice from
 * the user.
 */
export function BracketBalanceTool() {
  const s = strings.pro.tekst["bracket-balance"];
  const [text, setText] = useState("");

  const typed = text !== "";
  const result = bracketBalance({ text });
  const failure = result.ok || !typed ? undefined : s.errorText;

  const copyText = !result.ok
    ? ""
    : [
        `${s.maxDepth}: ${result.maxDepth}`,
        "",
        `${s.unclosedSection} (${result.unclosed.length})`,
        ...result.unclosed.map((p) => `${p.char} — ${s.colLine} ${p.line}, ${s.colColumn} ${p.column}`),
        "",
        `${s.unmatchedSection} (${result.unmatched.length})`,
        ...result.unmatched.map(
          (u) =>
            `${u.char} — ${s.colLine} ${u.line}, ${s.colColumn} ${u.column}, ${s.colOpenOnTop}: ${
              u.openOnTop ?? s.stackEmpty
            }`,
        ),
        "",
        `${s.oddQuoteSection} (${result.oddQuoteParagraphs.length})`,
        ...result.oddQuoteParagraphs.map(
          (p) =>
            `${s.colParagraph} ${p.paragraph} (${s.colStartLine} ${p.startLine}) — ` +
            `"×${p.doubleQuotes}, '×${p.singleQuotes}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.maxDepth} value={result.maxDepth} />

          <ToolSection title={s.unclosedSection}>
            {result.unclosed.length === 0 ? (
              <p className="tool__note">{s.unclosedNone}</p>
            ) : (
              <ToolTable
                head={[s.colChar, s.colLine, s.colColumn]}
                rows={result.unclosed.map((p) => [p.char, p.line, p.column])}
              />
            )}
          </ToolSection>

          <ToolSection title={s.unmatchedSection}>
            {result.unmatched.length === 0 ? (
              <p className="tool__note">{s.unmatchedNone}</p>
            ) : (
              <ToolTable
                head={[s.colChar, s.colLine, s.colColumn, s.colOpenOnTop]}
                rows={result.unmatched.map((u) => [u.char, u.line, u.column, u.openOnTop ?? s.stackEmpty])}
              />
            )}
          </ToolSection>

          <ToolSection title={s.oddQuoteSection}>
            {result.oddQuoteParagraphs.length === 0 ? (
              <p className="tool__note">{s.oddQuoteNone}</p>
            ) : (
              <ToolTable
                head={[s.colParagraph, s.colStartLine, s.colDoubleQuotes, s.colSingleQuotes]}
                rows={result.oddQuoteParagraphs.map((p) => [
                  p.paragraph,
                  p.startLine,
                  p.doubleQuotes,
                  p.singleQuotes,
                ])}
              />
            )}
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.text, value: preview(text) }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// glossary-check — Provera terminologije
// ---------------------------------------------------------------------------

const GLOSSARY_STATUS_LABEL: Readonly<Record<string, (s: typeof strings.pro.tekst["glossary-check"]) => string>> = {
  match: (s) => s.statusMatch,
  differs: (s) => s.statusDiffers,
  missing: (s) => s.statusMissing,
  extra: (s) => s.statusExtra,
  absent: (s) => s.statusAbsent,
};

/**
 * Every glossary term, counted on both sides of a translation — never a
 * judgement on the translation itself, only on whether the string the user
 * typed occurred the number of times they said it should.
 */
export function GlossaryCheckTool() {
  const s = strings.pro.tekst["glossary-check"];
  const [original, setOriginal] = useState("");
  const [translation, setTranslation] = useState("");
  const [glossary, setGlossary] = useState("");
  const [caseSensitive, setCaseSensitive] = useState<OnOff>("off");
  const [wholeWord, setWholeWord] = useState<OnOff>("off");

  const typed = original !== "" || translation !== "" || glossary !== "";
  const result = glossaryCheck({
    original,
    translation,
    glossary,
    caseSensitive: caseSensitive === "on",
    wholeWord: wholeWord === "on",
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "original"
        ? s.errorOriginal
        : result.reason === "translation"
          ? s.errorTranslation
          : s.errorGlossary;

  const statusLabel = (status: string): string => (GLOSSARY_STATUS_LABEL[status] ?? GLOSSARY_STATUS_LABEL["absent"])?.(s) ?? "";

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.source} → ${row.target}: ${row.inOriginal}/${row.inTranslation} — ${statusLabel(row.status)}`,
        ),
        "",
        `${s.invalidRows}: ${result.invalidRows.length === 0 ? s.invalidRowsNone : result.invalidRows.join(", ")}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.original} hint={s.originalHint} value={original} onChange={setOriginal} rows={6} />
      <ToolTextArea
        label={s.translation}
        hint={s.translationHint}
        value={translation}
        onChange={setTranslation}
        rows={6}
      />
      <ToolTextArea label={s.glossary} hint={s.glossaryHint} value={glossary} onChange={setGlossary} rows={6} />
      <ToolSelect<OnOff>
        label={s.caseSensitive}
        value={caseSensitive}
        onChange={setCaseSensitive}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff>
        label={s.wholeWord}
        value={wholeWord}
        onChange={setWholeWord}
        hint={s.wholeWordHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.rows.length === 0 ? (
            <p className="tool__note">{s.rowsNone}</p>
          ) : (
            <ToolTable
              head={[s.colSource, s.colTarget, s.colInOriginal, s.colInTranslation, s.colStatus]}
              rows={result.rows.map((row) => [
                row.source,
                row.target,
                row.inOriginal,
                row.inTranslation,
                statusLabel(row.status),
              ])}
            />
          )}
          <ResultRow
            label={s.invalidRows}
            value={result.invalidRows.length === 0 ? s.invalidRowsNone : result.invalidRows.join(", ")}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.original, value: preview(original) },
              { label: s.translation, value: preview(translation) },
              { label: s.caseSensitive, value: caseSensitive === "on" ? s.on : s.off },
              { label: s.wholeWord, value: wholeWord === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// isbn-issn-check — ISBN i ISSN
// ---------------------------------------------------------------------------

const ISBN_KIND_LABEL: Readonly<Record<IsbnKind, (s: typeof strings.pro.tekst["isbn-issn-check"]) => string>> = {
  isbn10: (s) => s.kindIsbn10,
  isbn13: (s) => s.kindIsbn13,
  issn: (s) => s.kindIssn,
  issn13: (s) => s.kindIssn13,
  ismn: (s) => s.kindIsmn,
  ean13: (s) => s.kindEan13,
};

/**
 * The check digit of an ISBN, ISSN, ISMN or EAN-13 against the one written —
 * both digits always shown, never only on a mismatch — plus the conversion
 * between ISBN-10 and ISBN-13 where one applies. No hyphens are ever inserted:
 * their placement depends on registration-group ranges this tool does not
 * carry, and the check digit does not depend on them either.
 */
export function IsbnIssnCheckTool() {
  const s = strings.pro.tekst["isbn-issn-check"];
  const [numberText, setNumberText] = useState("");
  const [kind, setKind] = useState<IsbnKind | "auto">("auto");

  const typed = numberText !== "";
  const result = isbnCheck({ number: numberText, kind });
  const failure = result.ok || !typed ? undefined : result.reason === "kind" ? s.errorKind : s.errorNumber;

  const kindLabel = (k: IsbnKind): string => ISBN_KIND_LABEL[k](s);

  const copyText = !result.ok
    ? ""
    : [
        `${s.recognizedKind}: ${kindLabel(result.kind)}`,
        `${s.digits}: ${result.digits}`,
        `${s.checkDigit}: ${result.checkDigit}`,
        `${s.expectedCheckDigit}: ${result.expectedCheckDigit}`,
        `${s.matches}: ${result.checkDigitMatches ? s.matchYes : s.matchNo}`,
        result.isbn13 === undefined ? undefined : `${s.isbn13}: ${result.isbn13}`,
        result.isbn10 === undefined ? undefined : `${s.isbn10}: ${result.isbn10}`,
        result.issn8 === undefined ? undefined : `${s.issn8}: ${result.issn8}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.number} hint={s.numberHint} value={numberText} onChange={setNumberText} mono />
      <ToolSelect<IsbnKind | "auto">
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "auto", label: s.kindAuto },
          { id: "isbn10", label: s.kindIsbn10 },
          { id: "isbn13", label: s.kindIsbn13 },
          { id: "issn", label: s.kindIssn },
          { id: "ismn", label: s.kindIsmn },
          { id: "ean13", label: s.kindEan13 },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.recognizedKind} value={kindLabel(result.kind)} />
          <ResultRow label={s.checkDigit} value={result.checkDigit} />
          <ResultRow label={s.expectedCheckDigit} value={result.expectedCheckDigit} />
          <ResultRow label={s.matches} value={result.checkDigitMatches ? s.matchYes : s.matchNo} />
          {result.isbn13 !== undefined && <ResultRow label={s.isbn13} value={result.isbn13} />}
          {result.isbn10 !== undefined && <ResultRow label={s.isbn10} value={result.isbn10} />}
          {result.issn8 !== undefined && <ResultRow label={s.issn8} value={result.issn8} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.number, value: numberText.trim() },
              { label: s.kind, value: kind === "auto" ? s.kindAuto : kindLabel(kind) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// mojibake-repair — Popravka kodiranja
// ---------------------------------------------------------------------------

/** Adds a placeholder so a select whose core field has no default can start unset. */
type MojibakeField = MojibakeEncoding | "unset";

const ENCODING_OPTIONS: readonly { readonly id: MojibakeField; readonly label: string }[] = [
  { id: "utf-8", label: "UTF-8" },
  { id: "windows-1250", label: "Windows-1250" },
  { id: "windows-1252", label: "Windows-1252" },
  { id: "iso-8859-1", label: "ISO-8859-1" },
  { id: "iso-8859-2", label: "ISO-8859-2" },
];

function encodingLabel(id: MojibakeField, placeholder: string): string {
  if (id === "unset") return placeholder;
  return ENCODING_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/**
 * Undoes bytes written in one encoding and read in another — the exact reverse
 * of the damage, one step per direction, and neither step repaired on failure.
 * Text that already carries U+FFFD is refused before any arithmetic: those
 * bytes are already gone and no computation brings them back.
 */
export function MojibakeRepairTool() {
  const s = strings.pro.tekst["mojibake-repair"];
  const [text, setText] = useState("");
  const [writtenAs, setWrittenAs] = useState<MojibakeField>("unset");
  const [readAs, setReadAs] = useState<MojibakeField>("unset");

  const typed = text !== "";
  const ready = writtenAs !== "unset" && readAs !== "unset";
  const result = ready ? mojibakeRepair({ text, writtenAs, readAs }) : undefined;
  const failure =
    result === undefined || result.ok || !typed
      ? undefined
      : result.reason === "replacementCharacter"
        ? s.errorReplacementCharacter
        : result.reason === "readAs"
          ? s.errorReadAs
          : result.reason === "writtenAs"
            ? s.errorWrittenAs
            : s.errorText;

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [
          result.repaired === undefined ? s.notPossible : `${s.repaired}: ${result.repaired}`,
          `${s.unmappableCount}: ${result.unmappableCount}`,
          `${s.invalidByteCount}: ${result.invalidByteCount}`,
          `${s.resolvedWrittenAs}: ${result.resolvedWrittenAs}`,
          `${s.resolvedReadAs}: ${result.resolvedReadAs}`,
        ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={8} />
      <ToolSelect<MojibakeField>
        label={s.writtenAs}
        value={writtenAs}
        onChange={setWrittenAs}
        hint={s.writtenAsHint}
        options={[{ id: "unset", label: s.selectPlaceholder }, ...ENCODING_OPTIONS]}
      />
      <ToolSelect<MojibakeField>
        label={s.readAs}
        value={readAs}
        onChange={setReadAs}
        hint={s.readAsHint}
        options={[{ id: "unset", label: s.selectPlaceholder }, ...ENCODING_OPTIONS]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          {result.repaired === undefined ? (
            <p className="tool__note">{s.notPossible}</p>
          ) : (
            <ToolOutput label={s.repaired} value={result.repaired} multiline />
          )}
          <ResultRow label={s.unmappableCount} value={result.unmappableCount} />
          {result.unmappable.length > 0 && (
            <ToolTable head={[s.colIndex, s.colChar]} rows={result.unmappable.map((u) => [u.index, u.char])} />
          )}
          <ResultRow label={s.invalidByteCount} value={result.invalidByteCount} />
          {result.invalidBytes.length > 0 && (
            <ToolTable
              head={[s.colIndex, s.colByte]}
              rows={result.invalidBytes.map((b) => [b.index, proNum(b.byte, 0)])}
            />
          )}
          <ResultRow label={s.resolvedWrittenAs} value={result.resolvedWrittenAs} />
          <ResultRow label={s.resolvedReadAs} value={result.resolvedReadAs} />
          {result.collisions.length > 0 && <ResultRow label={s.collisions} value={result.collisions.length} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.writtenAs, value: encodingLabel(writtenAs, s.selectPlaceholder) },
              { label: s.readAs, value: encodingLabel(readAs, s.selectPlaceholder) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// number-check — Provera brojeva
// ---------------------------------------------------------------------------

/**
 * Every number met in the original against every number met in the
 * translation, compared on the digit string alone — so „1.500,00" and
 * „1,500.00" pair as the same number while 12.345 against 12.354 does not.
 */
export function NumberCheckTool() {
  const s = strings.pro.tekst["number-check"];
  const [original, setOriginal] = useState("");
  const [translation, setTranslation] = useState("");

  const typed = original !== "" || translation !== "";
  const result = numberCheck({ original, translation });
  const failure = result.ok || !typed ? undefined : result.reason === "original" ? s.errorOriginal : s.errorTranslation;

  const formsText = (forms: readonly string[]): string => (forms.length === 0 ? "—" : forms.join(", "));

  const copyText = !result.ok
    ? ""
    : [
        `${s.pairedCount}: ${result.pairedCount}`,
        `${s.onlyInOriginalCount}: ${result.onlyInOriginalCount}`,
        `${s.onlyInTranslationCount}: ${result.onlyInTranslationCount}`,
        "",
        `${s.pairedSection}:`,
        ...result.paired.map((row) => `${row.digits} — ${formsText(row.formsInOriginal)} / ${formsText(row.formsInTranslation)}`),
        "",
        `${s.onlyOriginalSection}:`,
        ...result.onlyInOriginal.map((row) => `${row.digits} — ${formsText(row.formsInOriginal)} ×${row.count}`),
        "",
        `${s.onlyTranslationSection}:`,
        ...result.onlyInTranslation.map((row) => `${row.digits} — ${formsText(row.formsInTranslation)} ×${row.count}`),
        "",
        `${s.differentLengthSection}:`,
        ...result.differentLength.map(
          (row) => `${row.digits} — ${formsText(row.formsInOriginal)} / ${formsText(row.formsInTranslation)}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.original} hint={s.originalHint} value={original} onChange={setOriginal} rows={6} />
      <ToolTextArea
        label={s.translation}
        hint={s.translationHint}
        value={translation}
        onChange={setTranslation}
        rows={6}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.pairedCount} value={result.pairedCount} />
          <ResultRow label={s.onlyInOriginalCount} value={result.onlyInOriginalCount} />
          <ResultRow label={s.onlyInTranslationCount} value={result.onlyInTranslationCount} />

          <ToolSection title={s.pairedSection}>
            {result.paired.length === 0 ? (
              <p className="tool__note">{s.pairedNone}</p>
            ) : (
              <ToolTable
                head={[s.colDigits, s.colFormsOriginal, s.colFormsTranslation, s.colCount]}
                rows={result.paired.map((row) => [
                  row.digits,
                  formsText(row.formsInOriginal),
                  formsText(row.formsInTranslation),
                  row.count,
                ])}
              />
            )}
          </ToolSection>

          <ToolSection title={s.onlyOriginalSection}>
            {result.onlyInOriginal.length === 0 ? (
              <p className="tool__note">{s.onlyOriginalNone}</p>
            ) : (
              <ToolTable
                head={[s.colDigits, s.colFormsOriginal, s.colCount]}
                rows={result.onlyInOriginal.map((row) => [row.digits, formsText(row.formsInOriginal), row.count])}
              />
            )}
          </ToolSection>

          <ToolSection title={s.onlyTranslationSection}>
            {result.onlyInTranslation.length === 0 ? (
              <p className="tool__note">{s.onlyTranslationNone}</p>
            ) : (
              <ToolTable
                head={[s.colDigits, s.colFormsTranslation, s.colCount]}
                rows={result.onlyInTranslation.map((row) => [row.digits, formsText(row.formsInTranslation), row.count])}
              />
            )}
          </ToolSection>

          <ToolSection title={s.differentLengthSection}>
            {result.differentLength.length === 0 ? (
              <p className="tool__note">{s.differentLengthNone}</p>
            ) : (
              <ToolTable
                head={[s.colDigits, s.colFormsOriginal, s.colFormsTranslation]}
                rows={result.differentLength.map((row) => [
                  row.digits,
                  formsText(row.formsInOriginal),
                  formsText(row.formsInTranslation),
                ])}
              />
            )}
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.original, value: preview(original) },
              { label: s.translation, value: preview(translation) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// number-to-serbian-words — Broj slovima
// ---------------------------------------------------------------------------

/** Adds a placeholder so a select whose core field has no default can start unset. */
type ThousandFormField = ThousandForm | "unset";
type DecimalsField = DecimalsMode | "unset";

/**
 * A number written out in Serbian words, with the two genuinely open choices —
 * „hiljadu" or „jedna hiljada", and how the decimals read — left to the user
 * rather than picked for them.
 */
export function NumberToSerbianWordsTool() {
  const s = strings.pro.tekst["number-to-serbian-words"];
  const [valueText, setValueText] = useState("");
  const [script, setScript] = useState<"latin" | "cyrillic">("latin");
  const [thousandForm, setThousandForm] = useState<ThousandFormField>("unset");
  const [decimals, setDecimals] = useState<DecimalsField>("unset");

  const typed = valueText !== "";
  const ready = thousandForm !== "unset" && decimals !== "unset";
  const result = ready
    ? numberToSerbianWords({ value: valueText, script, thousandForm, decimals })
    : undefined;
  const failure = result === undefined || result.ok || !typed ? undefined : s.errorValue;

  const thousandFormLabel = (f: ThousandFormField): string =>
    f === "hiljadu" ? s.thousandFormHiljadu : f === "jednaHiljada" ? s.thousandFormJednaHiljada : s.selectPlaceholder;
  const decimalsLabel = (d: DecimalsField): string =>
    d === "fraction" ? s.decimalsFraction : d === "words" ? s.decimalsWords : d === "none" ? s.decimalsNone : s.selectPlaceholder;

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [result.text, result.decimalsTruncated ? s.truncatedNote : undefined]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolInput label={s.value} hint={s.valueHint} value={valueText} onChange={setValueText} mono />
      <ToolSelect<"latin" | "cyrillic">
        label={s.script}
        value={script}
        onChange={setScript}
        options={[
          { id: "latin", label: s.scriptLatinOpt },
          { id: "cyrillic", label: s.scriptCyrillicOpt },
        ]}
      />
      <ToolSelect<ThousandFormField>
        label={s.thousandForm}
        value={thousandForm}
        onChange={setThousandForm}
        hint={s.thousandFormHint}
        options={[
          { id: "unset", label: s.selectPlaceholder },
          { id: "hiljadu", label: s.thousandFormHiljadu },
          { id: "jednaHiljada", label: s.thousandFormJednaHiljada },
        ]}
      />
      <ToolSelect<DecimalsField>
        label={s.decimals}
        value={decimals}
        onChange={setDecimals}
        options={[
          { id: "unset", label: s.selectPlaceholder },
          { id: "fraction", label: s.decimalsFraction },
          { id: "words", label: s.decimalsWords },
          { id: "none", label: s.decimalsNone },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} />
          {result.decimalsTruncated && <p className="tool__note">{s.truncatedNote}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.value, value: valueText.trim() },
              { label: s.script, value: script === "latin" ? s.scriptLatinOpt : s.scriptCyrillicOpt },
              { label: s.thousandForm, value: thousandFormLabel(thousandForm) },
              { label: s.decimals, value: decimalsLabel(decimals) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// reading-time — Trajanje čitanja
// ---------------------------------------------------------------------------

/**
 * How long a text takes to read aloud at a pace the user measured — never a
 * built-in average, since 150 words a minute is somebody else's speaker.
 */
export function ReadingTimeTool() {
  const s = strings.pro.tekst["reading-time"];
  const [text, setText] = useState("");
  const [paceText, setPaceText] = useState("");
  const [pauseText, setPauseText] = useState("");

  const pauseBlank = pauseText.trim() === "";
  const typed = text !== "" || proParse(paceText) !== undefined;
  const result = readingTime({
    text,
    pace: proParse(paceText) ?? Number.NaN,
    pause: pauseBlank ? 0 : (proParse(pauseText) ?? Number.NaN),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "text"
        ? s.errorText
        : result.reason === "pace"
          ? s.errorPace
          : s.errorPause;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalClock}: ${result.totalClock}`,
        `${s.words}: ${result.words}`,
        `${s.displayedSum}: ${proNum(result.displayedSumSeconds, 0)} s`,
        "",
        ...result.paragraphs.map(
          (p) => `${p.index}. — ${p.words} ${s.words.toLowerCase()}, ${p.clock}, ${s.colEntry.toLowerCase()} ${p.entryClock}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolInput label={s.pace} hint={s.paceHint} value={paceText} onChange={setPaceText} />
      <ToolInput label={s.pause} hint={s.pauseHint} value={pauseText} onChange={setPauseText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalClock} value={result.totalClock} />
          <ResultRow label={s.words} value={result.words} />
          <ResultRow label={s.displayedSum} value={`${proNum(result.displayedSumSeconds, 0)} s`} />
          <p className="tool__note">{s.sumNote}</p>
          <ToolTable
            head={[s.colParagraph, s.colWords, s.colDuration, s.colEntry]}
            rows={result.paragraphs.map((p) => [p.index, p.words, p.clock, p.entryClock])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.pace, value: paceText.trim() },
              { label: s.pause, value: pauseBlank ? s.pauseZero : pauseText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// sentence-length — Dužina rečenica
// ---------------------------------------------------------------------------

/**
 * Every sentence, its own length, and which ones are longer than the
 * threshold the user typed — the whole segmentation rule is stated in the
 * formula line, because a split the reader cannot see is not one they can trust.
 */
export function SentenceLengthTool() {
  const s = strings.pro.tekst["sentence-length"];
  const [text, setText] = useState("");
  const [thresholdText, setThresholdText] = useState("");

  const typed = text !== "" || proParse(thresholdText) !== undefined;
  const result = sentenceLength({ text, threshold: proParse(thresholdText) ?? Number.NaN });
  const failure = result.ok || !typed ? undefined : result.reason === "text" ? s.errorText : s.errorThreshold;

  const copyText = !result.ok
    ? ""
    : [
        `${s.count}: ${result.count}`,
        `${s.totalWords}: ${result.totalWords}`,
        result.averageWords === undefined ? undefined : `${s.averageWords}: ${proNum(result.averageWords, 2)}`,
        result.longestIndex === undefined
          ? undefined
          : `${s.longest}: #${result.longestIndex} (${result.longestWords} ${s.words})`,
        "",
        ...result.sentences.map((sen) => `${sen.index}. (${sen.words}) ${sen.text}`),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolInput label={s.threshold} hint={s.thresholdHint} value={thresholdText} onChange={setThresholdText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.count} value={result.count} />
          <ResultRow label={s.totalWords} value={result.totalWords} />
          {result.averageWords !== undefined && (
            <ResultRow label={s.averageWords} value={proNum(result.averageWords, 2)} />
          )}
          {result.longestIndex !== undefined && (
            <ResultRow label={s.longest} value={`#${result.longestIndex} (${result.longestWords} ${s.words})`} />
          )}
          <ToolTable
            head={[s.colIndex, s.colWords, s.colText, s.colOverThreshold]}
            prose={[2]}
            rows={result.sentences.map((sen) => [
              sen.index,
              sen.words,
              sen.text,
              sen.overThreshold ? s.yes : s.no,
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.threshold, value: thresholdText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// hidden-characters — Skriveni znakovi
// ---------------------------------------------------------------------------

const HIDDEN_KIND_LABEL: Readonly<Record<HiddenKind, (s: typeof strings.pro.tekst["hidden-characters"]) => string>> = {
  control: (s) => s.kindControl,
  space: (s) => s.kindSpace,
  zeroWidth: (s) => s.kindZeroWidth,
  softHyphen: (s) => s.kindSoftHyphen,
  bidi: (s) => s.kindBidi,
};

const SCRIPT_LABEL: Readonly<Record<ScriptName, (s: typeof strings.pro.tekst["hidden-characters"]) => string>> = {
  Latin: (s) => s.scriptLatin,
  Cyrillic: (s) => s.scriptCyrillic,
  Greek: (s) => s.scriptGreek,
  Arabic: (s) => s.scriptArabic,
  Hebrew: (s) => s.scriptHebrew,
  Han: (s) => s.scriptHan,
  other: (s) => s.scriptOther,
};

/**
 * Every invisible or control code point, with its Unicode name and position,
 * and every word that silently mixes two scripts (a Cyrillic „С" inside an
 * otherwise Latin word). Neither is ever repaired automatically — which letter
 * was meant is a guess this tool refuses to make.
 */
export function HiddenCharactersTool() {
  const s = strings.pro.tekst["hidden-characters"];
  const [text, setText] = useState("");
  const [removeInvisible, setRemoveInvisible] = useState<OnOff>("off");
  const [normalizeSpaces, setNormalizeSpaces] = useState<OnOff>("off");
  const [removeSoftHyphen, setRemoveSoftHyphen] = useState<OnOff>("off");

  const typed = text !== "";
  const result = hiddenCharacters({
    text,
    removeInvisible: removeInvisible === "on",
    normalizeSpaces: normalizeSpaces === "on",
    removeSoftHyphen: removeSoftHyphen === "on",
  });
  const failure = result.ok || !typed ? undefined : s.errorText;

  const kindLabel = (kind: HiddenKind): string => HIDDEN_KIND_LABEL[kind](s);
  const scriptLabel = (script: ScriptName): string => SCRIPT_LABEL[script](s);

  const copyText = !result.ok
    ? ""
    : [
        `${s.codePointsBefore}: ${proNum(result.codePointsBefore, 0)}`,
        `${s.codePointsAfter}: ${proNum(result.codePointsAfter, 0)}`,
        "",
        ...result.findings.map(
          (f) => `${kindLabel(f.kind)} ${f.label} (${f.name}) — ${s.colLine} ${f.line}, ${s.colColumn} ${f.column}`,
        ),
        "",
        ...result.mixedScriptWords.map(
          (w) =>
            `${w.word}: ${w.scripts.map(scriptLabel).join(", ")} — ${s.colLine} ${w.line}, ${s.colColumn} ${w.column}`,
        ),
        "",
        s.cleaned,
        result.cleaned,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolSelect<OnOff>
        label={s.removeInvisible}
        value={removeInvisible}
        onChange={setRemoveInvisible}
        hint={s.removeInvisibleHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff>
        label={s.normalizeSpaces}
        value={normalizeSpaces}
        onChange={setNormalizeSpaces}
        hint={s.normalizeSpacesHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff>
        label={s.removeSoftHyphen}
        value={removeSoftHyphen}
        onChange={setRemoveSoftHyphen}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.codePointsBefore} value={proNum(result.codePointsBefore, 0)} />
          <ResultRow label={s.codePointsAfter} value={proNum(result.codePointsAfter, 0)} />

          {result.findings.length === 0 ? (
            <p className="tool__note">{s.findingsNone}</p>
          ) : (
            <ToolTable
              head={[s.colKind, s.colName, s.colLine, s.colColumn]}
              rows={result.findings.map((f) => [kindLabel(f.kind), `${f.label} — ${f.name}`, f.line, f.column])}
            />
          )}

          {result.mixedScriptWords.length === 0 ? (
            <p className="tool__note">{s.mixedNone}</p>
          ) : (
            <ToolTable
              head={[s.colWord, s.colScripts, s.colLine, s.colColumn]}
              rows={result.mixedScriptWords.map((w) => [
                w.word,
                w.scripts.map(scriptLabel).join(", "),
                w.line,
                w.column,
              ])}
            />
          )}

          <ToolOutput label={s.cleaned} value={result.cleaned} multiline empty={s.cleanedEmpty} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.removeInvisible, value: removeInvisible === "on" ? s.on : s.off },
              { label: s.normalizeSpaces, value: normalizeSpaces === "on" ? s.on : s.off },
              { label: s.removeSoftHyphen, value: removeSoftHyphen === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// serbian-transliteration — Preslovljavanje
// ---------------------------------------------------------------------------

/** Adds a placeholder so a select whose core field has no default can start unset. */
type DirectionField = "unset" | "cyrillicToLatin" | "latinToCyrillic";

const TRANSLITERATION_REASON_LABEL: Readonly<
  Record<string, (s: typeof strings.pro.tekst["serbian-transliteration"]) => string>
> = {
  digraph: (s) => s.reasonDigraph,
  dj: (s) => s.reasonDj,
};

/**
 * Serbian text from one script to the other. Cyrillic to Latin is a plain
 * substitution and cannot be wrong; Latin to Cyrillic is a guess for „dž",
 * „lj", „nj" and „dj" — every place it guessed is reported rather than hidden.
 */
export function SerbianTransliterationTool() {
  const s = strings.pro.tekst["serbian-transliteration"];
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<DirectionField>("unset");

  const typed = text !== "";
  const ready = direction !== "unset";
  const result = ready ? transliterate({ text, direction }) : undefined;
  const failure = result === undefined || result.ok || !typed ? undefined : s.errorText;

  const reasonLabel = (reason: string): string =>
    (TRANSLITERATION_REASON_LABEL[reason] ?? TRANSLITERATION_REASON_LABEL["dj"])?.(s) ?? "";

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [
          result.text,
          "",
          ...result.ambiguities.map(
            (a) =>
              `${a.sequence} — ${s.colLine} ${a.line}, ${s.colColumn} ${a.column}, „${a.word}“ (${reasonLabel(a.reason)})`,
          ),
        ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolSelect<DirectionField>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "unset", label: s.selectPlaceholder },
          { id: "cyrillicToLatin", label: s.directionCyrillicToLatin },
          { id: "latinToCyrillic", label: s.directionLatinToCyrillic },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} multiline />
          {result.ambiguities.length === 0 ? (
            <p className="tool__note">
              {direction === "cyrillicToLatin" ? s.ambiguitiesNoneDirection : s.ambiguitiesNoneOther}
            </p>
          ) : (
            <ToolTable
              head={[s.colSequence, s.colLine, s.colColumn, s.colWord, s.colReason]}
              rows={result.ambiguities.map((a) => [a.sequence, a.line, a.column, a.word, reasonLabel(a.reason)])}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              {
                label: s.direction,
                value: direction === "cyrillicToLatin" ? s.directionCyrillicToLatin : s.directionLatinToCyrillic,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// translation-volume — Obim prevoda
// ---------------------------------------------------------------------------

/** Adds a placeholder so a select whose core field has no default can start unset. */
type ChargeUnitField = ChargeUnit | "unset";

/**
 * The size of a paste in every unit anybody bills a translation in, and the
 * money at a price the user typed — both amounts computed from the UNROUNDED
 * quantity, because multiplying an already-rounded page count is a different
 * number of money than the exact one.
 */
export function TranslationVolumeTool() {
  const s = strings.pro.tekst["translation-volume"];
  const [text, setText] = useState("");
  const [charsPerPageText, setCharsPerPageText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [unit, setUnit] = useState<ChargeUnitField>("unset");

  const typed = text !== "" || proParse(charsPerPageText) !== undefined;
  const ready = unit !== "unset";
  const result = ready
    ? translationVolume({
        text,
        charsPerPage: proParse(charsPerPageText) ?? Number.NaN,
        price: proParse(priceText),
        unit,
      })
    : undefined;
  const failure =
    result === undefined || result.ok || !typed
      ? undefined
      : result.reason === "text"
        ? s.errorText
        : result.reason === "charsPerPage"
          ? s.errorCharsPerPage
          : s.errorPrice;

  const unitLabel = (u: ChargeUnitField): string =>
    u === "page" ? s.unitPage : u === "word" ? s.unitWord : u === "character" ? s.unitCharacter : s.selectPlaceholder;

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [
          `${s.charactersWithSpaces}: ${result.charactersWithSpaces}`,
          `${s.charactersWithLineBreaks}: ${result.charactersWithLineBreaks}`,
          `${s.charactersWithoutSpaces}: ${result.charactersWithoutSpaces}`,
          `${s.wordsBySpaces}: ${result.wordsBySpaces}`,
          `${s.wordsByLetters}: ${result.wordsByLetters}`,
          `${s.pagesExact}: ${proNum(result.pagesExact, 4)}`,
          `${s.pagesRoundedUp}: ${result.pagesRoundedUp}`,
          result.amountExact === undefined ? undefined : `${s.amountExact}: ${proNum(result.amountExact, 2)}`,
          result.amountRoundedUp === undefined
            ? undefined
            : `${s.amountRoundedUp}: ${proNum(result.amountRoundedUp, 2)}`,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolInput
        label={s.charsPerPage}
        hint={s.charsPerPageHint}
        value={charsPerPageText}
        onChange={setCharsPerPageText}
      />
      <ToolInput label={s.price} hint={s.priceHint} value={priceText} onChange={setPriceText} />
      <ToolSelect<ChargeUnitField>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={[
          { id: "unset", label: s.selectPlaceholder },
          { id: "page", label: s.unitPage },
          { id: "word", label: s.unitWord },
          { id: "character", label: s.unitCharacter },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.charactersWithSpaces} value={result.charactersWithSpaces} />
          <ResultRow label={s.charactersWithLineBreaks} value={result.charactersWithLineBreaks} />
          <p className="tool__note">{s.lineBreakNote}</p>
          <ResultRow label={s.charactersWithoutSpaces} value={result.charactersWithoutSpaces} />
          <ResultRow label={s.wordsBySpaces} value={result.wordsBySpaces} />
          <ResultRow label={s.wordsByLetters} value={result.wordsByLetters} />
          <ResultRow label={s.pagesExact} value={proNum(result.pagesExact, 4)} />
          <ResultRow label={s.pagesRoundedUp} value={result.pagesRoundedUp} />
          {result.amountExact !== undefined && (
            <ResultRow label={s.amountExact} value={proNum(result.amountExact, 2)} />
          )}
          {result.amountRoundedUp !== undefined && (
            <ResultRow label={s.amountRoundedUp} value={proNum(result.amountRoundedUp, 2)} />
          )}
          {result.amountExact !== undefined && <p className="tool__note">{s.noCurrencyNote}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.charsPerPage, value: charsPerPageText.trim() },
              { label: s.price, value: priceText.trim() === "" ? s.priceEmpty : priceText.trim() },
              { label: s.unit, value: unitLabel(unit) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// subtitle-audit — Provera titlova
// ---------------------------------------------------------------------------

const DASH = "—";

/** `proRatio`, with the drawer's dash for „no limit was typed". */
function proRatioOrDash(value: number | undefined): string {
  return proRatio(value) ?? DASH;
}

/**
 * Every measured value of every cue, beside the limit the user typed and their
 * plain ratio — never a verdict, because 42 characters or 17 characters a
 * second is a broadcaster's house rule this tool holds none of.
 */
export function SubtitleAuditTool() {
  const s = strings.pro.tekst["subtitle-audit"];
  const [subtitleText, setSubtitleText] = useState("");
  const [maxLineCharsText, setMaxLineCharsText] = useState("");
  const [maxLinesText, setMaxLinesText] = useState("");
  const [minDurationText, setMinDurationText] = useState("");
  const [maxDurationText, setMaxDurationText] = useState("");
  const [maxCpsText, setMaxCpsText] = useState("");
  const [minGapText, setMinGapText] = useState("");
  const [countTags, setCountTags] = useState<OnOff>("off");

  const typed = subtitleText !== "";
  const result = subtitleAudit({
    subtitle: subtitleText,
    maxLineChars: proParse(maxLineCharsText),
    maxLines: proParse(maxLinesText),
    minDurationMs: proParse(minDurationText),
    maxDurationMs: proParse(maxDurationText),
    maxCharsPerSecond: proParse(maxCpsText),
    minGapMs: proParse(minGapText),
    countTags: countTags === "on",
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "subtitle"
        ? s.errorSubtitle
        : result.reason === "maxLineChars"
          ? s.errorMaxLineChars
          : result.reason === "maxLines"
            ? s.errorMaxLines
            : result.reason === "minDurationMs"
              ? s.errorMinDuration
              : result.reason === "maxDurationMs"
                ? s.errorMaxDuration
                : result.reason === "maxCharsPerSecond"
                  ? s.errorMaxCps
                  : s.errorMinGap;

  const list = (items: readonly number[]): string => (items.length === 0 ? s.listNone : items.join(", "));

  const copyText = !result.ok
    ? ""
    : [
        ...result.blocks.map(
          (b) =>
            `#${b.index} — ${s.colDuration} ${proNum(b.durationMs, 0)} ms, ${s.colChars} ${b.characters}, ` +
            `${s.colCps} ${b.charactersPerSecond === undefined ? DASH : proNum(b.charactersPerSecond, 2)}, ` +
            `${s.colLongestLine} ${b.longestLine}, ${s.colLines} ${b.lines}, ` +
            `${s.colGap} ${b.gapMs === undefined ? DASH : `${proNum(b.gapMs, 0)} ms`}`,
        ),
        "",
        `${s.nonPositiveDuration}: ${list(result.nonPositiveDuration)}`,
        `${s.outOfOrder}: ${list(result.outOfOrder)}`,
        `${s.overlapping}: ${list(result.overlapping)}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.subtitle}
        hint={s.subtitleHint}
        value={subtitleText}
        onChange={setSubtitleText}
        rows={12}
      />
      <ToolInput label={s.maxLineChars} hint={s.limitHint} value={maxLineCharsText} onChange={setMaxLineCharsText} />
      <ToolInput label={s.maxLines} hint={s.limitHint} value={maxLinesText} onChange={setMaxLinesText} />
      <ToolInput label={s.minDuration} hint={s.limitHint} value={minDurationText} onChange={setMinDurationText} />
      <ToolInput label={s.maxDuration} hint={s.limitHint} value={maxDurationText} onChange={setMaxDurationText} />
      <ToolInput label={s.maxCps} hint={s.limitHint} value={maxCpsText} onChange={setMaxCpsText} />
      <ToolInput label={s.minGap} hint={s.limitHint} value={minGapText} onChange={setMinGapText} />
      <ToolSelect<OnOff>
        label={s.countTags}
        value={countTags}
        onChange={setCountTags}
        hint={s.countTagsHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[
              "#",
              s.colDuration,
              s.colMaxDurationRatio,
              s.colMinDurationRatio,
              s.colChars,
              s.colCps,
              s.colCpsRatio,
              s.colLongestLine,
              s.colLongestLineRatio,
              s.colLines,
              s.colLinesRatio,
              s.colGap,
              s.colGapRatio,
            ]}
            rows={result.blocks.map((b) => [
              b.index,
              proNum(b.durationMs, 0),
              proRatioOrDash(b.maxDurationRatio),
              proRatioOrDash(b.minDurationRatio),
              b.characters,
              b.charactersPerSecond === undefined ? DASH : proNum(b.charactersPerSecond, 2),
              proRatioOrDash(b.charactersPerSecondRatio),
              b.longestLine,
              proRatioOrDash(b.longestLineRatio),
              b.lines,
              proRatioOrDash(b.linesRatio),
              b.gapMs === undefined ? DASH : proNum(b.gapMs, 0),
              proRatioOrDash(b.gapRatio),
            ])}
          />
          <p className="tool__note">{s.ratioNote}</p>

          <ResultRow label={s.nonPositiveDuration} value={list(result.nonPositiveDuration)} />
          <ResultRow label={s.outOfOrder} value={list(result.outOfOrder)} />
          <ResultRow label={s.overlapping} value={list(result.overlapping)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.subtitle, value: preview(subtitleText) },
              { label: s.maxLineChars, value: maxLineCharsText.trim() },
              { label: s.maxLines, value: maxLinesText.trim() },
              { label: s.minDuration, value: minDurationText.trim() },
              { label: s.maxDuration, value: maxDurationText.trim() },
              { label: s.maxCps, value: maxCpsText.trim() },
              { label: s.minGap, value: minGapText.trim() },
              { label: s.countTags, value: countTags === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// subtitle-retime — Pomeranje titlova
// ---------------------------------------------------------------------------

/** The eight offered rates plus „none" — a frame-rate field with no default. */
type FpsChoice = "none" | "24" | "25" | "30" | "50" | "60" | "24000/1001" | "30000/1001" | "60000/1001";

/**
 * Shifts every cue by a fixed delay and, where both a source and a target rate
 * are given, converts first — the rate scales starts and gaps, the offset is a
 * flat delay applied after. Everything that is not a timing line is copied
 * through untouched.
 */
export function SubtitleRetimeTool() {
  const s = strings.pro.tekst["subtitle-retime"];
  const [subtitleText, setSubtitleText] = useState("");
  const [offsetText, setOffsetText] = useState("");
  const [fromChoice, setFromChoice] = useState<FpsChoice>("none");
  const [toChoice, setToChoice] = useState<FpsChoice>("none");
  const [renumber, setRenumber] = useState<OnOff>("off");

  const offsetTrimmed = offsetText.trim();
  const offsetParsed = offsetTrimmed === "" ? { ok: true as const, ms: 0 } : parseTimecode({ text: offsetText });
  const typed = subtitleText !== "" || offsetTrimmed !== "";

  const result = offsetParsed.ok
    ? subtitleRetime({
        subtitle: subtitleText,
        offsetMs: offsetParsed.ms,
        fromFps: fromChoice === "none" ? undefined : FRAME_RATES[fromChoice],
        toFps: toChoice === "none" ? undefined : FRAME_RATES[toChoice],
        renumber: renumber === "on",
      })
    : undefined;

  const failure = !offsetParsed.ok
    ? typed
      ? s.errorOffset
      : undefined
    : result === undefined || result.ok || !typed
      ? undefined
      : result.reason === "subtitle"
        ? s.errorSubtitle
        : result.reason === "offsetMs"
          ? s.errorOffset
          : result.reason === "fromFps"
            ? s.errorFromFps
            : s.errorToFps;

  const fpsLabel = (choice: FpsChoice): string => (choice === "none" ? s.fpsNone : choice);

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [
          result.text,
          "",
          `${s.blocks}: ${result.blocks}`,
          `${s.clamped}: ${result.clamped}`,
          `${s.endBeforeStart}: ${
            result.endBeforeStart.length === 0 ? s.endBeforeStartNone : result.endBeforeStart.join(", ")
          }`,
        ].join("\n");

  const fpsOptions: readonly { readonly id: FpsChoice; readonly label: string }[] = [
    { id: "none", label: s.fpsNone },
    { id: "24", label: "24" },
    { id: "25", label: "25" },
    { id: "30", label: "30" },
    { id: "50", label: "50" },
    { id: "60", label: "60" },
    { id: "24000/1001", label: "24000/1001" },
    { id: "30000/1001", label: "30000/1001" },
    { id: "60000/1001", label: "60000/1001" },
  ];

  return (
    <>
      <ToolTextArea
        label={s.subtitle}
        hint={s.subtitleHint}
        value={subtitleText}
        onChange={setSubtitleText}
        rows={12}
      />
      <ToolInput label={s.offset} hint={s.offsetHint} value={offsetText} onChange={setOffsetText} mono />
      <ToolSelect<FpsChoice>
        label={s.fromFps}
        value={fromChoice}
        onChange={setFromChoice}
        hint={s.fpsHint}
        options={fpsOptions}
      />
      <ToolSelect<FpsChoice> label={s.toFps} value={toChoice} onChange={setToChoice} options={fpsOptions} />
      <ToolSelect<OnOff>
        label={s.renumber}
        value={renumber}
        onChange={setRenumber}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} multiline />
          <ResultRow label={s.blocks} value={result.blocks} />
          <ResultRow label={s.clamped} value={result.clamped} />
          <ResultRow
            label={s.endBeforeStart}
            value={result.endBeforeStart.length === 0 ? s.endBeforeStartNone : result.endBeforeStart.join(", ")}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.subtitle, value: preview(subtitleText) },
              { label: s.offset, value: offsetTrimmed === "" ? s.offsetZero : offsetTrimmed },
              { label: s.fromFps, value: fpsLabel(fromChoice) },
              { label: s.toFps, value: fpsLabel(toChoice) },
              { label: s.renumber, value: renumber === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// typography-cleanup — Tipografsko čišćenje
// ---------------------------------------------------------------------------

/** Adds a placeholder so a select whose core field has no default can start unset. */
type QuoteStyleField = QuoteStyle | "unset";

/**
 * Straight quotes, triple dots, hyphens and stray spaces, each rule counted
 * separately — five independent switches applied in a fixed order, because
 * later rules read the context earlier ones just changed.
 */
export function TypographyCleanupTool() {
  const s = strings.pro.tekst["typography-cleanup"];
  const [text, setText] = useState("");
  const [style, setStyle] = useState<QuoteStyleField>("unset");
  const [quotes, setQuotes] = useState<OnOff>("off");
  const [ellipses, setEllipses] = useState<OnOff>("off");
  const [dashes, setDashes] = useState<OnOff>("off");
  const [spaces, setSpaces] = useState<OnOff>("off");
  const [nbsp, setNbsp] = useState<OnOff>("off");

  const typed = text !== "";
  const ready = style !== "unset";
  const result = ready
    ? typographyCleanup({
        text,
        style,
        quotes: quotes === "on",
        ellipses: ellipses === "on",
        dashes: dashes === "on",
        spaces: spaces === "on",
        nbsp: nbsp === "on",
      })
    : undefined;
  const failure = result === undefined || result.ok || !typed ? undefined : s.errorText;

  const styleLabel = (v: QuoteStyleField): string =>
    v === "curly" ? s.styleCurly : v === "guillemets" ? s.styleGuillemets : v === "straight" ? s.styleStraight : s.selectPlaceholder;

  const copyText =
    result === undefined || !result.ok
      ? ""
      : [
          result.text,
          "",
          `${s.quotes}: ${result.quotes}`,
          `${s.ellipses}: ${result.ellipses}`,
          `${s.dashes}: ${result.dashes}`,
          `${s.spaces}: ${result.spaces}`,
          `${s.nbsp}: ${result.nbsp}`,
          `${s.total}: ${result.total}`,
        ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolSelect<QuoteStyleField>
        label={s.style}
        value={style}
        onChange={setStyle}
        options={[
          { id: "unset", label: s.selectPlaceholder },
          { id: "curly", label: s.styleCurly },
          { id: "guillemets", label: s.styleGuillemets },
          { id: "straight", label: s.styleStraight },
        ]}
      />
      <ToolSelect<OnOff> label={s.quotes} value={quotes} onChange={setQuotes} options={ON_OFF_OPTIONS(s.on, s.off)} />
      <ToolSelect<OnOff>
        label={s.ellipses}
        value={ellipses}
        onChange={setEllipses}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff> label={s.dashes} value={dashes} onChange={setDashes} options={ON_OFF_OPTIONS(s.on, s.off)} />
      <ToolSelect<OnOff> label={s.spaces} value={spaces} onChange={setSpaces} options={ON_OFF_OPTIONS(s.on, s.off)} />
      <ToolSelect<OnOff>
        label={s.nbsp}
        value={nbsp}
        onChange={setNbsp}
        hint={s.nbspHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} multiline />
          <ResultRow label={s.quotes} value={result.quotes} />
          <ResultRow label={s.ellipses} value={result.ellipses} />
          <ResultRow label={s.dashes} value={result.dashes} />
          <ResultRow label={s.spaces} value={result.spaces} />
          <ResultRow label={s.nbsp} value={result.nbsp} />
          <ResultRow label={s.total} value={result.total} />
          <ResultRow label={s.codePointsBefore} value={proNum(result.codePointsBefore, 0)} />
          <ResultRow label={s.codePointsAfter} value={proNum(result.codePointsAfter, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.style, value: styleLabel(style) },
              { label: s.quotes, value: quotes === "on" ? s.on : s.off },
              { label: s.ellipses, value: ellipses === "on" ? s.on : s.off },
              { label: s.dashes, value: dashes === "on" ? s.on : s.off },
              { label: s.spaces, value: spaces === "on" ? s.on : s.off },
              { label: s.nbsp, value: nbsp === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// unwrap-paragraphs — Spajanje prelomljenih redova
// ---------------------------------------------------------------------------

/**
 * Lines broken by a PDF copy, put back into paragraphs. Three independent
 * rules, tried in a fixed order, and a rejected fourth: „a line shorter than
 * 60% of the longest ends a paragraph" is a guess with an invented threshold
 * this tool refuses to make.
 */
export function UnwrapParagraphsTool() {
  const s = strings.pro.tekst["unwrap-paragraphs"];
  const [text, setText] = useState("");
  const [joinHyphenated, setJoinHyphenated] = useState<OnOff>("off");
  const [respectListItems, setRespectListItems] = useState<OnOff>("off");
  const [splitOnSentenceEnd, setSplitOnSentenceEnd] = useState<OnOff>("off");

  const typed = text !== "";
  const result = unwrapParagraphs({
    text,
    joinHyphenated: joinHyphenated === "on",
    respectListItems: respectListItems === "on",
    splitOnSentenceEnd: splitOnSentenceEnd === "on",
  });
  const failure = result.ok || !typed ? undefined : s.errorText;

  const copyText = !result.ok
    ? ""
    : [
        result.text,
        "",
        `${s.joinedLines}: ${result.joinedLines}`,
        `${s.joinedWords}: ${result.joinedWords}`,
        `${s.paragraphs}: ${result.paragraphs}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolSelect<OnOff>
        label={s.joinHyphenated}
        value={joinHyphenated}
        onChange={setJoinHyphenated}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff>
        label={s.respectListItems}
        value={respectListItems}
        onChange={setRespectListItems}
        hint={s.respectListItemsHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />
      <ToolSelect<OnOff>
        label={s.splitOnSentenceEnd}
        value={splitOnSentenceEnd}
        onChange={setSplitOnSentenceEnd}
        hint={s.splitOnSentenceEndHint}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} multiline />
          <ResultRow label={s.joinedLines} value={result.joinedLines} />
          <ResultRow label={s.joinedWords} value={result.joinedWords} />
          <ResultRow label={s.paragraphs} value={result.paragraphs} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.joinHyphenated, value: joinHyphenated === "on" ? s.on : s.off },
              { label: s.respectListItems, value: respectListItems === "on" ? s.on : s.off },
              { label: s.splitOnSentenceEnd, value: splitOnSentenceEnd === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// word-frequency — Učestalost reči
// ---------------------------------------------------------------------------

/**
 * How often each word, or phrase of n words, occurs and what share of the
 * text it is — both thresholds filter only the TABLE, never the denominator,
 * so a shown share always adds up to the whole text and not to a sample.
 */
export function WordFrequencyTool() {
  const s = strings.pro.tekst["word-frequency"];
  const [text, setText] = useState("");
  const [nText, setNText] = useState("");
  const [minCountText, setMinCountText] = useState("");
  const [minWordLengthText, setMinWordLengthText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState<OnOff>("off");

  const typed = text !== "" || proParse(nText) !== undefined;
  const result = wordFrequency({
    text,
    n: proParse(nText) ?? Number.NaN,
    minCount: proParse(minCountText) ?? Number.NaN,
    minWordLength: proParse(minWordLengthText) ?? Number.NaN,
    caseSensitive: caseSensitive === "on",
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "text"
        ? s.errorText
        : result.reason === "n"
          ? s.errorN
          : result.reason === "minCount"
            ? s.errorMinCount
            : s.errorMinWordLength;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalWords}: ${result.totalWords}`,
        `${s.totalNgrams}: ${result.totalNgrams}`,
        `${s.distinctPhrases}: ${result.distinctPhrases}`,
        "",
        ...result.rows.map((row) => `${row.phrase} — ${row.count} (${proNum(row.share, 2)}%)`),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolInput label={s.n} hint={s.nHint} value={nText} onChange={setNText} />
      <ToolInput label={s.minCount} hint={s.minCountHint} value={minCountText} onChange={setMinCountText} />
      <ToolInput
        label={s.minWordLength}
        hint={s.minWordLengthHint}
        value={minWordLengthText}
        onChange={setMinWordLengthText}
      />
      <ToolSelect<OnOff>
        label={s.caseSensitive}
        value={caseSensitive}
        onChange={setCaseSensitive}
        options={ON_OFF_OPTIONS(s.on, s.off)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalWords} value={result.totalWords} />
          <ResultRow label={s.totalNgrams} value={result.totalNgrams} />
          <ResultRow label={s.distinctPhrases} value={result.distinctPhrases} />
          {result.rows.length === 0 ? (
            <p className="tool__note">{s.rowsNone}</p>
          ) : (
            <ToolTable
              head={[s.colPhrase, s.colCount, s.colShare]}
              rows={result.rows.map((row) => [row.phrase, row.count, `${proNum(row.share, 2)}%`])}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.text, value: preview(text) },
              { label: s.n, value: nText.trim() },
              { label: s.minCount, value: minCountText.trim() },
              { label: s.minWordLength, value: minWordLengthText.trim() },
              { label: s.caseSensitive, value: caseSensitive === "on" ? s.on : s.off },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The map every tool in this pack is reached through.
// ---------------------------------------------------------------------------

export const TEKST_SURFACES: Readonly<Record<string, ComponentType>> = {
  "bracket-balance": BracketBalanceTool,
  "glossary-check": GlossaryCheckTool,
  "hidden-characters": HiddenCharactersTool,
  "isbn-issn-check": IsbnIssnCheckTool,
  "mojibake-repair": MojibakeRepairTool,
  "number-check": NumberCheckTool,
  "number-to-serbian-words": NumberToSerbianWordsTool,
  "reading-time": ReadingTimeTool,
  "sentence-length": SentenceLengthTool,
  "serbian-transliteration": SerbianTransliterationTool,
  "subtitle-audit": SubtitleAuditTool,
  "subtitle-retime": SubtitleRetimeTool,
  "translation-volume": TranslationVolumeTool,
  "typography-cleanup": TypographyCleanupTool,
  "unwrap-paragraphs": UnwrapParagraphsTool,
  "word-frequency": WordFrequencyTool,
};
