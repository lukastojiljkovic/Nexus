import {
  conversionLimits,
  DATA_FORMATS,
  parseCsvValue,
  parseJson,
  queryJsonPath,
  readStructured,
  formatJson,
  minifyJson,
  sortJsonKeys,
  stringifyJson,
  structuredFail,
  structuredOk,
  validateJson,
  writeStructured,
  type DataFormat,
  type StructuredError,
  type StructuredResult,
  type StructuredValue,
} from "@nexus/core/devtools/structured";
import { parseYaml, serializeYamlDocuments } from "@nexus/core/devtools/structuredYaml";
import {
  formatXml,
  minifyXml,
  queryXmlText,
  validateXml,
  xmlTextContent,
} from "@nexus/core/devtools/structuredXml";
import {
  jsonToTypes,
  JSON_TYPE_TARGETS,
  type JsonTypeTarget,
  type OptionalStyle,
} from "@nexus/core/devtools/jsonTypes";
import {
  createIdGenerator,
  parseUlid,
  parseUuid,
} from "@nexus/core/devtools/system";
import { webCryptoRandom } from "@nexus/core/devtools/random";
import { Button, Checkbox, Icon } from "@nexus/ui";
import { useMemo, useState, type ChangeEvent, type ComponentType, type ReactNode } from "react";

import {
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
 * „Podaci" — the 6 surfaces of this group of the developer drawer.
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
 *   - `json-editor`
 *   - `yaml-editor`
 *   - `xml-editor`
 *   - `data-format`
 *   - `json-to-types`
 *   - `uuid`
 *
 * **Five of the six share one physical shape** — a big source, a row of mode
 * controls, a big answer — because that IS what these tools are: a document
 * pasted in, a handful of ways to look at or transform it, and the result.
 * `TextToolBody` draws that shape once; every tool below supplies only what
 * differs (its fields, its own core-module calls, its own refusals).
 *
 * **Every parser here refuses rather than repairs**, and every refusal from
 * `@nexus/core/devtools/{structured,structuredYaml,structuredXml}` carries a
 * `StructuredError` — a stable `code`, machine `expected`/`found` tokens, and a
 * `SourcePosition`. `formatStructuredError` is the one place that becomes a
 * Serbian sentence with a line and a column, for all four tools that can
 * receive one. `json-to-types` is the exception: `jsonToTypes` reports a reason
 * (`empty` | `syntax` | `too_deep`) and — for `syntax` — the *engine's own*
 * message, in English. That detail is never shown; showing it would mean
 * putting an untranslated string in front of the user, which this drawer does
 * nowhere else.
 */

/**
 * The shape every text-heavy surface in this file takes: a big source, a row of
 * mode controls, and a big answer underneath. Written once and used five times
 * (JSON, YAML, XML, format conversion, JSON→types) instead of five hand-rolled
 * copies that would drift on spacing and on when the actions row shows up.
 */
function TextToolBody({
  sourceLabel,
  source,
  onSourceChange,
  sourcePlaceholder,
  actionsLabel,
  actions,
  children,
}: {
  sourceLabel: string;
  source: string;
  onSourceChange: (value: string) => void;
  sourcePlaceholder: string;
  actionsLabel: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ToolTextArea
        label={sourceLabel}
        value={source}
        onChange={onSourceChange}
        placeholder={sourcePlaceholder}
        rows={12}
      />
      <div className="tool__actions" role="group" aria-label={actionsLabel}>
        {actions}
      </div>
      {children}
    </>
  );
}

/** The app's segmented-control recipe (see `shared.tsx`'s header), named once. */
function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "primary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A `Checkbox`'s `onChange`, for the half-dozen plain boolean toggles below. */
function checkboxHandler(setValue: (value: boolean) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.checked);
}

/** One id/label option for the indent select — {@link indentSelectOptions}'s element type. */
interface IndentOption {
  readonly id: string;
  readonly label: string;
}

/** The indent choices `json-editor`, `xml-editor` and `data-format` all offer. */
function indentSelectOptions(tabLabel: string): readonly IndentOption[] {
  return [
    { id: "0", label: "0" },
    { id: "1", label: "1" },
    { id: "2", label: "2" },
    { id: "4", label: "4" },
    { id: "8", label: "8" },
    { id: "tab", label: tabLabel },
  ];
}

/** The select's string id back to what `formatJson`/`formatXml` actually take. */
function parseIndentId(id: string): number | "tab" {
  return id === "tab" ? "tab" : Number(id);
}

/**
 * The one place a `StructuredError` becomes a sentence, for every tool that can
 * receive one. `expected`/`found` are machine tokens the core module deliberately
 * leaves untranslated (see its own header comment) — this is where they are
 * folded into the fixed per-code sentence, and only when the parser actually
 * filled them in.
 */
function formatStructuredError(
  errors: Readonly<Record<string, string>>,
  words: {
    readonly expected: string;
    readonly found: string;
    readonly line: string;
    readonly column: string;
  },
  error: StructuredError,
): string {
  const message = errors[error.code] ?? error.code;
  const detail: string[] = [];
  if (error.expected !== "") detail.push(`${words.expected} ${error.expected}`);
  if (error.found !== "") detail.push(`${words.found} „${error.found}“`);
  const suffix = detail.length === 0 ? "" : ` (${detail.join(", ")})`;
  return `${message}${suffix} — ${words.line} ${error.line}, ${words.column} ${error.column}`;
}

/** A JSONPath hit as one line of text — never re-implements JSON rendering, only calls it. */
function jsonSnippet(value: StructuredValue): string {
  const rendered = stringifyJson(value, { indent: 0 });
  return rendered.ok ? rendered.value : "";
}

// ---------------------------------------------------------------------------
// json-editor
// ---------------------------------------------------------------------------

type JsonMode = "format" | "minify" | "sort" | "validate";

function JsonEditorTool() {
  // Read inside the component, never at module scope — see `check-string-capture.mjs`.
  const s = strings.devtools.data;
  const t = s.jsonEditor;
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<JsonMode>("format");
  const [indent, setIndent] = useState("2");
  const [path, setPath] = useState("");

  const hasSource = source.trim() !== "";
  const indentValue = parseIndentId(indent);

  const primary = useMemo((): StructuredResult<string> | null => {
    if (!hasSource) return null;
    if (mode === "minify") return minifyJson(source);
    if (mode === "sort") return sortJsonKeys(source, { indent: indentValue });
    if (mode === "format") return formatJson(source, { indent: indentValue });
    const error = validateJson(source);
    return error === null ? structuredOk("") : structuredFail(error);
  }, [hasSource, source, mode, indentValue]);

  const queryResult = useMemo((): StructuredResult<readonly StructuredValue[]> | null => {
    if (!hasSource || path.trim() === "") return null;
    const value = parseJson(source);
    if (!value.ok) return value;
    return queryJsonPath(value.value, path);
  }, [hasSource, source, path]);

  return (
    <TextToolBody
      sourceLabel={t.source}
      source={source}
      onSourceChange={setSource}
      sourcePlaceholder={t.sourcePlaceholder}
      actionsLabel={t.title}
      actions={
        <>
          <ModeButton active={mode === "format"} onClick={() => setMode("format")}>
            {t.format}
          </ModeButton>
          <ModeButton active={mode === "minify"} onClick={() => setMode("minify")}>
            {t.minify}
          </ModeButton>
          <ModeButton active={mode === "sort"} onClick={() => setMode("sort")}>
            {t.sortKeys}
          </ModeButton>
          <ModeButton active={mode === "validate"} onClick={() => setMode("validate")}>
            {t.validate}
          </ModeButton>
          {mode !== "minify" && mode !== "validate" && (
            <ToolSelect
              label={s.indent}
              value={indent}
              options={indentSelectOptions(s.indentTab)}
              onChange={setIndent}
            />
          )}
        </>
      }
    >
      {!hasSource ? (
        <ToolOutput
          label={strings.pro.common.result}
          value=""
          empty={strings.pro.common.awaitingInput}
        />
      ) : primary === null ? null : !primary.ok ? (
        <ToolFailure>{formatStructuredError(s.errors, s.position, primary.error)}</ToolFailure>
      ) : mode === "validate" ? (
        <p className="tool__note">{t.valid}</p>
      ) : (
        <ToolOutput label={strings.pro.common.result} value={primary.value} multiline />
      )}

      <ToolSection title={t.pathTitle}>
        <ToolInput
          label={t.path}
          value={path}
          onChange={setPath}
          placeholder={t.pathPlaceholder}
          mono
        />
        {queryResult !== null &&
          (!queryResult.ok ? (
            <ToolFailure>
              {formatStructuredError(s.errors, s.position, queryResult.error)}
            </ToolFailure>
          ) : (
            <>
              <p className="tool__note">
                {queryResult.value.length === 0
                  ? t.noHits
                  : `${t.hits}: ${queryResult.value.length}`}
              </p>
              {queryResult.value.length > 0 && (
                <ToolTable
                  head={[t.hitIndex, t.hitValue]}
                  rows={queryResult.value.map((item, index) => [
                    String(index + 1),
                    jsonSnippet(item),
                  ])}
                />
              )}
            </>
          ))}
      </ToolSection>
    </TextToolBody>
  );
}

// ---------------------------------------------------------------------------
// yaml-editor
// ---------------------------------------------------------------------------

function YamlEditorTool() {
  const s = strings.devtools.data;
  const t = s.yamlEditor;
  const [source, setSource] = useState("");
  const [view, setView] = useState<"json" | "yaml">("json");
  const [sortKeys, setSortKeys] = useState(false);
  const [docIndex, setDocIndex] = useState(0);

  const hasSource = source.trim() !== "";
  const parsed = useMemo(() => (hasSource ? parseYaml(source) : null), [hasSource, source]);
  const documents = parsed !== null && parsed.ok ? parsed.value : [];
  const activeIndex = documents.length === 0 ? 0 : Math.min(docIndex, documents.length - 1);

  const output = useMemo((): StructuredResult<string> | null => {
    if (parsed === null || !parsed.ok) return null;
    if (view === "yaml") return structuredOk(serializeYamlDocuments(parsed.value, { sortKeys }));
    return stringifyJson(parsed.value[activeIndex] ?? null, { sortKeys, indent: 2 });
  }, [parsed, view, sortKeys, activeIndex]);

  return (
    <TextToolBody
      sourceLabel={t.source}
      source={source}
      onSourceChange={setSource}
      sourcePlaceholder={t.sourcePlaceholder}
      actionsLabel={t.title}
      actions={
        <>
          <ModeButton active={view === "json"} onClick={() => setView("json")}>
            {t.viewJson}
          </ModeButton>
          <ModeButton active={view === "yaml"} onClick={() => setView("yaml")}>
            {t.viewYaml}
          </ModeButton>
          <Checkbox checked={sortKeys} onChange={checkboxHandler(setSortKeys)}>
            {t.sortKeys}
          </Checkbox>
          {view === "json" && documents.length > 1 && (
            <ToolSelect
              label={t.document}
              value={String(activeIndex)}
              options={documents.map((_document, index) => ({
                id: String(index),
                label: String(index + 1),
              }))}
              onChange={(value) => setDocIndex(Number(value))}
            />
          )}
        </>
      }
    >
      {documents.length > 1 && (
        <p className="tool__note">{`${t.documents}: ${documents.length}`}</p>
      )}
      {!hasSource ? (
        <ToolOutput
          label={strings.pro.common.result}
          value=""
          empty={strings.pro.common.awaitingInput}
        />
      ) : parsed !== null && !parsed.ok ? (
        <ToolFailure>{formatStructuredError(s.errors, s.position, parsed.error)}</ToolFailure>
      ) : output !== null && !output.ok ? (
        <ToolFailure>{formatStructuredError(s.errors, s.position, output.error)}</ToolFailure>
      ) : output !== null ? (
        <ToolOutput label={strings.pro.common.result} value={output.value} multiline />
      ) : null}
    </TextToolBody>
  );
}

// ---------------------------------------------------------------------------
// xml-editor
// ---------------------------------------------------------------------------

type XmlMode = "format" | "minify" | "validate";

function XmlEditorTool() {
  const s = strings.devtools.data;
  const t = s.xmlEditor;
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<XmlMode>("format");
  const [indent, setIndent] = useState("2");
  const [path, setPath] = useState("");

  const hasSource = source.trim() !== "";
  const indentValue = parseIndentId(indent);

  const primary = useMemo((): StructuredResult<string> | null => {
    if (!hasSource) return null;
    if (mode === "minify") return minifyXml(source);
    if (mode === "format") return formatXml(source, { indent: indentValue });
    const error = validateXml(source);
    return error === null ? structuredOk("") : structuredFail(error);
  }, [hasSource, source, mode, indentValue]);

  const queryResult = useMemo(() => {
    if (!hasSource || path.trim() === "") return null;
    return queryXmlText(source, path);
  }, [hasSource, source, path]);

  return (
    <TextToolBody
      sourceLabel={t.source}
      source={source}
      onSourceChange={setSource}
      sourcePlaceholder={t.sourcePlaceholder}
      actionsLabel={t.title}
      actions={
        <>
          <ModeButton active={mode === "format"} onClick={() => setMode("format")}>
            {t.format}
          </ModeButton>
          <ModeButton active={mode === "minify"} onClick={() => setMode("minify")}>
            {t.minify}
          </ModeButton>
          <ModeButton active={mode === "validate"} onClick={() => setMode("validate")}>
            {t.validate}
          </ModeButton>
          {mode === "format" && (
            <ToolSelect
              label={s.indent}
              value={indent}
              options={indentSelectOptions(s.indentTab)}
              onChange={setIndent}
            />
          )}
        </>
      }
    >
      {!hasSource ? (
        <ToolOutput
          label={strings.pro.common.result}
          value=""
          empty={strings.pro.common.awaitingInput}
        />
      ) : primary === null ? null : !primary.ok ? (
        <ToolFailure>{formatStructuredError(s.errors, s.position, primary.error)}</ToolFailure>
      ) : mode === "validate" ? (
        <p className="tool__note">{t.valid}</p>
      ) : (
        <ToolOutput label={strings.pro.common.result} value={primary.value} multiline />
      )}

      <ToolSection title={t.pathTitle}>
        <ToolInput
          label={t.path}
          value={path}
          onChange={setPath}
          placeholder={t.pathPlaceholder}
          mono
        />
        {queryResult !== null &&
          (!queryResult.ok ? (
            <ToolFailure>
              {formatStructuredError(s.errors, s.position, queryResult.error)}
            </ToolFailure>
          ) : (
            <>
              <p className="tool__note">
                {queryResult.value.length === 0
                  ? t.noHits
                  : `${t.hits}: ${queryResult.value.length}`}
              </p>
              {queryResult.value.length > 0 && (
                <ToolTable
                  head={[t.element, t.attributes, t.text]}
                  rows={queryResult.value.map((element) => [
                    element.name,
                    element.attributes
                      .map((attribute) =>
                        attribute.hasValue
                          ? `${attribute.name}="${attribute.value}"`
                          : attribute.name,
                      )
                      .join(" "),
                    xmlTextContent(element),
                  ])}
                />
              )}
            </>
          ))}
      </ToolSection>
    </TextToolBody>
  );
}

// ---------------------------------------------------------------------------
// data-format
// ---------------------------------------------------------------------------

/** `DATA_FORMATS` as `ToolSelect` options — iterates the module's own list, not a hand copy. */
function dataFormatOptions(
  labels: Readonly<Record<DataFormat, string>>,
): readonly { readonly id: DataFormat; readonly label: string }[] {
  return DATA_FORMATS.map((id) => ({ id, label: labels[id] }));
}

function DataFormatTool() {
  const s = strings.devtools.data;
  const t = s.dataFormat;
  const [source, setSource] = useState("");
  const [from, setFrom] = useState<DataFormat>("json");
  const [to, setTo] = useState<DataFormat>("yaml");
  const [indent, setIndent] = useState("2");
  const [sortKeys, setSortKeys] = useState(false);
  const [delimiter, setDelimiter] = useState(",");
  const [header, setHeader] = useState(true);
  const [nullAsEmpty, setNullAsEmpty] = useState(false);

  const hasSource = source.trim() !== "";
  const limits = conversionLimits(from, to);
  const involvesCsv = from === "csv" || to === "csv";
  // One character, per RFC 4180 — a longer paste would otherwise silently never
  // match, since the codec compares it against single characters of the text.
  const effectiveDelimiter = delimiter.slice(0, 1) || ",";

  const result = useMemo((): StructuredResult<string> | null => {
    if (!hasSource) return null;
    // `readStructured`/`convertFormat` always read CSV with the default comma
    // and header — their `DataFormat` signature has no room for a read option.
    // Calling `parseCsvValue` directly is what makes the delimiter/header choice
    // above actually apply when reading FROM csv.
    const value =
      from === "csv"
        ? parseCsvValue(source, { delimiter: effectiveDelimiter, header })
        : readStructured(source, from);
    if (!value.ok) return value;
    return writeStructured(value.value, to, {
      indent: parseIndentId(indent),
      sortKeys,
      csv: { delimiter: effectiveDelimiter, header, nullAs: nullAsEmpty ? "empty" : "refuse" },
    });
  }, [hasSource, source, from, to, effectiveDelimiter, header, indent, sortKeys, nullAsEmpty]);

  return (
    <TextToolBody
      sourceLabel={t.source}
      source={source}
      onSourceChange={setSource}
      sourcePlaceholder={t.sourcePlaceholder}
      actionsLabel={t.title}
      actions={
        <>
          <ToolSelect
            label={t.from}
            value={from}
            options={dataFormatOptions(t.formats)}
            onChange={setFrom}
          />
          <Button
            className="tool__swap"
            size="sm"
            aria-label={t.swap}
            title={t.swap}
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <Icon name="swap" />
          </Button>
          <ToolSelect
            label={t.to}
            value={to}
            options={dataFormatOptions(t.formats)}
            onChange={setTo}
          />
        </>
      }
    >
      {limits.length > 0 && (
        <ToolSection title={t.limitsTitle}>
          {limits.map((code) => (
            <p key={code} className="tool__note">
              {t.limits[code]}
            </p>
          ))}
        </ToolSection>
      )}

      {(to === "json" || to === "yaml") && (
        <ToolSection title={t.outputOptions}>
          <div className="tool__actions" role="group" aria-label={t.outputOptions}>
            {to === "json" && (
              <ToolSelect
                label={s.indent}
                value={indent}
                options={indentSelectOptions(s.indentTab)}
                onChange={setIndent}
              />
            )}
            <Checkbox checked={sortKeys} onChange={checkboxHandler(setSortKeys)}>
              {t.sortKeys}
            </Checkbox>
          </div>
        </ToolSection>
      )}

      {involvesCsv && (
        <ToolSection title={t.csvOptions}>
          <div className="tool__pair">
            <ToolInput label={t.delimiter} value={delimiter} onChange={setDelimiter} mono />
            <Checkbox checked={header} onChange={checkboxHandler(setHeader)}>
              {t.header}
            </Checkbox>
          </div>
          {to === "csv" && (
            <Checkbox checked={nullAsEmpty} onChange={checkboxHandler(setNullAsEmpty)}>
              {t.nullAsEmpty}
            </Checkbox>
          )}
        </ToolSection>
      )}

      {!hasSource ? (
        <ToolOutput
          label={strings.pro.common.result}
          value=""
          empty={strings.pro.common.awaitingInput}
        />
      ) : result !== null && !result.ok ? (
        <ToolFailure>{formatStructuredError(s.errors, s.position, result.error)}</ToolFailure>
      ) : result !== null ? (
        <ToolOutput label={strings.pro.common.result} value={result.value} multiline />
      ) : null}
    </TextToolBody>
  );
}

// ---------------------------------------------------------------------------
// json-to-types
// ---------------------------------------------------------------------------

function JsonToTypesTool() {
  const s = strings.devtools.data;
  const t = s.jsonToTypes;
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<JsonTypeTarget>("interface");
  const [rootName, setRootName] = useState("");
  const [readonlyOverride, setReadonlyOverride] = useState<boolean | null>(null);
  const [optionalStyle, setOptionalStyle] = useState<OptionalStyle>("question");
  const [inlineSingleUse, setInlineSingleUse] = useState(false);

  const hasSource = source.trim() !== "";
  // `undefined` until the user has touched the switch, so it follows the
  // module's own per-target default (`type` readonly, the others not) — once
  // touched, the user's choice sticks across a later target change.
  const useReadonly = readonlyOverride ?? target === "type";

  const result = useMemo(() => {
    if (!hasSource) return null;
    return jsonToTypes(source, { target, rootName, useReadonly, optionalStyle, inlineSingleUse });
  }, [hasSource, source, target, rootName, useReadonly, optionalStyle, inlineSingleUse]);

  return (
    <TextToolBody
      sourceLabel={t.source}
      source={source}
      onSourceChange={setSource}
      sourcePlaceholder={t.sourcePlaceholder}
      actionsLabel={t.title}
      actions={
        <>
          {JSON_TYPE_TARGETS.map((id) => (
            <ModeButton key={id} active={target === id} onClick={() => setTarget(id)}>
              {t.targetLabel[id]}
            </ModeButton>
          ))}
        </>
      }
    >
      <ToolInput
        label={t.rootName}
        value={rootName}
        onChange={setRootName}
        placeholder={t.rootNamePlaceholder}
      />

      <div className="tool__actions" role="group" aria-label={t.options}>
        <Checkbox checked={useReadonly} onChange={checkboxHandler(setReadonlyOverride)}>
          {t.readonly}
        </Checkbox>
        <Checkbox checked={inlineSingleUse} onChange={checkboxHandler(setInlineSingleUse)}>
          {t.inlineSingleUse}
        </Checkbox>
      </div>

      {target !== "zod" && (
        <div className="tool__actions" role="group" aria-label={t.optionalStyle}>
          <ModeButton
            active={optionalStyle === "question"}
            onClick={() => setOptionalStyle("question")}
          >
            {t.optionalQuestion}
          </ModeButton>
          <ModeButton
            active={optionalStyle === "undefined"}
            onClick={() => setOptionalStyle("undefined")}
          >
            {t.optionalUndefined}
          </ModeButton>
        </div>
      )}

      {!hasSource ? (
        <ToolOutput label={t.output} value="" empty={strings.pro.common.awaitingInput} />
      ) : result === null ? null : !result.ok ? (
        <ToolFailure>{t.errors[result.reason]}</ToolFailure>
      ) : (
        <>
          <div className="tool__results">
            <ResultRow
              label={t.typesCount}
              value={String(result.model.types.length)}
              mono={false}
            />
          </div>
          <ToolOutput label={t.output} value={result.code} multiline />
        </>
      )}
    </TextToolBody>
  );
}

// ---------------------------------------------------------------------------
// uuid
// ---------------------------------------------------------------------------

function UuidTool() {
  const s = strings.devtools.data;
  const t = s.uuid;
  // One generator for the component's lifetime, not one per click — that is
  // what makes uuidV7/ulid monotonic across repeated presses, per the module's
  // own header comment.
  const [generator] = useState(() => createIdGenerator(webCryptoRandom));
  const [generated, setGenerated] = useState("");
  const [inspectText, setInspectText] = useState("");

  const uuid = parseUuid(inspectText);
  const ulid = uuid === null ? parseUlid(inspectText) : null;
  const invalid = inspectText.trim() !== "" && uuid === null && ulid === null;

  return (
    <>
      <ToolSection title={t.generateTitle}>
        <div className="tool__actions" role="group" aria-label={t.generateTitle}>
          <Button size="sm" onClick={() => setGenerated(generator.uuidV4())}>
            {t.genV4}
          </Button>
          <Button size="sm" onClick={() => setGenerated(generator.uuidV7(Date.now()))}>
            {t.genV7}
          </Button>
          <Button size="sm" onClick={() => setGenerated(generator.ulid(Date.now()))}>
            {t.genUlid}
          </Button>
        </div>
        <ToolOutput
          label={strings.pro.common.result}
          value={generated}
          empty={t.generateEmpty}
        />
      </ToolSection>

      <ToolSection title={t.inspectTitle}>
        <ToolInput
          label={t.inspectLabel}
          value={inspectText}
          onChange={setInspectText}
          placeholder={t.inspectPlaceholder}
          mono
        />
        {invalid ? (
          <ToolFailure>{t.invalid}</ToolFailure>
        ) : uuid !== null ? (
          <div className="tool__results">
            <ResultRow label={t.canonical} value={uuid.canonical} />
            <ResultRow label={t.variant} value={t.variantLabel[uuid.variant]} mono={false} />
            {uuid.variant === "rfc4122" && (
              <ResultRow label={t.version} value={String(uuid.version)} />
            )}
            {uuid.special !== null && (
              <ResultRow label={t.special} value={t.specialLabel[uuid.special]} mono={false} />
            )}
            {uuid.timestampMs !== null && (
              <>
                <ResultRow label={t.timestamp} value={String(uuid.timestampMs)} />
                <ResultRow
                  label={t.timestampIso}
                  value={new Date(uuid.timestampMs).toISOString()}
                />
              </>
            )}
          </div>
        ) : ulid !== null ? (
          <div className="tool__results">
            <ResultRow label={t.canonical} value={ulid.canonical} />
            <ResultRow label={t.timestamp} value={String(ulid.timestampMs)} />
            <ResultRow
              label={t.timestampIso}
              value={new Date(ulid.timestampMs).toISOString()}
            />
            <ResultRow
              label={t.randomness}
              value={ulid.randomness.toString(16).padStart(20, "0")}
            />
          </div>
        ) : null}
      </ToolSection>
    </>
  );
}

export const DATA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "json-editor": JsonEditorTool,
  "yaml-editor": YamlEditorTool,
  "xml-editor": XmlEditorTool,
  "data-format": DataFormatTool,
  "json-to-types": JsonToTypesTool,
  uuid: UuidTool,
};
