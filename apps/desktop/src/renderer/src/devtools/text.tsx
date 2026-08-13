import {
  affixLines,
  cyrillicToLatin,
  codepointLength,
  COLUMN_ALIGNS,
  convertTokens,
  CASE_FORMATS,
  dedupeLines,
  endsWithNewline,
  explainPattern,
  findNestedQuantifier,
  joinLines,
  LINE_SORT_MODES,
  loremParagraphs,
  loremSentences,
  loremWords,
  numberLines,
  parseMarkdownTable,
  formatMarkdownTable,
  removeBlankLines,
  replaceRegex,
  reverseLines,
  runRegex,
  shuffleLines,
  slugify,
  sortLines,
  splitLines,
  tokenizeIdentifier,
  trimLines,
  wrapLines,
  type ColumnAlign,
  type LineSortMode,
  type LoremVocabulary,
  type MarkdownTable,
  type MarkdownTableResult,
  type RegexPart,
  type RegexReplaceResult,
  type RegexRunResult,
  type SlugOptions,
  type TrimSide,
} from "@nexus/core/devtools/text";
import {
  diffLines,
  diffStats,
  diffWords,
  splitWords,
  unifiedDiff,
  type DiffOptions,
  type DiffRun,
} from "@nexus/core/devtools/textDiff";
import { parseToolNumber } from "@nexus/core";
import { Button, Checkbox, Chip, Icon } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "../pro/shared.js";
import { strings } from "../strings.js";

/**
 * „Tekst" — the 7 surfaces of this group of the developer drawer.
 *
 * One file per category rather than one map for all forty-eight, because the
 * map is the seam every surface is added at: a single file would be the one
 * place every future tool has to touch, and the place two people writing two
 * unrelated tools collide. `proToolSurfaces.tsx` composes the nine.
 *
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 *
 * The tools this file owes:
 *   - `diff`
 *   - `markdown-table`
 *   - `lorem`
 *   - `slug`
 *   - `case-convert`
 *   - `line-tools`
 *   - `regex`
 */

/**
 * `{name}` placeholders in a Serbian sentence, filled from `vars`. The one
 * spot this drawer needs sentence-level interpolation rather than a
 * label/value pair (`ResultRow`) — a refusal that names a row and a column,
 * the regex engine's own error text, a quantifier's min and max.
 */
function fmt(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/gu, (match: string, key: string): string => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

type DiffLevel = "lines" | "words";
type DiffView = "sideBySide" | "unified";

/**
 * One side of one `DiffRun`, sliced from that side's OWN token list.
 *
 * Never `run.items` alone: an `equal` run carries side A's text only (see
 * `textDiff.ts`), and under `ignoreCase` or a whitespace option the two sides
 * of an equal run can still differ character for character. Slicing both
 * `aTokens` and `bTokens` independently by `aStart`/`bStart` is the one thing
 * a two-column view has to do that a single list does not.
 */
function runSlice(
  run: DiffRun,
  side: "a" | "b",
  aTokens: readonly string[],
  bTokens: readonly string[],
): readonly string[] {
  const count = side === "a" ? run.aCount : run.bCount;
  if (count === 0) return [];
  const start = side === "a" ? run.aStart : run.bStart;
  const tokens = side === "a" ? aTokens : bTokens;
  return tokens.slice(start, start + count);
}

/** One side of one diff row: a run of words joined inline, or lines stacked. */
function DiffCell({ tokens, level }: { tokens: readonly string[]; level: DiffLevel }) {
  if (tokens.length === 0) return null;
  if (level === "words") return <>{tokens.join("")}</>;
  return (
    <>
      {tokens.map((line, index) => (
        <div key={index}>{line === "" ? " " : line}</div>
      ))}
    </>
  );
}

function DiffTool() {
  const s = strings.devtools.text.diff;
  const common = strings.pro.common;
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [level, setLevel] = useState<DiffLevel>("lines");
  const [view, setView] = useState<DiffView>("unified");
  const [ignoreTrailing, setIgnoreTrailing] = useState(false);
  const [ignoreAll, setIgnoreAll] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [contextText, setContextText] = useState("3");

  // Read by both diff passes below; memoized so its identity only changes
  // when one of the three checkboxes does — a fresh object literal here
  // would defeat the memos that key on it.
  const options: DiffOptions = useMemo(
    () => ({
      ignoreTrailingWhitespace: ignoreTrailing,
      ignoreAllWhitespace: ignoreAll,
      ignoreCase,
    }),
    [ignoreTrailing, ignoreAll, ignoreCase],
  );
  // Only the side-by-side view reads these, but they are cheap next to the diff
  // itself; memoized for the same reason as the diff — nothing here should be
  // rebuilt because somebody ticked „ignoriši velika i mala slova".
  const aTokens = useMemo(
    () => (level === "lines" ? splitLines(leftText) : splitWords(leftText)),
    [leftText, level],
  );
  const bTokens = useMemo(
    () => (level === "lines" ? splitLines(rightText) : splitWords(rightText)),
    [rightText, level],
  );
  // Full Myers diff over both texts, with no size cap; used to re-run on
  // every keystroke in either textarea, so it is memoized to the inputs
  // that can actually change its result.
  const { runs, stats } = useMemo(() => {
    const nextRuns =
      level === "lines"
        ? diffLines(leftText, rightText, options)
        : diffWords(leftText, rightText, options);
    return { runs: nextRuns, stats: diffStats(nextRuns) };
  }, [leftText, rightText, level, options]);

  const contextValue = parseToolNumber(contextText);
  // unifiedDiff walks the same two texts a second, independent time — it
  // shares nothing with `runs` above — so it must not run at all while the
  // side-by-side view is showing, the only other place it would be read.
  const unified = useMemo(() => {
    if (view !== "unified") return null;
    return unifiedDiff(leftText, rightText, {
      ...options,
      ...(contextValue === null ? {} : { context: contextValue }),
    });
  }, [view, leftText, rightText, options, contextValue]);

  const hasInput = leftText !== "" || rightText !== "";
  const identical = hasInput && runs.every((run) => run.kind === "equal");

  return (
    <>
      <ToolTextArea
        label={s.left}
        value={leftText}
        onChange={setLeftText}
        placeholder={s.leftPlaceholder}
      />
      {leftText !== "" && !endsWithNewline(leftText) && (
        <p className="tool__note">{s.noTrailingNewline}</p>
      )}
      <ToolTextArea
        label={s.right}
        value={rightText}
        onChange={setRightText}
        placeholder={s.rightPlaceholder}
      />
      {rightText !== "" && !endsWithNewline(rightText) && (
        <p className="tool__note">{s.noTrailingNewline}</p>
      )}

      <div className="tool__actions" role="group" aria-label={s.level}>
        <Button
          size="sm"
          variant={level === "lines" ? "primary" : "ghost"}
          aria-pressed={level === "lines"}
          onClick={() => setLevel("lines")}
        >
          {s.levelLines}
        </Button>
        <Button
          size="sm"
          variant={level === "words" ? "primary" : "ghost"}
          aria-pressed={level === "words"}
          onClick={() => setLevel("words")}
        >
          {s.levelWords}
        </Button>
      </div>
      <div className="tool__actions">
        <Checkbox
          checked={ignoreTrailing}
          onChange={(event) => setIgnoreTrailing(event.target.checked)}
        >
          {s.ignoreTrailing}
        </Checkbox>
        <Checkbox checked={ignoreAll} onChange={(event) => setIgnoreAll(event.target.checked)}>
          {s.ignoreAll}
        </Checkbox>
        <Checkbox checked={ignoreCase} onChange={(event) => setIgnoreCase(event.target.checked)}>
          {s.ignoreCase}
        </Checkbox>
      </div>

      {!hasInput ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : (
        <>
          <div className="tool__results">
            <ResultRow label={s.added} value={stats.inserted} />
            <ResultRow label={s.removed} value={stats.deleted} />
          </div>
          <div className="tool__actions" role="group" aria-label={s.view}>
            <Button
              size="sm"
              variant={view === "sideBySide" ? "primary" : "ghost"}
              aria-pressed={view === "sideBySide"}
              onClick={() => setView("sideBySide")}
            >
              {s.viewSideBySide}
            </Button>
            <Button
              size="sm"
              variant={view === "unified" ? "primary" : "ghost"}
              aria-pressed={view === "unified"}
              onClick={() => setView("unified")}
            >
              {s.viewUnified}
            </Button>
          </div>

          {identical ? (
            <p className="tool__note">{s.identical}</p>
          ) : view === "unified" ? (
            <>
              <ToolInput label={s.context} value={contextText} onChange={setContextText} mono />
              <ToolOutput label={common.output} value={unified ?? ""} multiline />
            </>
          ) : (
            <ToolTable
              head={[s.left, s.right]}
              rows={runs.map((run) => [
                <DiffCell tokens={runSlice(run, "a", aTokens, bTokens)} level={level} />,
                <DiffCell tokens={runSlice(run, "b", aTokens, bTokens)} level={level} />,
              ])}
            />
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// markdown-table
// ---------------------------------------------------------------------------

const EMPTY_TABLE: MarkdownTable = {
  header: ["", ""],
  rows: [["", ""]],
  align: ["none", "none"],
};

function addColumn(t: MarkdownTable): MarkdownTable {
  return {
    header: [...t.header, ""],
    rows: t.rows.map((row) => [...row, ""]),
    align: [...t.align, "none"],
  };
}
function removeColumn(t: MarkdownTable, index: number): MarkdownTable {
  return {
    header: t.header.filter((_, i) => i !== index),
    rows: t.rows.map((row) => row.filter((_, i) => i !== index)),
    align: t.align.filter((_, i) => i !== index),
  };
}
function addRow(t: MarkdownTable): MarkdownTable {
  return { ...t, rows: [...t.rows, t.header.map(() => "")] };
}
function removeRow(t: MarkdownTable, index: number): MarkdownTable {
  return { ...t, rows: t.rows.filter((_, i) => i !== index) };
}
function setHeaderCell(t: MarkdownTable, index: number, value: string): MarkdownTable {
  return { ...t, header: t.header.map((h, i) => (i === index ? value : h)) };
}
function setBodyCell(t: MarkdownTable, row: number, col: number, value: string): MarkdownTable {
  return {
    ...t,
    rows: t.rows.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? value : c)) : r)),
  };
}
function setAlign(t: MarkdownTable, col: number, align: ColumnAlign): MarkdownTable {
  return { ...t, align: t.align.map((a, i) => (i === col ? align : a)) };
}

function MarkdownTableTool() {
  const s = strings.devtools.text["markdown-table"];
  const [table, setTable] = useState<MarkdownTable>(EMPTY_TABLE);
  const [markdownText, setMarkdownText] = useState<string>(() => {
    const initial = formatMarkdownTable(EMPTY_TABLE);
    return initial.ok ? initial.text : "";
  });
  const [formatError, setFormatError] = useState<
    Extract<MarkdownTableResult, { ok: false }> | null
  >(null);
  const [parseFailed, setParseFailed] = useState(false);

  function applyTable(next: MarkdownTable): void {
    setTable(next);
    const result = formatMarkdownTable(next);
    if (result.ok) {
      setMarkdownText(result.text);
      setFormatError(null);
    } else {
      setFormatError(result);
    }
  }

  function handleMarkdownChange(next: string): void {
    setMarkdownText(next);
    const parsed = parseMarkdownTable(next);
    if (parsed !== null) {
      setTable(parsed);
      setParseFailed(false);
      setFormatError(null);
    } else {
      setParseFailed(next.trim() !== "");
    }
  }

  const alignLabel = (align: ColumnAlign): string =>
    align === "left"
      ? s.alignLeft
      : align === "center"
        ? s.alignCenter
        : align === "right"
          ? s.alignRight
          : s.alignNone;
  const alignOptions = COLUMN_ALIGNS.map((align) => ({ id: align, label: alignLabel(align) }));

  return (
    <>
      {formatError !== null && (
        <ToolFailure>
          {formatError.reason === "line-break-in-cell"
            ? fmt(s.lineBreakInCell, { row: formatError.row, column: formatError.column })
            : fmt(s.extraCells, { row: formatError.row })}
        </ToolFailure>
      )}
      {parseFailed && <ToolFailure>{s.notATable}</ToolFailure>}

      <ToolSection title={s.grid}>
        <div className="tool__table-scroll">
          <table className="tool__table">
            <thead>
              <tr>
                {table.header.map((cell, col) => (
                  <th key={col} scope="col">
                    <input
                      className="nx-textfield__input tool__mono"
                      value={cell}
                      placeholder={s.headerPlaceholder}
                      aria-label={`${s.headerPlaceholder} ${col + 1}`}
                      onChange={(event) =>
                        applyTable(setHeaderCell(table, col, event.target.value))
                      }
                    />
                    <ToolSelect
                      label={`${s.align} ${col + 1}`}
                      value={table.align[col] ?? "none"}
                      options={alignOptions}
                      onChange={(next) => applyTable(setAlign(table, col, next))}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="tool__row-remove"
                      aria-label={s.removeColumn}
                      title={s.removeColumn}
                      disabled={table.header.length <= 1}
                      onClick={() => applyTable(removeColumn(table, col))}
                    >
                      <Icon name="close" />
                    </Button>
                  </th>
                ))}
                <th scope="col">
                  <Button size="sm" onClick={() => applyTable(addColumn(table))}>
                    <Icon name="plus" />
                    {s.addColumn}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <input
                        className="nx-textfield__input tool__mono"
                        value={cell}
                        aria-label={`${s.grid} ${ri + 1}·${ci + 1}`}
                        onChange={(event) =>
                          applyTable(setBodyCell(table, ri, ci, event.target.value))
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="tool__row-remove"
                      aria-label={s.removeRow}
                      title={s.removeRow}
                      onClick={() => applyTable(removeRow(table, ri))}
                    >
                      <Icon name="close" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tool__actions">
          <Button size="sm" onClick={() => applyTable(addRow(table))}>
            <Icon name="plus" />
            {s.addRow}
          </Button>
        </div>
      </ToolSection>

      <ToolSection>
        <ToolTextArea
          label={s.markdown}
          value={markdownText}
          onChange={handleMarkdownChange}
          placeholder={s.markdownPlaceholder}
        />
        <p className="tool__note">{s.edgeSpaceNote}</p>
      </ToolSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// lorem
// ---------------------------------------------------------------------------

type LoremUnit = "words" | "sentences" | "paragraphs";

function LoremTool() {
  const s = strings.devtools.text.lorem;
  const common = strings.pro.common;
  const [unit, setUnit] = useState<LoremUnit>("paragraphs");
  const [countText, setCountText] = useState("3");
  const [vocabulary, setVocabulary] = useState<LoremVocabulary>("latin");
  const [classicOpening, setClassicOpening] = useState(true);
  const [, setSeed] = useState(0);

  const countValue = parseToolNumber(countText);
  const usable = countValue !== null && Number.isInteger(countValue) && countValue >= 1;
  const showInvalid = countText.trim() !== "" && !usable;

  const opts = { vocabulary, classicOpening };
  const result =
    !usable || countValue === null
      ? ""
      : unit === "words"
        ? loremWords(countValue, opts)
        : unit === "sentences"
          ? loremSentences(countValue, opts)
          : loremParagraphs(countValue, opts);

  const unitOptions: readonly { id: LoremUnit; label: string }[] = [
    { id: "words", label: s.unitWords },
    { id: "sentences", label: s.unitSentences },
    { id: "paragraphs", label: s.unitParagraphs },
  ];

  return (
    <>
      <div className="tool__pair">
        <ToolSelect label={s.unit} value={unit} options={unitOptions} onChange={setUnit} />
        <ToolInput
          label={s.count}
          value={countText}
          onChange={setCountText}
          error={showInvalid ? s.invalidCount : undefined}
        />
      </div>
      <div className="tool__actions" role="group" aria-label={s.vocabulary}>
        <Button
          size="sm"
          variant={vocabulary === "latin" ? "primary" : "ghost"}
          aria-pressed={vocabulary === "latin"}
          onClick={() => setVocabulary("latin")}
        >
          {s.vocabularyLatin}
        </Button>
        <Button
          size="sm"
          variant={vocabulary === "serbian" ? "primary" : "ghost"}
          aria-pressed={vocabulary === "serbian"}
          onClick={() => setVocabulary("serbian")}
        >
          {s.vocabularySerbian}
        </Button>
      </div>
      <Checkbox
        checked={classicOpening}
        disabled={vocabulary === "serbian"}
        onChange={(event) => setClassicOpening(event.target.checked)}
      >
        {s.classicOpening}
      </Checkbox>
      <p className="tool__note">{s.classicOpeningNote}</p>

      <div className="tool__actions">
        <Button size="sm" onClick={() => setSeed((n) => n + 1)}>
          <Icon name="repeat" />
          {s.regenerate}
        </Button>
      </div>
      <ToolOutput
        label={common.result}
        value={result}
        multiline
        empty={common.awaitingInput}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// slug
// ---------------------------------------------------------------------------

function SlugTool() {
  const s = strings.devtools.text.slug;
  const [input, setInput] = useState("");
  const [separator, setSeparator] = useState("-");
  const [lowercase, setLowercase] = useState(true);
  const [maxLengthText, setMaxLengthText] = useState("0");
  const [collapse, setCollapse] = useState(true);

  const maxLengthValue = parseToolNumber(maxLengthText);
  const maxLengthValid =
    maxLengthValue !== null && Number.isInteger(maxLengthValue) && maxLengthValue >= 0;
  const showMaxLengthError = maxLengthText.trim() !== "" && !maxLengthValid;
  const effectiveMaxLength = maxLengthValid ? (maxLengthValue ?? 0) : 0;

  const transliterated = cyrillicToLatin(input);
  const showTransliteration = input !== "" && transliterated !== input;

  const options: SlugOptions = { separator, lowercase, maxLength: effectiveMaxLength, collapse };
  const result = input.trim() === "" ? "" : slugify(input, options);
  const overLength = effectiveMaxLength > 0 && codepointLength(result) > effectiveMaxLength;

  return (
    <>
      <ToolInput
        label={s.input}
        value={input}
        onChange={setInput}
        placeholder={s.inputPlaceholder}
      />
      {showTransliteration && <ResultRow label={s.transliterated} value={transliterated} />}
      <ToolOutput label={s.result} value={result} empty={s.empty} />
      {overLength && <p className="tool__note">{s.wordKeptWhole}</p>}

      <div className="tool__pair">
        <ToolInput label={s.separator} value={separator} onChange={setSeparator} mono />
        <ToolInput
          label={s.maxLength}
          value={maxLengthText}
          onChange={setMaxLengthText}
          mono
          hint={s.maxLengthHint}
          error={showMaxLengthError ? s.invalidMaxLength : undefined}
        />
      </div>
      <div className="tool__actions">
        <Checkbox checked={lowercase} onChange={(event) => setLowercase(event.target.checked)}>
          {s.lowercase}
        </Checkbox>
        <Checkbox checked={collapse} onChange={(event) => setCollapse(event.target.checked)}>
          {s.collapse}
        </Checkbox>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// case-convert
// ---------------------------------------------------------------------------

function CaseConvertTool() {
  const s = strings.devtools.text["case-convert"];
  const common = strings.pro.common;
  const [input, setInput] = useState("");
  const tokens = tokenizeIdentifier(input);

  return (
    <>
      <ToolInput
        label={s.input}
        value={input}
        onChange={setInput}
        placeholder={s.inputPlaceholder}
        mono
      />
      {input.trim() === "" ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : (
        <>
          <ToolSection title={s.tokens}>
            <div className="tool__actions">
              {tokens.map((token, index) => (
                <Chip key={index}>{token}</Chip>
              ))}
            </div>
            <p className="tool__note">{s.tokensHint}</p>
          </ToolSection>
          <ToolTable
            head={[s.format, s.value, ""]}
            rows={CASE_FORMATS.map((format) => {
              const value = convertTokens(tokens, format);
              return [
                s.formats[format],
                <span className="tool__mono">{value}</span>,
                <CopyButton value={value} />,
              ];
            })}
          />
          <p className="tool__note">{s.acronymNote}</p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// line-tools
// ---------------------------------------------------------------------------

type OrderMode = "none" | "sort" | "reverse" | "shuffle";
type TrimChoice = "none" | TrimSide;

function LineToolsTool() {
  const s = strings.devtools.text["line-tools"];
  const common = strings.pro.common;
  const [input, setInput] = useState("");
  const [removeBlank, setRemoveBlank] = useState(false);
  const [trim, setTrim] = useState<TrimChoice>("none");
  const [dedupe, setDedupe] = useState(false);
  const [adjacentOnly, setAdjacentOnly] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [order, setOrder] = useState<OrderMode>("none");
  const [sortMode, setSortMode] = useState<LineSortMode>("lexicographic");
  const [descending, setDescending] = useState(false);
  const [numberOn, setNumberOn] = useState(false);
  const [numberStartText, setNumberStartText] = useState("1");
  const [numberSeparator, setNumberSeparator] = useState(". ");
  const [pad, setPad] = useState(true);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [wrapOn, setWrapOn] = useState(false);
  const [wrapWidthText, setWrapWidthText] = useState("80");
  const [, setShuffleSeed] = useState(0);

  const numberStartValue = parseToolNumber(numberStartText);
  const numberStartValid = numberStartValue !== null && Number.isInteger(numberStartValue);
  const showNumberStartError = numberStartText.trim() !== "" && !numberStartValid;

  const wrapWidthValue = parseToolNumber(wrapWidthText);
  const wrapWidthValid =
    wrapWidthValue !== null && Number.isInteger(wrapWidthValue) && wrapWidthValue >= 1;
  const showWrapWidthError = wrapWidthText.trim() !== "" && !wrapWidthValid;

  let lines: readonly string[] = splitLines(input);
  if (removeBlank) lines = removeBlankLines(lines);
  if (trim !== "none") lines = trimLines(lines, trim);
  if (dedupe) lines = dedupeLines(lines, { adjacentOnly, caseSensitive });
  if (order === "sort") lines = sortLines(lines, sortMode, { descending, caseSensitive });
  else if (order === "reverse") lines = reverseLines(lines);
  else if (order === "shuffle") lines = shuffleLines(lines);
  if (numberOn) {
    lines = numberLines(lines, {
      start: numberStartValid ? (numberStartValue ?? 1) : 1,
      separator: numberSeparator,
      pad,
    });
  }
  if (prefix !== "" || suffix !== "") lines = affixLines(lines, { prefix, suffix });
  if (wrapOn && wrapWidthValid) lines = wrapLines(lines, wrapWidthValue ?? 0);
  const output = joinLines(lines);

  const trimOptions: readonly { id: TrimChoice; label: string }[] = [
    { id: "none", label: s.trimNone },
    { id: "both", label: s.trimBoth },
    { id: "start", label: s.trimStart },
    { id: "end", label: s.trimEnd },
  ];
  const orderOptions: readonly { id: OrderMode; label: string }[] = [
    { id: "none", label: s.orderNone },
    { id: "sort", label: s.orderSort },
    { id: "reverse", label: s.orderReverse },
    { id: "shuffle", label: s.orderShuffle },
  ];
  const sortLabel = (mode: LineSortMode): string =>
    mode === "lexicographic"
      ? s.sortLexicographic
      : mode === "natural"
        ? s.sortNatural
        : mode === "length"
          ? s.sortLength
          : s.sortCollated;
  const sortModeOptions = LINE_SORT_MODES.map((mode) => ({ id: mode, label: sortLabel(mode) }));

  return (
    <>
      <ToolTextArea
        label={s.input}
        value={input}
        onChange={setInput}
        placeholder={s.inputPlaceholder}
      />

      <ToolSection title={s.cleanupTitle}>
        <Checkbox checked={removeBlank} onChange={(event) => setRemoveBlank(event.target.checked)}>
          {s.removeBlank}
        </Checkbox>
        <ToolSelect label={s.trim} value={trim} options={trimOptions} onChange={setTrim} />
      </ToolSection>

      <ToolSection title={s.dedupeTitle}>
        <Checkbox checked={dedupe} onChange={(event) => setDedupe(event.target.checked)}>
          {s.dedupe}
        </Checkbox>
        <div className="tool__actions">
          <Checkbox
            checked={adjacentOnly}
            disabled={!dedupe}
            onChange={(event) => setAdjacentOnly(event.target.checked)}
          >
            {s.adjacentOnly}
          </Checkbox>
          <Checkbox
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          >
            {s.caseSensitive}
          </Checkbox>
        </div>
      </ToolSection>

      <ToolSection title={s.orderTitle}>
        <ToolSelect label={s.order} value={order} options={orderOptions} onChange={setOrder} />
        {order === "sort" && (
          <div className="tool__pair">
            <ToolSelect
              label={s.sortMode}
              value={sortMode}
              options={sortModeOptions}
              onChange={setSortMode}
            />
            <Checkbox
              checked={descending}
              onChange={(event) => setDescending(event.target.checked)}
            >
              {s.descending}
            </Checkbox>
          </div>
        )}
        {order === "shuffle" && (
          <div className="tool__actions">
            <Button size="sm" onClick={() => setShuffleSeed((n) => n + 1)}>
              <Icon name="repeat" />
              {s.orderShuffle}
            </Button>
          </div>
        )}
      </ToolSection>

      <ToolSection title={s.numberTitle}>
        <Checkbox checked={numberOn} onChange={(event) => setNumberOn(event.target.checked)}>
          {s.number}
        </Checkbox>
        {numberOn && (
          <>
            <div className="tool__pair">
              <ToolInput
                label={s.numberStart}
                value={numberStartText}
                onChange={setNumberStartText}
                mono
                error={showNumberStartError ? s.invalidStart : undefined}
              />
              <ToolInput
                label={s.numberSeparator}
                value={numberSeparator}
                onChange={setNumberSeparator}
                mono
              />
            </div>
            <Checkbox checked={pad} onChange={(event) => setPad(event.target.checked)}>
              {s.pad}
            </Checkbox>
          </>
        )}
      </ToolSection>

      <ToolSection title={s.affixTitle}>
        <div className="tool__pair">
          <ToolInput label={s.prefix} value={prefix} onChange={setPrefix} mono />
          <ToolInput label={s.suffix} value={suffix} onChange={setSuffix} mono />
        </div>
      </ToolSection>

      <ToolSection title={s.wrapTitle}>
        <Checkbox checked={wrapOn} onChange={(event) => setWrapOn(event.target.checked)}>
          {s.wrap}
        </Checkbox>
        {wrapOn && (
          <>
            <ToolInput
              label={s.wrapWidth}
              value={wrapWidthText}
              onChange={setWrapWidthText}
              mono
              error={showWrapWidthError ? s.invalidWidth : undefined}
            />
            <p className="tool__note">{s.wrapNote}</p>
          </>
        )}
      </ToolSection>

      {input === "" ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : (
        <>
          <ToolOutput label={common.output} value={output} multiline />
          <ResultRow label={common.lines} value={lines.length} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// regex
// ---------------------------------------------------------------------------

function RegexTool() {
  const s = strings.devtools.text.regex;
  const common = strings.pro.common;
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [subject, setSubject] = useState("");
  const [replacement, setReplacement] = useState("");
  const [allowNested, setAllowNested] = useState(false);

  function handlePatternChange(next: string): void {
    setPattern(next);
    setAllowNested(false);
  }

  function partPhrase(part: RegexPart): string {
    if (part.kind === "quantifier") {
      const min = part.min ?? 0;
      const base =
        part.max === undefined
          ? fmt(s.quantifierAtLeast, { min })
          : part.max === min
            ? fmt(s.quantifierExact, { min })
            : fmt(s.quantifierRange, { min, max: part.max });
      return part.lazy === true ? `${base} — ${s.quantifierLazy}` : base;
    }
    const vars: Record<string, string | number> = {};
    if (part.group !== undefined) vars.group = part.group;
    if (part.name !== undefined) vars.name = part.name;
    return fmt(s.parts[part.kind], vars);
  }

  // findNestedQuantifier walks the whole pattern; memoized so retyping the
  // subject or replacement text does not re-walk a pattern that hasn't changed.
  const nestedAt = useMemo(
    () => (pattern === "" ? null : findNestedQuantifier(pattern)),
    [pattern],
  );
  // runRegex compiles the pattern and sweeps the subject (capped at 1000
  // matches / 250ms); memoized, and deliberately independent of
  // `replacement` — editing the replacement field cannot change which
  // matches exist, so it must not retrigger this sweep.
  const runResult: RegexRunResult = useMemo(
    () =>
      runRegex(pattern, flags, subject, {
        allowNestedQuantifier: allowNested,
      }),
    [pattern, flags, subject, allowNested],
  );
  // replaceRegex compiles the same pattern again and sweeps independently
  // of runRegex above; memoized so the pair no longer doubles the ~250ms
  // sweep cost on every keystroke in either field.
  const replaceResult: RegexReplaceResult = useMemo(
    () =>
      replaceRegex(pattern, flags, subject, replacement, {
        allowNestedQuantifier: allowNested,
      }),
    [pattern, flags, subject, replacement, allowNested],
  );
  const showExplain = pattern !== "" && (runResult.ok || runResult.reason === "nested-quantifier");

  return (
    <>
      <ToolInput
        label={s.pattern}
        value={pattern}
        onChange={handlePatternChange}
        placeholder={s.patternPlaceholder}
        mono
      />
      <ToolInput label={s.flags} value={flags} onChange={setFlags} mono />
      {nestedAt !== null && (
        <p className="tool__note">{fmt(s.nestedQuantifierNote, { at: nestedAt })}</p>
      )}
      <ToolTextArea
        label={s.text}
        value={subject}
        onChange={setSubject}
        placeholder={s.textPlaceholder}
      />

      {pattern === "" ? (
        <p className="tool__note">{common.awaitingInput}</p>
      ) : !runResult.ok ? (
        <ToolFailure>
          {runResult.reason === "invalid" ? (
            fmt(s.invalid, { message: runResult.message })
          ) : (
            <>
              {fmt(s.nestedQuantifier, { at: runResult.at })}{" "}
              <Button size="sm" variant="ghost" onClick={() => setAllowNested(true)}>
                {s.allowAnyway}
              </Button>
            </>
          )}
        </ToolFailure>
      ) : (
        <>
          <ToolSection title={s.matches}>
            {runResult.matches.length === 0 ? (
              <p className="tool__note">{s.noMatches}</p>
            ) : (
              <>
                <ResultRow label={s.matches} value={runResult.matches.length} />
                <ToolTable
                  head={[s.index, s.length, s.match, s.groups, s.namedGroups]}
                  rows={runResult.matches.map((match) => [
                    match.index,
                    match.length,
                    <span className="tool__mono">{match.match}</span>,
                    match.groups.length === 0
                      ? "—"
                      : match.groups
                          .map((g, i) => `${i + 1}: ${g === undefined ? s.unmatchedGroup : g}`)
                          .join(", "),
                    Object.keys(match.named).length === 0
                      ? "—"
                      : Object.entries(match.named)
                          .map(([k, v]) => `${k}: ${v === undefined ? s.unmatchedGroup : v}`)
                          .join(", "),
                  ])}
                />
              </>
            )}
            {runResult.stop === "match-cap" && (
              <p className="tool__note">
                {fmt(s.matchCap, { count: runResult.matches.length })}
              </p>
            )}
            {runResult.stop === "time-budget" && (
              <p className="tool__note">{s.timeBudget}</p>
            )}
          </ToolSection>

          <ToolSection title={s.replacement}>
            <ToolInput
              label={s.replacement}
              value={replacement}
              onChange={setReplacement}
              placeholder={s.replacementPlaceholder}
              mono
            />
            {!flags.includes("g") && <p className="tool__note">{s.globalNote}</p>}
            {replaceResult.ok && (
              <>
                <ToolOutput label={s.preview} value={replaceResult.text} multiline />
                <ResultRow label={s.replacedCount} value={replaceResult.count} />
                {replaceResult.stop === "match-cap" && (
                  <p className="tool__note">
                    {fmt(s.matchCap, { count: replaceResult.count })}
                  </p>
                )}
                {replaceResult.stop === "time-budget" && (
                  <p className="tool__note">{s.timeBudget}</p>
                )}
              </>
            )}
          </ToolSection>
        </>
      )}

      {showExplain && (
        <ToolSection title={s.explain}>
          <ToolTable
            head={[s.explainPart, s.explainMeaning]}
            prose={[1]}
            rows={explainPattern(pattern).map((part) => [
              <span className="tool__mono">{part.text}</span>,
              partPhrase(part),
            ])}
          />
        </ToolSection>
      )}
    </>
  );
}

export const TEXT_SURFACES: Readonly<Record<string, ComponentType>> = {
  diff: DiffTool,
  "markdown-table": MarkdownTableTool,
  lorem: LoremTool,
  slug: SlugTool,
  "case-convert": CaseConvertTool,
  "line-tools": LineToolsTool,
  regex: RegexTool,
};
