import {
  BASE64_ALPHABETS,
  HTML_ENTITY_REFERENCE,
  HTML_ESCAPE_MODES,
  HEXDUMP_DEFAULT_BYTES_PER_GROUP,
  HEXDUMP_DEFAULT_BYTES_PER_LINE,
  URL_ESCAPINGS,
  base64ToText,
  binaryBytesToText,
  codePointLabel,
  decimalCodePointsToText,
  hexBytesToText,
  hexdump,
  htmlEscape,
  htmlUnescape,
  inspectText,
  parseHexdump,
  parseUrl,
  textToBase64,
  textToUtf8,
  textViews,
  urlDecode,
  urlEncode,
} from "@nexus/core/devtools/encoding";
import type {
  Base64Alphabet,
  EncodingErrorCode,
  EncodingResult,
  HtmlEscapeMode,
  UrlEscaping,
} from "@nexus/core/devtools/encoding";
import { Button, Checkbox, Chip, Icon } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import { fill, strings } from "../strings.js";
import {
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * The encode/decode drawer: base64, percent-escaping, URL structure, the four
 * views of a byte run, Unicode inspection, HTML entities and hexdumps.
 *
 * **One file per category rather than one map for all forty-eight** — see
 * `proToolSurfaces.tsx`. The tools this file owes:
 *   - `base64`
 *   - `url-encode`
 *   - `url-parse`
 *   - `ascii-binary-hex`
 *   - `unicode-inspector`
 *   - `html-entities`
 *   - `hexdump`
 *
 * All seven refuse rather than repair — that is `@nexus/core/devtools/encoding`'s
 * own discipline — so every surface here does the same two things with a
 * failure: names the reason in Serbian, and shows the position the refusal
 * happened at when the module gives one (`EncodingFailure.at`). `withPosition`
 * and `describeError` below are the one spelling of that, shared by every tool
 * instead of seven near-identical `switch` statements.
 */

/**
 * The longest input „Unicode inspektor" examines.
 *
 * `ToolTable` already caps how many rows any table DRAWS, and for the
 * per-character table above that is the whole cost. Not here: this tool's entire
 * output is per-code-point work — every code point classified against thirty
 * anchored patterns, plus four whole-string normalisations — so the cost is in
 * the computation and a cap on the DOM would not touch it. Same shape and same
 * reason as `BASE_INPUT_MAX_LENGTH` in `@nexus/core/devtools/numbers`.
 */
const INSPECT_MAX_LENGTH = 4096;

/**
 * The widest hexdump layout the two number fields accept.
 *
 * `hexdump` pads every group to its full width, so a line's length follows
 * `bytesPerLine` and not the input: one byte at a million bytes per line is a
 * single ~3 MB line, built and laid out on a keystroke. Sixteen and thirty-two
 * are what anyone dumps; 256 is already far past useful and still cheap.
 */
const HEXDUMP_MAX_LAYOUT = 256;

/** Appends „na poziciji N" when the module gave a position, and nothing when it did not. */
function withPosition(message: string, at: number | undefined, positionLabel: string): string {
  return at === undefined ? message : `${message} (${positionLabel} ${at})`;
}

/** Looks a refusal code up in a tool's own (partial) Serbian table, with a shared fallback. */
function describeError(
  code: EncodingErrorCode,
  map: Partial<Record<EncodingErrorCode, string>>,
  fallback: string,
): string {
  return map[code] ?? fallback;
}

/**
 * The segmented encode/decode recipe (see `shared.tsx`'s house style note),
 * generalised over whatever two-or-three-way choice a tool needs: direction,
 * escaping, dump vs. parse. One spelling instead of seven copies of the same
 * `role="group"` of `Button`s.
 */
function ModeSwitch<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { readonly id: T; readonly label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="tool__actions" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={option.id === value ? "primary" : "ghost"}
          aria-pressed={option.id === value}
          onClick={() => {
            onChange(option.id);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

// --- 1. base64 ---------------------------------------------------------------

function Base64Tool() {
  const s = strings.devtools.encoding.base64;
  const c = strings.pro.common;
  const enc = strings.devtools.encoding.common;

  const [direction, setDirection] = useState<"encode" | "decode">("encode");
  const [alphabet, setAlphabet] = useState<Base64Alphabet>("standard");
  const [decodeAlphabet, setDecodeAlphabet] = useState<Base64Alphabet | "any">("any");
  const [padded, setPadded] = useState(true);
  const [allowWhitespace, setAllowWhitespace] = useState(false);
  const [text, setText] = useState("");

  const alphabetLabel: Record<Base64Alphabet, string> = {
    standard: s.alphabetStandard,
    url: s.alphabetUrl,
  };
  const encodeAlphabetOptions: readonly { readonly id: Base64Alphabet; readonly label: string }[] =
    BASE64_ALPHABETS.map((id) => ({ id, label: alphabetLabel[id] }));
  const decodeAlphabetOptions: readonly {
    readonly id: Base64Alphabet | "any";
    readonly label: string;
  }[] = [
    { id: "any", label: s.alphabetAny },
    ...BASE64_ALPHABETS.map((id) => ({ id, label: alphabetLabel[id] })),
  ];

  const encoded = useMemo(() => textToBase64(text, { alphabet, padded }), [text, alphabet, padded]);
  const decoded = useMemo(
    () =>
      base64ToText(text, {
        ...(decodeAlphabet === "any" ? {} : { alphabet: decodeAlphabet }),
        allowWhitespace,
      }),
    [text, decodeAlphabet, allowWhitespace],
  );

  return (
    <>
      <ModeSwitch
        value={direction}
        onChange={setDirection}
        ariaLabel={enc.direction}
        options={[
          { id: "encode", label: s.encode },
          { id: "decode", label: s.decode },
        ]}
      />
      <div className="tool__pair">
        {direction === "encode" ? (
          <ToolSelect
            label={s.alphabet}
            value={alphabet}
            onChange={setAlphabet}
            options={encodeAlphabetOptions}
          />
        ) : (
          <ToolSelect
            label={s.alphabet}
            value={decodeAlphabet}
            onChange={setDecodeAlphabet}
            options={decodeAlphabetOptions}
          />
        )}
        {direction === "encode" ? (
          <Checkbox checked={padded} onChange={(event) => setPadded(event.target.checked)}>
            {s.padded}
          </Checkbox>
        ) : (
          <Checkbox
            checked={allowWhitespace}
            onChange={(event) => setAllowWhitespace(event.target.checked)}
          >
            {s.allowWhitespace}
          </Checkbox>
        )}
      </div>
      <ToolTextArea
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
      />
      {direction === "encode" ? (
        <ToolOutput label={s.output} value={encoded} multiline empty={c.awaitingInput} />
      ) : decoded.ok ? (
        <ToolOutput label={s.output} value={decoded.value} multiline empty={c.awaitingInput} />
      ) : (
        <ToolFailure>
          {withPosition(
            describeError(
              decoded.code,
              {
                "not-base64": s.errNotBase64,
                "base64-padding": s.errPadding,
                "base64-non-canonical": s.errNonCanonical,
                "base64-mixed-alphabet": s.errMixedAlphabet,
                "not-utf8": s.errNotUtf8,
              },
              c.invalid,
            ),
            decoded.at,
            enc.position,
          )}
        </ToolFailure>
      )}
    </>
  );
}

// --- 2. url-encode -------------------------------------------------------------

function UrlEncodeTool() {
  const s = strings.devtools.encoding["url-encode"];
  const c = strings.pro.common;
  const enc = strings.devtools.encoding.common;

  const [direction, setDirection] = useState<"encode" | "decode">("encode");
  const [escaping, setEscaping] = useState<UrlEscaping>("component");
  const [text, setText] = useState("");

  const escapingLabel: Record<UrlEscaping, string> = {
    component: s.escapingComponent,
    uri: s.escapingUri,
    form: s.escapingForm,
  };
  const escapingHint: Record<UrlEscaping, string> = {
    component: s.hintComponent,
    uri: s.hintUri,
    form: s.hintForm,
  };
  const escapingOptions = URL_ESCAPINGS.map((id) => ({ id, label: escapingLabel[id] }));

  const result = useMemo(
    () => (direction === "encode" ? urlEncode(text, escaping) : urlDecode(text, escaping)),
    [direction, text, escaping],
  );

  return (
    <>
      <ModeSwitch
        value={escaping}
        onChange={setEscaping}
        ariaLabel={s.escaping}
        options={escapingOptions}
      />
      <p className="tool__note">{escapingHint[escaping]}</p>
      <ModeSwitch
        value={direction}
        onChange={setDirection}
        ariaLabel={enc.direction}
        options={[
          { id: "encode", label: s.encode },
          { id: "decode", label: s.decode },
        ]}
      />
      <ToolTextArea
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
      />
      {result.ok ? (
        <ToolOutput label={s.output} value={result.value} multiline empty={c.awaitingInput} />
      ) : (
        <ToolFailure>
          {withPosition(
            describeError(
              result.code,
              {
                "percent-escape": s.errPercentEscape,
                "not-utf8": s.errNotUtf8,
                "lone-surrogate": s.errLoneSurrogate,
              },
              c.invalid,
            ),
            result.at,
            enc.position,
          )}
        </ToolFailure>
      )}
    </>
  );
}

// --- 3. url-parse --------------------------------------------------------------

function UrlParseTool() {
  const s = strings.devtools.encoding["url-parse"];
  const c = strings.pro.common;

  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() === "" ? null : parseUrl(text)), [text]);

  return (
    <>
      <ToolInput
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
        mono
      />
      {text.trim() === "" ? (
        <p className="tool__note">{c.awaitingInput}</p>
      ) : parsed === null ? (
        <ToolFailure>{s.errNotAUrl}</ToolFailure>
      ) : (
        <>
          <div className="tool__results">
            <ResultRow label={s.href} value={parsed.href} />
            <ResultRow label={s.scheme} value={parsed.scheme} />
            <ResultRow label={s.username} value={parsed.username || s.empty} />
            <ResultRow label={s.password} value={parsed.password || s.empty} />
            <ResultRow
              label={s.host}
              value={
                parsed.isIdn ? (
                  <>
                    {parsed.host} <Chip variant="accent">{s.isIdn}</Chip>
                  </>
                ) : (
                  parsed.host
                )
              }
            />
            {parsed.isIdn && <ResultRow label={s.hostUnicode} value={parsed.hostUnicode} />}
            <ResultRow label={s.port} value={parsed.port || s.defaultPort} />
            <ResultRow label={s.path} value={parsed.path || s.empty} />
            <ResultRow label={s.fragment} value={parsed.fragment || s.empty} />
          </div>
          <ToolSection title={s.query}>
            {parsed.query.length === 0 ? (
              <p className="tool__note">{s.noQuery}</p>
            ) : (
              <ToolTable
                head={[s.queryKey, s.queryValue]}
                rows={parsed.query.map((param) => [param.key, param.value])}
              />
            )}
          </ToolSection>
        </>
      )}
    </>
  );
}

// --- 4. ascii-binary-hex ---------------------------------------------------------

/**
 * One reverse-conversion row: an editable draft plus a button that, once the
 * draft reads as a valid list, sets the tool's own `text` from it. A live
 * two-way binding between this field and `text` is not possible without an
 * effect (`text` would fight the user's keystrokes here), so the field owns
 * its own state and the button is the one explicit action that hands it over.
 */
function ReverseField({
  label,
  value,
  onChange,
  placeholder,
  result,
  errorMap,
  fallback,
  buttonLabel,
  onApply,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  result: EncodingResult<string>;
  errorMap: Partial<Record<EncodingErrorCode, string>>;
  fallback: string;
  buttonLabel: string;
  onApply: (text: string) => void;
}) {
  const showError = value !== "" && !result.ok;
  return (
    <>
      <ToolInput
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        mono
        {...(showError && !result.ok
          ? { error: describeError(result.code, errorMap, fallback) }
          : {})}
      />
      <div className="tool__actions">
        <Button
          size="sm"
          variant="quiet"
          disabled={value === "" || !result.ok}
          onClick={() => {
            if (result.ok) onApply(result.value);
          }}
        >
          {buttonLabel}
        </Button>
      </div>
    </>
  );
}

function AsciiBinaryHexTool() {
  const s = strings.devtools.encoding["ascii-binary-hex"];
  const c = strings.pro.common;

  const [text, setText] = useState("");
  const [hexDraft, setHexDraft] = useState("");
  const [binaryDraft, setBinaryDraft] = useState("");
  const [decimalDraft, setDecimalDraft] = useState("");

  const views = useMemo(() => textViews(text), [text]);
  const hexResult = useMemo(() => hexBytesToText(hexDraft), [hexDraft]);
  const binaryResult = useMemo(() => binaryBytesToText(binaryDraft), [binaryDraft]);
  const decimalResult = useMemo(() => decimalCodePointsToText(decimalDraft), [decimalDraft]);

  return (
    <>
      <ToolTextArea
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
      />
      <ToolOutput label={s.decimal} value={views.decimal} empty={c.awaitingInput} />
      <ToolOutput label={s.hex} value={views.hex} empty={c.awaitingInput} />
      <ToolOutput label={s.binary} value={views.binary} empty={c.awaitingInput} />
      <ToolOutput label={s.characters} value={views.characters} empty={c.awaitingInput} />
      <p className="tool__note">{s.hintUtf8}</p>

      {text !== "" && (
        <ToolSection title={s.perCharacter}>
          <ToolTable
            head={[s.columnCharacter, s.columnCodePoint, s.columnHex, s.columnBinary]}
            rows={views.perCharacter.map((entry) => [
              entry.character,
              entry.codePoint,
              entry.hex === "" ? s.noBytes : entry.hex,
              entry.binary === "" ? s.noBytes : entry.binary,
            ])}
          />
        </ToolSection>
      )}

      <ToolSection title={s.reverseTitle}>
        <ReverseField
          label={s.fromHex}
          value={hexDraft}
          onChange={setHexDraft}
          placeholder={s.hex}
          result={hexResult}
          errorMap={{ "not-a-hex-byte-list": s.errHex, "not-utf8": s.errNotUtf8 }}
          fallback={c.invalid}
          buttonLabel={s.fromHex}
          onApply={setText}
        />
        <ReverseField
          label={s.fromBinary}
          value={binaryDraft}
          onChange={setBinaryDraft}
          placeholder={s.binary}
          result={binaryResult}
          errorMap={{ "not-a-binary-byte-list": s.errBinary, "not-utf8": s.errNotUtf8 }}
          fallback={c.invalid}
          buttonLabel={s.fromBinary}
          onApply={setText}
        />
        <ReverseField
          label={s.fromDecimal}
          value={decimalDraft}
          onChange={setDecimalDraft}
          placeholder={s.decimal}
          result={decimalResult}
          errorMap={{
            "not-a-code-point-list": s.errCodePoints,
            "code-point-out-of-range": s.errOutOfRange,
          }}
          fallback={c.invalid}
          buttonLabel={s.fromDecimal}
          onApply={setText}
        />
      </ToolSection>
    </>
  );
}

// --- 5. unicode-inspector --------------------------------------------------------

/**
 * UTF-16 code units as uppercase 4-digit hex, matching `codePointLabel`'s own
 * convention. `CodePointInfo.utf16` carries only the raw numbers — unlike the
 * UTF-8 column, which reuses `textViews`' own `CharacterBytes.hex` so the two
 * tools spell a byte identically — because no formatter for this view exists
 * anywhere in `@nexus/core/devtools/encoding`. See the report for the gap.
 */
function formatUtf16Unit(unit: number): string {
  return unit.toString(16).toUpperCase().padStart(4, "0");
}

function UnicodeInspectorTool() {
  const s = strings.devtools.encoding["unicode-inspector"];
  const c = strings.pro.common;

  const [text, setText] = useState("");
  // Nothing is examined past the cap — not even to be thrown away. `subject`
  // rather than a guard at each call site, so a later addition cannot forget.
  const tooLong = text.length > INSPECT_MAX_LENGTH;
  const subject = tooLong ? "" : text;
  const report = useMemo(() => inspectText(subject), [subject]);
  const views = useMemo(() => textViews(subject), [subject]);

  return (
    <>
      <ToolTextArea
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
      />
      {tooLong ? (
        <ToolFailure>{fill(s.tooLong, { limit: INSPECT_MAX_LENGTH })}</ToolFailure>
      ) : text === "" ? (
        <p className="tool__note">{c.awaitingInput}</p>
      ) : (
        <>
          <div className="tool__results">
            <ResultRow label={s.graphemeCount} value={report.graphemeCount} />
            <ResultRow label={s.codePointCount} value={report.codePointCount} />
            <ResultRow label={s.utf16Length} value={report.utf16Length} />
            <ResultRow label={s.utf8ByteCount} value={report.utf8ByteCount} />
          </div>
          <p className="tool__note">{s.hintLength}</p>
          <ToolTable
            head={[s.codePoint, s.character, s.utf8, s.utf16, s.surrogatePair, s.category]}
            prose={[5]}
            rows={report.codePoints.map((info, index) => {
              const perChar = views.perCharacter[index];
              const utf8Hex = perChar === undefined || perChar.hex === "" ? s.noUtf8 : perChar.hex;
              return [
                info.label,
                info.character,
                utf8Hex,
                info.utf16.map(formatUtf16Unit).join(" "),
                info.isSurrogatePair ? s.yes : s.no,
                info.category,
              ];
            })}
          />
          <ToolSection title={s.normalisation}>
            {report.normalisations.map((normalised) => (
              <ToolOutput
                key={normalised.form}
                label={`${normalised.form} — ${normalised.changed ? s.changed : s.unchanged}`}
                value={normalised.value}
                multiline
                empty={c.awaitingInput}
              />
            ))}
          </ToolSection>
        </>
      )}
    </>
  );
}

// --- 6. html-entities --------------------------------------------------------------

function HtmlEntitiesTool() {
  const s = strings.devtools.encoding["html-entities"];
  const c = strings.pro.common;
  const enc = strings.devtools.encoding.common;

  const [direction, setDirection] = useState<"escape" | "unescape">("escape");
  const [mode, setMode] = useState<HtmlEscapeMode>("minimal");
  const [text, setText] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [search, setSearch] = useState("");

  const modeLabel: Record<HtmlEscapeMode, string> = {
    minimal: s.modeMinimal,
    aggressive: s.modeAggressive,
  };
  const modeOptions = HTML_ESCAPE_MODES.map((id) => ({ id, label: modeLabel[id] }));

  const escaped = useMemo(() => htmlEscape(text, mode), [text, mode]);
  const unescaped = useMemo(() => htmlUnescape(text), [text]);

  const filteredReference = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === ""
      ? HTML_ENTITY_REFERENCE
      : HTML_ENTITY_REFERENCE.filter((entity) => entity.name.toLowerCase().includes(needle));
  }, [search]);

  return (
    <>
      <ModeSwitch
        value={direction}
        onChange={setDirection}
        ariaLabel={enc.direction}
        options={[
          { id: "escape", label: s.escape },
          { id: "unescape", label: s.unescape },
        ]}
      />
      {direction === "escape" && (
        <ToolSelect label={s.mode} value={mode} onChange={setMode} options={modeOptions} />
      )}
      <ToolTextArea
        label={s.input}
        value={text}
        onChange={setText}
        placeholder={s.inputPlaceholder}
      />
      {direction === "escape" ? (
        <ToolOutput label={s.output} value={escaped} multiline empty={c.awaitingInput} />
      ) : unescaped.ok ? (
        <ToolOutput label={s.output} value={unescaped.value} multiline empty={c.awaitingInput} />
      ) : (
        <ToolFailure>
          {withPosition(
            describeError(
              unescaped.code,
              {
                "entity-unterminated": s.errUnterminated,
                "entity-unknown": s.errUnknown,
                "entity-out-of-range": s.errOutOfRange,
              },
              c.invalid,
            ),
            unescaped.at,
            enc.position,
          )}
        </ToolFailure>
      )}

      <div className="tool__actions">
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={showReference}
          onClick={() => setShowReference((value) => !value)}
        >
          <Icon name={showReference ? "chevronDown" : "chevronRight"} size={14} />
          {s.reference}
        </Button>
      </div>
      {showReference && (
        <ToolSection>
          <ToolInput label={s.referenceSearch} value={search} onChange={setSearch} />
          <ToolTable
            head={[s.referenceName, s.referenceCharacter, s.referenceCodePoint]}
            rows={filteredReference.map((entity) => [
              entity.name,
              entity.character,
              codePointLabel(entity.codePoint),
            ])}
          />
        </ToolSection>
      )}
    </>
  );
}

// --- 7. hexdump ----------------------------------------------------------------------

/**
 * A layout field's value, or `null` when it does not hold one.
 *
 * It used to substitute the default silently, which made a typed `0` and a
 * typed `16` produce the same dump with nothing saying which one was used — the
 * only tool in this drawer that repaired instead of refusing.
 */
function layoutValue(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= HEXDUMP_MAX_LAYOUT ? value : null;
}

function HexdumpTool() {
  const s = strings.devtools.encoding.hexdump;
  const c = strings.pro.common;
  const enc = strings.devtools.encoding.common;

  const [mode, setMode] = useState<"dump" | "parse">("dump");
  const [text, setText] = useState("");
  const [perLineText, setPerLineText] = useState(String(HEXDUMP_DEFAULT_BYTES_PER_LINE));
  const [perGroupText, setPerGroupText] = useState(String(HEXDUMP_DEFAULT_BYTES_PER_GROUP));

  const perLine = useMemo(() => layoutValue(perLineText), [perLineText]);
  const perGroup = useMemo(() => layoutValue(perGroupText), [perGroupText]);
  const layoutError = fill(s.errLayout, { limit: HEXDUMP_MAX_LAYOUT });

  const dumped = useMemo(
    () =>
      perLine === null || perGroup === null
        ? ""
        : hexdump(textToUtf8(text), { bytesPerLine: perLine, bytesPerGroup: perGroup }),
    [text, perLine, perGroup],
  );
  const parsed = useMemo(() => parseHexdump(text), [text]);

  return (
    <>
      <ModeSwitch
        value={mode}
        onChange={setMode}
        ariaLabel={enc.direction}
        options={[
          { id: "dump", label: s.dump },
          { id: "parse", label: s.parse },
        ]}
      />
      {mode === "dump" && (
        <div className="tool__pair">
          <ToolInput
            label={s.bytesPerLine}
            value={perLineText}
            onChange={setPerLineText}
            error={perLine === null ? layoutError : undefined}
          />
          <ToolInput
            label={s.bytesPerGroup}
            value={perGroupText}
            onChange={setPerGroupText}
            error={perGroup === null ? layoutError : undefined}
          />
        </div>
      )}
      <ToolTextArea
        label={mode === "dump" ? s.textLabel : s.dumpLabel}
        value={text}
        onChange={setText}
        placeholder={mode === "dump" ? s.textPlaceholder : s.dumpPlaceholder}
      />
      {mode === "dump" ? (
        <ToolOutput label={s.output} value={dumped} multiline empty={c.awaitingInput} />
      ) : parsed.ok ? (
        <>
          {text !== "" && <ResultRow label={s.parsedBytes} value={parsed.value.length} />}
          <ToolOutput
            label={s.output}
            value={hexdump(parsed.value)}
            multiline
            empty={c.awaitingInput}
          />
        </>
      ) : (
        <ToolFailure>
          {describeError(
            parsed.code,
            {
              "not-a-hexdump": s.errNotAHexdump,
              "hexdump-offset-mismatch": s.errOffsetMismatch,
              "hexdump-ambiguous-gutter": s.errAmbiguousGutter,
            },
            c.invalid,
          )}
        </ToolFailure>
      )}
      <p className="tool__note">{s.hintGutter}</p>
    </>
  );
}

// --- The map -------------------------------------------------------------------------

export const ENCODING_SURFACES: Readonly<Record<string, ComponentType>> = {
  base64: Base64Tool,
  "url-encode": UrlEncodeTool,
  "url-parse": UrlParseTool,
  "ascii-binary-hex": AsciiBinaryHexTool,
  "unicode-inspector": UnicodeInspectorTool,
  "html-entities": HtmlEntitiesTool,
  hexdump: HexdumpTool,
};
