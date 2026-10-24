import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, Icon, LoadingState, Segmented, TextArea } from "@nexus/ui";

import { activeLocale } from "../../../../renderer/src/moduleKit/moduleSurface.js";
import { fill, intlTags } from "../../../../renderer/src/strings.js";
import {
  NLLB_PACK_IDS,
  TRANSLATOR_TEXT_MAX_CHARS,
  type NllbPackId,
  type TranslatorRuntimeView,
} from "../../shared/ipc.js";
import { languageByCode } from "../../shared/languages.js";
import { copy } from "../copy.js";
import {
  persistRecentLanguages,
  persistSerbianScript,
  persistTranslateModel,
  persistTranslateSource,
  persistTranslateTarget,
  readRecentLanguages,
  readStoredSerbianScript,
  readStoredTranslateModel,
  readStoredTranslateSource,
  readStoredTranslateTarget,
  withRecentLanguage,
  type LanguageSide,
  type SerbianScript,
} from "../prefs.js";
import { LanguagePanel } from "./LanguagePanel.js";
import { detectLanguage } from "./detect.js";
import { languageEntries, type LanguageEntry } from "./languages.js";
import type { TranslateRequest } from "./request.js";
import { serbianToCyrillic, serbianToLatin } from "./serbian.js";
import { TranslationSession, type SessionView } from "./session.js";

/** The three NLLB-200 models, by the name a reader knows them under. */
const MODEL_LABEL: Record<NllbPackId, string> = { "nllb-600m": "600M", "nllb-1300m": "1.3B", "nllb-3300m": "3.3B" };

/** How long the Copy button says „Copied“. */
const COPIED_MS = 1500;

export interface TranslateTabProps {
  /** A translation the assistant asked for; the tab adopts it once and then reports it applied. */
  readonly request: TranslateRequest | null;
  readonly onRequestApplied: () => void;
}

/**
 * The translate tab (ADR-090): one text, translated as the user types, with the
 * NLLB model main has installed.
 *
 * The page is a bar of the two language pickers and the swap between them, the
 * model choice on the right, and two panes: the text to translate, and the
 * translation. The debounce, the polling and every error are in
 * `session.ts`; this file draws what the session says and keeps the choices.
 */
export function TranslateTab({ request, onRequestApplied }: TranslateTabProps) {
  const locale = activeLocale();
  const tags = intlTags(locale);
  const languages = useMemo(() => languageEntries(tags), [tags]);
  const entryByCode = useMemo(() => new Map(languages.map((entry) => [entry.row.code, entry])), [languages]);
  const nameOf = (code: string): string => entryByCode.get(code)?.name ?? code;

  const [installed, setInstalled] = useState<readonly NllbPackId[] | null>(null);
  const [packsFailed, setPacksFailed] = useState(false);
  const [modelChoice, setModelChoice] = useState<NllbPackId | null>(() => readStoredTranslateModel());
  const [text, setText] = useState("");
  const [source, setSource] = useState(() => readStoredTranslateSource());
  const [target, setTarget] = useState(() =>
    readStoredTranslateTarget(locale === "sr" ? "srp_Cyrl" : "eng_Latn"),
  );
  const [recent, setRecent] = useState(() => ({
    source: readRecentLanguages("source"),
    target: readRecentLanguages("target"),
  }));
  const [script, setScript] = useState<SerbianScript>(() => readStoredSerbianScript());
  const [open, setOpen] = useState<LanguageSide | null>(null);
  const [view, setView] = useState<SessionView>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [runtime, setRuntime] = useState<TranslatorRuntimeView | null>(null);
  const [session] = useState(() => new TranslationSession(window.nexus.modules.translator, setView));
  const sourceButton = useRef<HTMLButtonElement>(null);
  const targetButton = useRef<HTMLButtonElement>(null);

  useEffect(() => () => session.dispose(), [session]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { packs } = await window.nexus.modules.translator.packs({});
        const present = new Set(packs.map((pack) => pack.id));
        if (active) setInstalled(NLLB_PACK_IDS.filter((id) => present.has(id)));
      } catch (failure) {
        if (active) {
          setInstalled([]);
          setPacksFailed(true);
        }
        console.error("Nexus: the translation models could not be listed:", failure);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The assistant's request is adopted once, and the page is told it was.
  useEffect(() => {
    if (request === null) return;
    setText(request.text);
    setSource(request.from);
    setTarget(request.to);
    onRequestApplied();
  }, [request, onRequestApplied]);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(handle);
  }, [copied]);

  // The model in use: the one the user chose if it is installed, else the smallest installed.
  const model = installed?.find((id) => id === modelChoice) ?? installed?.[0] ?? null;

  useEffect(() => {
    let live = true;
    void window.nexus.modules.translator.runtime({}).then((next) => {
      if (live) setRuntime(next);
    });
    return () => {
      live = false;
    };
  }, [model]);

  // The source is the detected language while the picker says Detect.
  const detected = useMemo(() => (source === "auto" ? detectLanguage(text, locale) : null), [source, text, locale]);
  const sourceRow = source === "auto" ? detected : (languageByCode(source) ?? null);
  const targetRow = languageByCode(target) ?? null;
  const sourceCode = sourceRow?.code ?? null;
  const targetCode = targetRow?.code ?? null;
  const serbianTarget = targetCode === "srp_Cyrl";
  // NLLB reads Serbian only in Cyrillic, so Latin input is written in Cyrillic first.
  const modelText = sourceCode === "srp_Cyrl" ? serbianToCyrillic(text) : text;

  useEffect(() => {
    session.update(
      model !== null && sourceCode !== null && targetCode !== null
        ? { packId: model, text: modelText, source: sourceCode, target: targetCode }
        : null,
    );
  }, [session, model, modelText, sourceCode, targetCode]);

  useEffect(() => {
    if (view.kind !== "done") return;
    void window.nexus.modules.translator.runtime({}).then(setRuntime);
  }, [view.kind]);

  const translated = view.kind === "translating" || view.kind === "done" || view.kind === "failed" ? view.text : "";
  const shown = serbianTarget && script === "latin" ? serbianToLatin(translated) : translated;

  function pick(side: LanguageSide, code: string): void {
    if (side === "source") {
      setSource(code);
      persistTranslateSource(code);
    } else {
      setTarget(code);
      persistTranslateTarget(code);
    }
    if (code !== "auto") {
      const next = withRecentLanguage(recent[side], code);
      setRecent((current) => ({ ...current, [side]: next }));
      persistRecentLanguages(side, next);
    }
    close(side);
  }

  function close(side: LanguageSide): void {
    setOpen(null);
    (side === "source" ? sourceButton : targetButton).current?.focus();
  }

  function swap(): void {
    if (sourceCode === null || targetCode === null) return;
    setSource(targetCode);
    persistTranslateSource(targetCode);
    setTarget(sourceCode);
    persistTranslateTarget(sourceCode);
    setText(shown);
  }

  function chooseModel(id: NllbPackId): void {
    setModelChoice(id);
    persistTranslateModel(id);
  }

  function chooseScript(next: SerbianScript): void {
    setScript(next);
    persistSerbianScript(next);
  }

  async function copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
    } catch (failure) {
      console.error("Nexus: the translation could not be copied:", failure);
    }
  }

  async function loadModel(): Promise<void> {
    if (model === null) return;
    setRuntime((current) => current === null ? current : { ...current, state: "loading", model: null });
    try {
      setRuntime(await window.nexus.modules.translator.loadModel({ packId: model }));
    } catch (failure) {
      setRuntime((current) => current === null ? null : { ...current, state: "error", model: null });
      console.error("Nexus: the translation model could not be loaded:", failure);
    }
  }

  async function ejectModel(): Promise<void> {
    setRuntime((current) => current === null ? current : { ...current, state: "ejecting" });
    try {
      setRuntime(await window.nexus.modules.translator.ejectModel({}));
    } catch (failure) {
      setRuntime((current) => current === null ? null : { ...current, state: "error" });
      console.error("Nexus: the translation model could not be ejected:", failure);
    }
  }

  if (installed !== null && installed.length === 0) {
    return packsFailed ? (
      <p className="translator__error" role="alert">
        {copy.errors.load}
      </p>
    ) : (
      <EmptyState title={copy.translate.noModel.title} description={copy.translate.noModel.body} sigil="book" />
    );
  }
  if (installed === null || model === null) return <LoadingState label={copy.page.loading} rows={3} />;

  const message =
    view.kind === "same-language"
      ? copy.translate.sameLanguage
      : view.kind === "failed"
        ? view.reason === "load-failed"
          ? copy.translate.loadFailed
          : copy.translate.translateFailed
        : null;
  const recentEntries = (side: LanguageSide): LanguageEntry[] =>
    recent[side].map((code) => entryByCode.get(code)).filter((entry): entry is LanguageEntry => entry !== undefined);

  return (
    <Card className="translator__translate">
      <div className="translator__bar">
        <Button
          ref={sourceButton}
          variant="ghost"
          aria-expanded={open === "source"}
          onClick={() => setOpen(open === "source" ? null : "source")}
        >
          {source === "auto"
            ? detected !== null
              ? fill(copy.translate.detected, { language: nameOf(detected.code) })
              : copy.translate.detect
            : nameOf(source)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={copy.translate.swap}
          title={copy.translate.swap}
          disabled={sourceCode === null || targetCode === null}
          onClick={swap}
        >
          <Icon name="swap" />
        </Button>
        <Button
          ref={targetButton}
          variant="ghost"
          aria-expanded={open === "target"}
          onClick={() => setOpen(open === "target" ? null : "target")}
        >
          {nameOf(target)}
        </Button>
        {installed.length > 1 && (
          <Segmented
            className="translator__model"
            label={copy.translate.model}
            options={installed.map((id) => ({ value: id, label: MODEL_LABEL[id] }))}
            value={model}
            onSelect={chooseModel}
          />
        )}
        {runtime !== null && (
          <div className="translator__memory" role="status">
            <span className="nx-hint">
              {runtime.state === "resident" && runtime.model !== null
                ? fill(copy.translate.memoryResident, { model: MODEL_LABEL[runtime.model] })
                : lookupRuntimeState(runtime.state)}
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={runtime.state === "loading" || runtime.state === "ejecting"}
              onClick={() => void loadModel()}
            >
              {copy.translate.loadModel}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={runtime.state === "absent" || runtime.state === "ejecting"}
              onClick={() => void ejectModel()}
            >
              {copy.translate.ejectModel}
            </Button>
          </div>
        )}
      </div>
      {installed.length > 1 && <p className="nx-hint">{copy.translate.modelHint}</p>}
      <p className="nx-hint">{copy.translate.memoryIdleHint}</p>

      {open !== null && (
        <LanguagePanel
          label={open === "source" ? copy.translate.source : copy.translate.target}
          entries={languages}
          recent={recentEntries(open)}
          selected={open === "source" ? (source === "auto" ? null : source) : target}
          auto={
            open === "source"
              ? { label: copy.translate.detect, selected: source === "auto", onChoose: () => pick("source", "auto") }
              : undefined
          }
          onChoose={(code) => pick(open, code)}
          onClose={() => close(open)}
          noMatch={(query) => fill(copy.translate.noLanguage, { query })}
        />
      )}

      <div className="translator__panes">
        <section className="translator__pane">
          <TextArea
            className="translator__input"
            label={copy.translate.input}
            placeholder={copy.translate.inputPlaceholder}
            value={text}
            rows={8}
            maxLength={TRANSLATOR_TEXT_MAX_CHARS}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="translator__pane-actions">
            <span className="nx-hint">
              {fill(copy.translate.count, { count: text.length, max: TRANSLATOR_TEXT_MAX_CHARS })}
            </span>
            <Button size="sm" variant="quiet" disabled={text === ""} onClick={() => setText("")}>
              {copy.translate.clear}
            </Button>
          </div>
        </section>

        <section className="translator__pane">
          <div className="translator__pane-head">
            <h3 className="nx-eyebrow">{copy.translate.output}</h3>
            {serbianTarget && (
              <Segmented
                label={copy.translate.script}
                options={[
                  { value: "latin", label: copy.translate.latin },
                  { value: "cyrillic", label: copy.translate.cyrillic },
                ]}
                value={script}
                onSelect={chooseScript}
              />
            )}
          </div>
          <div className="translator__output" aria-live="polite">
            {shown !== "" && <p className="translator__result">{shown}</p>}
            {message !== null &&
              (view.kind === "failed" ? (
                <p className="translator__error" role="alert">
                  {message}
                </p>
              ) : (
                <p className="nx-hint">{message}</p>
              ))}
            {shown === "" && message === null && text.trim() === "" && (
              <p className="nx-hint">{copy.translate.outputPlaceholder}</p>
            )}
          </div>
          <div className="translator__pane-actions">
            {view.kind === "translating" && (
              <p className="nx-hint">
                {fill(copy.translate.progress, { translated: view.translated, total: view.total })}
              </p>
            )}
            <Button size="sm" variant="quiet" disabled={shown === ""} onClick={() => void copyOutput()}>
              {copied ? copy.translate.copied : copy.translate.copy}
            </Button>
          </div>
        </section>
      </div>
    </Card>
  );
}

function lookupRuntimeState(state: TranslatorRuntimeView["state"]): string {
  if (state === "loading") return copy.translate.memoryLoading;
  if (state === "ejecting") return copy.translate.memoryEjecting;
  if (state === "error") return copy.translate.memoryError;
  return copy.translate.memoryAbsent;
}
