import { useCallback, useEffect, useRef, useState } from "react";
import {
  moveOrderEntry,
  pageOrder,
  parsePageRanges,
  QUARTER_TURN_DEGREES,
  removeOrderEntry,
  type ModuleText,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageRangeRefusal,
} from "@nexus/core";
import { Button, Card, EmptyState, Select, TextField } from "@nexus/ui";
import { formatFileSize } from "../../../../renderer/src/fileRows.js";
import type { WorkshopFilesApi } from "../../shared/workshopFiles.js";
import type { PdfDocumentInfo, PdfRefusalReason } from "./operations.js";
import { createPdfWorker, spawnPdfWorker, type PdfJobRunner } from "./workerClient.js";
import { copy, fileCount, pageCount, sentence, text } from "./text.js";
import "./pdfTools.css";

/**
 * The WORKSHOP module's PDF tool set (ADR-090): merge, split, rotate, reorder,
 * delete, extract and number — offline, in a worker.
 *
 * **Why one component with three cards.** The tool is one document and one
 * question — "what should the file I write contain?" — so the page keeps ONE
 * working document and everything the user does edits it: the file list says
 * what was merged into it, the tile grid says what pages it has and in what
 * order, and the export card says what is done to it on the way out. A wizard
 * would put the same state behind three screens with no way back.
 *
 * **Every edit goes through the worker, and each one REPLACES the working
 * document** with the bytes the worker wrote. Nothing is applied speculatively
 * on the renderer's side, so what the grid shows and what `save` writes are the
 * same document by construction; a page that kept a plan beside a preview would
 * have two truths about one file.
 *
 * **Why the tiles are outlines and not pictures.** pdf-lib parses documents; it
 * does not draw them, and this app ships no PDF rasteriser. A tile therefore
 * shows what the app actually knows about a page — its number, its orientation,
 * its size in points and its rotation — and the copy says so rather than
 * promising a preview. Reordering, deleting and rotating work on those tiles
 * exactly as they would on pictures.
 *
 * **No "compress".** Measured on a 1 MB real-world PDF and two smaller ones,
 * re-writing a document through pdf-lib (object streams, unreferenced objects
 * dropped) saves 5.7-12.8%; on an image-heavy document — the case somebody
 * reaches for a compress button with, where the images ARE the file and are
 * copied byte for byte — it saves 0.00%. A button that showed "0%" would be the
 * app lying about what it did, so this tool set has none.
 */

/** One picked file, with what the worker made of it. */
interface QueuedPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Its page count, or `null` when it could not be read. */
  readonly info: PdfDocumentInfo | null;
  /** Why it could not be read, when it could not be. */
  readonly problem: PdfRefusalReason | null;
}

/** The document the grid shows and `save` writes. */
interface WorkingPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly info: PdfDocumentInfo;
}

/** The job that is running, as the progress line reads it: `done` is `null` when the job reports no steps. */
interface Busy {
  readonly label: ModuleText;
  readonly done: number | null;
  readonly total: number | null;
}

/** The refusals a range expression has, as the sentences this table words them with. */
const RANGE_PROBLEMS: Record<PageRangeRefusal, ModuleText> = {
  empty: copy.pages.rangeEmpty,
  "too-long": copy.pages.rangeTooLong,
  syntax: copy.pages.rangeSyntax,
  reversed: copy.pages.rangeReversed,
  "out-of-range": copy.pages.rangeOutOfRange,
  "too-many": copy.pages.rangeTooMany,
};

/** The numbering choices, closed here so the `<select>`'s string value cannot become an invented format. */
function asNumbering(value: string): "none" | PageNumberFormat {
  return value === "plain" || value === "of-total" ? value : "none";
}

function asPosition(value: string): PageNumberPosition {
  return value === "bottom-right" ? "bottom-right" : "bottom-centre";
}

/** Narrows whatever an error object carried as a `reason` onto this module's two refusals. */
function refusalOf(reason: unknown): PdfRefusalReason {
  return reason === "encrypted" ? "encrypted" : "unreadable";
}

/** The sentence one file-level refusal is shown as. */
function problemText(reason: PdfRefusalReason): ModuleText {
  return reason === "encrypted" ? copy.files.encrypted : copy.files.unreadable;
}

/**
 * The PDF tool set.
 *
 * `files` is the module's file API (`window.nexus.modules.workshop`), taken as a
 * prop rather than read off `window` inside this component: the tool set is
 * wired into somebody else's page, and a prop is what says so in the type of the
 * thing being wired.
 */
export function PdfTools({ files }: { readonly files: WorkshopFilesApi }) {
  const [queue, setQueue] = useState<readonly QueuedPdf[]>([]);
  const [document, setDocument] = useState<WorkingPdf | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [rangeText, setRangeText] = useState("");
  const [rangeProblem, setRangeProblem] = useState<ModuleText | null>(null);
  const [numbering, setNumbering] = useState<"none" | PageNumberFormat>("none");
  const [position, setPosition] = useState<PageNumberPosition>("bottom-centre");
  const [splitMode, setSplitMode] = useState<"each" | "ranges">("each");

  /**
   * The worker, built on the first job. Held in a ref because it must outlive
   * every render (a job started in one render is awaited across several) and
   * must not be built at all for somebody who never clicks anything.
   */
  const runnerRef = useRef<PdfJobRunner | null>(null);
  const runner = useCallback((): PdfJobRunner => {
    runnerRef.current ??= createPdfWorker(spawnPdfWorker);
    return runnerRef.current;
  }, []);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  /** The progress callback one counted job reports through. */
  const progress = useCallback(
    (label: ModuleText) => (done: number, total: number) => setBusy({ label, done, total }),
    [],
  );

  /**
   * Runs one job with the page marked busy, and turns a refusal into the
   * sentence the page prints.
   *
   * `body` is a thunk rather than a promise, because a promise built by the
   * caller would already have started the job before the busy line appeared.
   * `counted` says whether the job reports steps: a job that does not shows its
   * label alone rather than an invented "0/1" the user would read as progress.
   */
  const runBusy = useCallback(
    async <T,>(label: ModuleText, counted: boolean, body: () => Promise<T>): Promise<T | null> => {
      setBusy({ label, done: counted ? 0 : null, total: counted ? 1 : null });
      setProblem(null);
      setNotice(null);
      try {
        return await body();
      } catch (failure) {
        setProblem(describe(failure));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // --- The file list ---------------------------------------------------------

  const addFiles = useCallback(async () => {
    const picked = await runBusy(copy.files.busyAdd, false, () => files.pickFiles({ kind: "pdf" }));
    if (picked === null) return;
    if (picked.canceled) {
      setNotice(text(copy.output.canceled));
      return;
    }

    // Every picked file is read once, here, so the list can say which ones are
    // usable before the user asks for anything: a queue that only discovered a
    // protected PDF at save time would waste the whole edit.
    const inspected = await runBusy(copy.files.busyAdd, false, async () => {
      const rows: QueuedPdf[] = [];
      for (const file of picked.files) {
        const source = { name: file.name, bytes: file.bytes };
        try {
          rows.push({ ...file, info: await runner().run("inspect", { source }), problem: null });
        } catch (failure) {
          rows.push({
            ...file,
            info: null,
            problem: failure instanceof Error && "reason" in failure ? refusalOf(failure.reason) : "unreadable",
          });
        }
      }
      return rows;
    });
    if (inspected === null) return;
    setQueue((current) => [...current, ...inspected]);
    const skipped = picked.skippedTooLarge + picked.skippedUnreadable;
    if (skipped > 0) setNotice(sentence(copy.files.skipped, { count: skipped }));
  }, [files, runBusy, runner]);

  /** Turns the whole file list, in its current order, into the working document. */
  const build = useCallback(
    async (rows: readonly QueuedPdf[]) => {
      const usable = rows.filter((row) => row.info !== null);
      const first = usable[0];
      if (first === undefined) return;
      const name = first.name;
      const built = await runBusy(copy.output.busy, true, async () => {
        const bytes =
          usable.length === 1
            ? first.bytes
            : await runner().run(
                "merge",
                { sources: usable.map((row) => ({ name: row.name, bytes: row.bytes })) },
                progress(copy.output.busy),
              );
        const info = await runner().run("inspect", { source: { name, bytes } });
        return { name, bytes, info } satisfies WorkingPdf;
      });
      if (built !== null) setDocument(built);
    },
    [progress, runBusy, runner],
  );

  // --- The page grid ---------------------------------------------------------

  const edit = useCallback(
    async (order: readonly number[]) => {
      if (document === null) return;
      const next = await runBusy(copy.pages.busyEdit, false, async () => {
        const bytes = await runner().run(
          "arrange",
          { source: { name: document.name, bytes: document.bytes }, order },
          progress(copy.output.busy),
        );
        const info = await runner().run("inspect", { source: { name: document.name, bytes } });
        return { name: document.name, bytes, info } satisfies WorkingPdf;
      });
      if (next !== null) setDocument(next);
    },
    [document, progress, runBusy, runner],
  );

  const rotate = useCallback(
    async (turns: readonly number[]) => {
      if (document === null) return;
      const next = await runBusy(copy.output.busy, true, async () => {
        const bytes = await runner().run(
          "rotate",
          { source: { name: document.name, bytes: document.bytes }, turns },
          progress(copy.output.busy),
        );
        const info = await runner().run("inspect", { source: { name: document.name, bytes } });
        return { name: document.name, bytes, info } satisfies WorkingPdf;
      });
      if (next !== null) setDocument(next);
    },
    [document, progress, runBusy, runner],
  );

  /** The pages the range field names, or `null` after setting the field's own error. */
  const readRange = useCallback((): readonly number[] | null => {
    if (document === null) return null;
    const parsed = parsePageRanges(rangeText, document.info.pageCount);
    if (!parsed.ok) {
      setRangeProblem(RANGE_PROBLEMS[parsed.reason]);
      return null;
    }
    setRangeProblem(null);
    return parsed.pages;
  }, [document, rangeText]);

  // --- The output ------------------------------------------------------------

  /** The bytes a write produces: the working document, numbered if the user asked for numbers. */
  const output = useCallback(async (): Promise<Uint8Array | null> => {
    if (document === null) return null;
    if (numbering === "none") return document.bytes;
    return await runBusy(copy.output.busy, true, () =>
      runner().run(
        "number",
        {
          source: { name: document.name, bytes: document.bytes },
          format: numbering,
          position,
        },
        progress(copy.output.busy),
      ),
    );
  }, [document, numbering, position, progress, runBusy, runner]);

  const save = useCallback(async () => {
    if (document === null) return;
    const bytes = await output();
    if (bytes === null) return;
    const result = await runBusy(copy.output.busySave, false, () =>
      files.saveFile({ suggestedName: document.name, bytes }),
    );
    if (result === null) return;
    if (result.canceled) setNotice(text(copy.output.canceled));
    else setNotice(sentence(copy.output.savedOne, { name: result.savedName ?? document.name }));
  }, [document, files, output, runBusy]);

  const split = useCallback(async () => {
    if (document === null) return;
    // The parts are computed against the working document, which is what the
    // tiles show - and a range the user typed is refused BEFORE any bytes are
    // written, so a typo costs a sentence rather than a folder of odd files.
    let parts: readonly (readonly number[])[];
    if (splitMode === "each") {
      parts = pageOrder(document.info.pageCount).map((index) => [index + 1]);
    } else {
      const pages = readRange();
      if (pages === null) return;
      parts = groupParts(pages);
    }
    const bytes = await output();
    if (bytes === null) return;
    const produced = await runBusy(copy.output.busy, true, () =>
      runner().run("split", { source: { name: document.name, bytes }, parts }, progress(copy.output.busy)),
    );
    if (produced === null) return;
    const result = await runBusy(copy.output.busySave, false, () =>
      files.saveBatch({ files: produced.map((file) => ({ name: file.name, bytes: file.bytes })) }),
    );
    if (result === null) return;
    if (result.canceled) setNotice(text(copy.output.canceled));
    else {
      setNotice(
        sentence(copy.output.savedBatch, {
          folder: result.folderName ?? "",
          count: fileCount(result.writtenNames.length),
        }),
      );
    }
  }, [document, files, output, progress, readRange, runBusy, runner, splitMode]);

  const pages = document?.info.pages ?? [];
  const usable = queue.some((row) => row.info !== null);

  return (
    <div className="pdf-tools">
      <Card className="pdf-tools__card" title={text(copy.files.title)}>
        <div className="pdf-tools__row">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void addFiles()}>
            {text(copy.files.add)}
          </Button>
          <Button size="sm" disabled={busy !== null || !usable} onClick={() => void build(queue)}>
            {text(copy.files.rebuild)}
          </Button>
        </div>
        <p className="nx-hint">{text(copy.files.addHint)}</p>
        {queue.length === 0 ? (
          <EmptyState
            variant="inline"
            title={text(copy.files.empty)}
            description={text(copy.files.rebuildHint)}
          />
        ) : (
          <div className="pdf-tools__queue">
            {queue.map((row, index) => (
              <div className="pdf-tools__queue-row" key={`${row.name}-${index}`}>
                <span className="pdf-tools__name">{row.name}</span>
                <span className="pdf-tools__meta">{formatFileSize(row.bytes.byteLength)}</span>
                {row.info !== null && <span className="pdf-tools__meta">{pageCount(row.info.pageCount)}</span>}
                {row.problem !== null && (
                  <span className="pdf-tools__problem">{text(problemText(row.problem))}</span>
                )}
                <Button
                  size="sm"
                  aria-label={text(copy.files.moveUp)}
                  disabled={busy !== null || index === 0}
                  onClick={() => setQueue((current) => moveRow(current, index, index - 1))}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  aria-label={text(copy.files.moveDown)}
                  disabled={busy !== null || index === queue.length - 1}
                  onClick={() => setQueue((current) => moveRow(current, index, index + 1))}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy !== null}
                  onClick={() => setQueue((current) => current.filter((_, at) => at !== index))}
                >
                  {text(copy.files.remove)}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="pdf-tools__card" title={text(copy.pages.title)}>
        {document === null ? (
          <p className="nx-hint">{text(copy.pages.empty)}</p>
        ) : (
          <>
            <div className="pdf-tools__row">
              <span className="pdf-tools__meta">
                {sentence(copy.pages.count, { pages: pageCount(document.info.pageCount) })}
              </span>
              <span className="pdf-tools__meta">
                {sentence(copy.pages.total, { size: formatFileSize(document.bytes.byteLength) })}
              </span>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void rotate(pages.map(() => QUARTER_TURN_DEGREES))}
              >
                {text(copy.pages.rotateAll)}
              </Button>
            </div>
            <div className="pdf-tools__row">
              <TextField
                className="pdf-tools__field"
                label={text(copy.pages.range)}
                value={rangeText}
                onChange={(event) => setRangeText(event.target.value)}
              />
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  const selected = readRange();
                  if (selected === null) return;
                  void edit(selected.map((page) => page - 1));
                }}
              >
                {text(copy.pages.keep)}
              </Button>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  // The doomed pages are 1-based in the expression and 0-based
                  // in the order, and this is the one place the two meet.
                  const selected = readRange();
                  if (selected === null) return;
                  const doomed = new Set(selected);
                  const kept = pageOrder(pages.length).filter((index) => !doomed.has(index + 1));
                  if (kept.length === 0) {
                    setRangeProblem(RANGE_PROBLEMS["out-of-range"]);
                    return;
                  }
                  void edit(kept);
                }}
              >
                {text(copy.pages.removeRange)}
              </Button>
            </div>
            <p className="nx-hint">{text(copy.pages.rangeHint)}</p>
            {rangeProblem !== null && <p className="pdf-tools__problem">{text(rangeProblem)}</p>}
            <div className="pdf-tools__tiles">
              {pages.map((page, index) => (
                <div className="pdf-tools__tile" key={`${index}-${Math.round(page.width)}-${page.rotation}`}>
                  <div
                    className={`pdf-tools__frame${page.width > page.height ? " pdf-tools__frame--landscape" : ""}${
                      page.rotation === 0 ? "" : ` pdf-tools__frame--turn-${page.rotation}`
                    }`}
                  >
                    <span className="pdf-tools__page-number">{index + 1}</span>
                  </div>
                  <span className="pdf-tools__tile-size">
                    {Math.round(page.width)}×{Math.round(page.height)}
                  </span>
                  <div className="pdf-tools__tile-actions">
                    <Button
                      size="sm"
                      aria-label={text(copy.pages.moveLeft)}
                      disabled={busy !== null || index === 0}
                      onClick={() =>
                        void edit(moveOrderEntry(pageOrder(pages.length), index, index - 1))
                      }
                    >
                      ‹
                    </Button>
                    <Button
                      size="sm"
                      aria-label={text(copy.pages.moveRight)}
                      disabled={busy !== null || index === pages.length - 1}
                      onClick={() =>
                        void edit(moveOrderEntry(pageOrder(pages.length), index, index + 1))
                      }
                    >
                      ›
                    </Button>
                    <Button
                      size="sm"
                      aria-label={text(copy.pages.rotate)}
                      disabled={busy !== null}
                      onClick={() => {
                        const turns = pages.map(() => 0);
                        turns[index] = QUARTER_TURN_DEGREES;
                        void rotate(turns);
                      }}
                    >
                      ↻
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={text(copy.pages.remove)}
                      disabled={busy !== null}
                      onClick={() => void edit(removeOrderEntry(pageOrder(pages.length), index))}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="pdf-tools__card" title={text(copy.output.title)}>
        <div className="pdf-tools__row">
          <Select
            className="pdf-tools__field"
            label={text(copy.output.numbers)}
            value={numbering}
            onChange={(event) => setNumbering(asNumbering(event.target.value))}
          >
            <option value="none">{text(copy.output.numbersNone)}</option>
            <option value="plain">{text(copy.output.numbersPlain)}</option>
            <option value="of-total">{text(copy.output.numbersOfTotal)}</option>
          </Select>
          <Select
            className="pdf-tools__field"
            label={text(copy.output.position)}
            value={position}
            onChange={(event) => setPosition(asPosition(event.target.value))}
          >
            <option value="bottom-centre">{text(copy.output.bottomCentre)}</option>
            <option value="bottom-right">{text(copy.output.bottomRight)}</option>
          </Select>
        </div>
        <div className="pdf-tools__row">
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null || document === null}
            onClick={() => void save()}
          >
            {text(copy.output.save)}
          </Button>
          <Select
            className="pdf-tools__field"
            label={text(copy.output.splitTitle)}
            value={splitMode}
            onChange={(event) => setSplitMode(event.target.value === "ranges" ? "ranges" : "each")}
          >
            <option value="each">{text(copy.output.splitEach)}</option>
            <option value="ranges">{text(copy.output.splitRanges)}</option>
          </Select>
          <Button size="sm" disabled={busy !== null || document === null} onClick={() => void split()}>
            {text(copy.output.splitRun)}
          </Button>
        </div>
        {busy !== null && (
          <p className="nx-hint" role="status">
            {busy.done === null || busy.total === null
              ? text(busy.label)
              : sentence(busy.label, { done: busy.done, total: busy.total })}
          </p>
        )}
        {notice !== null && <p className="pdf-tools__notice">{notice}</p>}
        {problem !== null && <p className="pdf-tools__problem">{problem}</p>}
      </Card>
    </div>
  );
}

/** A refusal that crossed the worker boundary, or the failure's own message. */
function describe(failure: unknown): string {
  if (failure instanceof Error) {
    if ("reason" in failure && refusalOf(failure.reason) === "encrypted") {
      return text(copy.files.encrypted);
    }
    return sentence(copy.output.failed, { message: failure.message });
  }
  return sentence(copy.output.failed, { message: String(failure) });
}

/** The file list with one row moved, as `moveOrderEntry` does for pages. */
function moveRow(queue: readonly QueuedPdf[], from: number, to: number): readonly QueuedPdf[] {
  if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return queue;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return queue;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The pages an expression names as the parts a split writes, one per comma
 * piece: a part is a run of consecutive pages, because that is what the grammar
 * and a person both mean by `1-3,5,8-`.
 */
function groupParts(pages: readonly number[]): readonly (readonly number[])[] {
  const parts: number[][] = [];
  for (const page of pages) {
    const current = parts[parts.length - 1];
    const previous = current?.[current.length - 1];
    if (current === undefined || previous === undefined || page !== previous + 1) {
      parts.push([page]);
      continue;
    }
    current.push(page);
  }
  return parts;
}
