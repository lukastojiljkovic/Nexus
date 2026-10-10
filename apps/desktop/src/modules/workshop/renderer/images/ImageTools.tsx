import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseScaleNumber,
  RESIZE_BOX_MAX_PX,
  RESIZE_BOX_MIN_PX,
  RESIZE_PERCENT_MAX,
  RESIZE_PERCENT_MIN,
  type ImageExifSummary,
  type ModuleText,
} from "@nexus/core";
import { Button, Card, EmptyState, Select, TextField } from "@nexus/ui";
import { formatFileSize } from "../../../../renderer/src/fileRows.js";
import type { WorkshopFilesApi } from "../../shared/workshopFiles.js";
import type { ImageInfo, ProcessedImage } from "./operations.js";
import {
  IMAGE_QUALITY_MAX,
  IMAGE_QUALITY_MIN,
  needsReencode,
  type ImageOutputFormat,
  type ImagePlan,
} from "./plan.js";
import { createImageWorker, spawnImageWorker, type ImageJobRunner } from "./workerClient.js";
import { copy, imageCount, sentence, text } from "./text.js";
import "./imageTools.css";

/**
 * The WORKSHOP module's image tool set (ADR-090): resize, convert and drop
 * metadata, many files at once, in a worker.
 *
 * **What it tells the user before it does anything.** Re-encoding through a
 * canvas has no metadata channel, so a converted or resized file loses its EXIF
 * block — GPS, camera and date — and this page lists what each file HAS, read out
 * of the file's own bytes by the small EXIF reader in `@nexus/core`, and says
 * beside it whether the current plan will re-encode it or copy it. The one case
 * that keeps everything is a plan that changes nothing, where the file is copied
 * byte for byte; `plan.ts` is that line, and it is drawn before the button is
 * pressed rather than promised after.
 *
 * **Why a batch is read one file per job.** A worker job that threw on the first
 * unreadable file would lose the other nineteen with it. Each image is inspected
 * on its own, so a HEIC in a folder of JPEGs becomes one row saying so.
 *
 * **Why the numbers are validated before the worker sees them.** Percentages and
 * box sides are typed by hand; each is read with `parseScaleNumber` and bounded
 * by the same constants the coordinator uses, so a typo produces a sentence
 * beside the field rather than a batch that failed halfway.
 */

/** What the page holds about one picked image. */
interface PickedImage {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** What the worker made of it, or `null` with `problem` saying why. */
  readonly info: ImageInfo | null;
  readonly problem: ModuleText | null;
}

interface Busy {
  readonly label: ModuleText;
  readonly done: number | null;
  readonly total: number | null;
}

/** The refusal reasons this tool can meet, as the sentences it words them with. */
function refusalText(reason: unknown): ModuleText {
  if (reason === "unsupported") return copy.files.unsupported;
  if (reason === "too-large") return copy.run.tooLarge;
  return copy.files.unreadable;
}

/** The reason an error carried across the worker boundary, or the empty string. */
function reasonOf(failure: unknown): unknown {
  return failure instanceof Error && "reason" in failure ? failure.reason : "";
}

function asFormat(value: string): ImageOutputFormat {
  return value === "png" || value === "jpeg" || value === "webp" ? value : "keep";
}

function asResize(value: string): ImagePlan["resize"]["kind"] {
  return value === "percent" || value === "box" ? value : "none";
}

/**
 * The image tool set.
 *
 * `files` is the module's file API, taken as a prop (see `PdfTools`).
 */
export function ImageTools({ files }: { readonly files: WorkshopFilesApi }) {
  const [picked, setPicked] = useState<readonly PickedImage[]>([]);
  const [results, setResults] = useState<readonly ProcessedImage[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [resizeKind, setResizeKind] = useState<ImagePlan["resize"]["kind"]>("none");
  const [percentText, setPercentText] = useState("100");
  const [widthText, setWidthText] = useState("1920");
  const [heightText, setHeightText] = useState("1080");
  const [format, setFormat] = useState<ImageOutputFormat>("keep");
  const [qualityText, setQualityText] = useState(String(IMAGE_QUALITY_MAX));
  const [planProblem, setPlanProblem] = useState<ModuleText | null>(null);

  const runnerRef = useRef<ImageJobRunner | null>(null);
  const runner = useCallback((): ImageJobRunner => {
    runnerRef.current ??= createImageWorker(spawnImageWorker);
    return runnerRef.current;
  }, []);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  const progress = useCallback(
    (label: ModuleText) => (done: number, total: number) => setBusy({ label, done, total }),
    [],
  );

  const runBusy = useCallback(
    async <T,>(label: ModuleText, counted: boolean, body: () => Promise<T>): Promise<T | null> => {
      setBusy({ label, done: counted ? 0 : null, total: counted ? 1 : null });
      setProblem(null);
      setNotice(null);
      try {
        return await body();
      } catch (failure) {
        const reason = reasonOf(failure);
        setProblem(
          reason === ""
            ? sentence(copy.run.failed, {
                message: failure instanceof Error ? failure.message : String(failure),
              })
            : text(refusalText(reason)),
        );
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const addFiles = useCallback(async () => {
    const chosen = await runBusy(copy.files.busyAdd, false, () => files.pickFiles({ kind: "image" }));
    if (chosen === null) return;
    if (chosen.canceled) {
      setNotice(text(copy.run.canceled));
      return;
    }
    const rows: PickedImage[] = [];
    for (const [index, file] of chosen.files.entries()) {
      const source = { name: file.name, bytes: file.bytes };
      try {
        const infos = await runner().run("inspect", { files: [source] }, (at) =>
          setBusy({ label: copy.files.busyAdd, done: index + at, total: chosen.files.length }),
        );
        rows.push({ ...file, info: infos[0] ?? null, problem: infos[0] === undefined ? copy.files.unreadable : null });
      } catch (failure) {
        rows.push({ ...file, info: null, problem: refusalText(reasonOf(failure)) });
      }
    }
    setBusy(null);
    setResults([]);
    setPicked((current) => [...current, ...rows]);
  }, [files, runBusy, runner]);

  /**
   * The plan the batch runs with, or the sentence naming the field that is wrong.
   *
   * Pure, so the render below can ask "what would this plan do to these files?"
   * without writing any state. `keep` for the format is not a resize of any
   * kind: it means the output is whatever the file already was, which is what
   * makes "no change at all" a plan the user can express — and the case that
   * keeps the metadata.
   */
  const buildPlan = useCallback((): { readonly plan: ImagePlan } | { readonly problem: ModuleText } => {
    const percent = parseScaleNumber(percentText, RESIZE_PERCENT_MIN, RESIZE_PERCENT_MAX);
    const width = parseScaleNumber(widthText, RESIZE_BOX_MIN_PX, RESIZE_BOX_MAX_PX);
    const height = parseScaleNumber(heightText, RESIZE_BOX_MIN_PX, RESIZE_BOX_MAX_PX);
    const quality = parseScaleNumber(qualityText, IMAGE_QUALITY_MIN, IMAGE_QUALITY_MAX);

    let resize: ImagePlan["resize"] = { kind: "none" };
    if (resizeKind === "percent") {
      if (percent === null) return { problem: copy.plan.percentProblem };
      resize = { kind: "percent", percent };
    } else if (resizeKind === "box") {
      if (width === null || height === null) return { problem: copy.plan.boxProblem };
      resize = { kind: "box", width, height };
    }
    if (quality === null) return { problem: copy.plan.qualityProblem };
    return { plan: { resize, format, quality } };
  }, [format, heightText, percentText, qualityText, resizeKind, widthText]);

  const process = useCallback(async () => {
    const built = buildPlan();
    if ("problem" in built) {
      setPlanProblem(built.problem);
      return;
    }
    setPlanProblem(null);
    const usable = picked.filter((row) => row.info !== null);
    if (usable.length === 0) return;
    const processed = await runBusy(copy.run.busy, true, () =>
      runner().run(
        "process",
        {
          plan: built.plan,
          files: usable.map((row) => ({ name: row.name, bytes: row.bytes })),
        },
        progress(copy.run.busy),
      ),
    );
    if (processed !== null) setResults(processed);
  }, [buildPlan, picked, progress, runBusy, runner]);

  const save = useCallback(async () => {
    const first = results[0];
    if (first === undefined) return;
    const result = await runBusy(copy.run.save, false, async () => {
      // One file is a save dialog (the user names it); several are a folder,
      // because twenty dialogs is not a workflow. The file API decides which of
      // its two answers this was, and the two shapes are told apart below.
      if (results.length === 1) return await files.saveFile({ suggestedName: first.name, bytes: first.bytes });
      return await files.saveBatch({
        files: results.map((file) => ({ name: file.name, bytes: file.bytes })),
      });
    });
    if (result === null) return;
    if (result.canceled) {
      setNotice(text(copy.run.canceled));
      return;
    }
    if ("savedName" in result) {
      setNotice(sentence(copy.run.savedOne, { name: result.savedName ?? first.name }));
      return;
    }
    setNotice(
      sentence(copy.run.savedBatch, {
        folder: result.folderName ?? "",
        count: imageCount(result.writtenNames.length),
      }),
    );
  }, [files, results, runBusy]);

  // What the fields currently say, for the per-file line below: the same plan
  // the button will send, so the page never predicts something else.
  const preview = buildPlan();

  return (
    <div className="image-tools">
      <Card className="image-tools__card" title={text(copy.files.title)}>
        <div className="image-tools__row">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void addFiles()}>
            {text(copy.files.add)}
          </Button>
        </div>
        <p className="nx-hint">{text(copy.files.addHint)}</p>
        {picked.length === 0 ? (
          <EmptyState variant="inline" title={text(copy.files.empty)} description={text(copy.files.keepsExif)} />
        ) : (
          <div className="image-tools__list">
            {picked.map((row, index) => (
              <div className="image-tools__row-item" key={`${row.name}-${index}`}>
                <span className="image-tools__name">{row.name}</span>
                <span className="image-tools__meta">{formatFileSize(row.bytes.byteLength)}</span>
                {row.info !== null && (
                  <>
                    <span className="image-tools__meta">
                      {row.info.width}×{row.info.height}
                    </span>
                    <span className="image-tools__meta">{metadataLine(row.info.exif)}</span>
                    <span className="image-tools__meta">
                      {text(
                        "plan" in preview &&
                          needsReencode(
                            preview.plan,
                            { width: row.info.width, height: row.info.height },
                            row.info.format,
                          )
                          ? copy.run.reencoded
                          : copy.run.copied,
                      )}
                    </span>
                  </>
                )}
                {row.problem !== null && <span className="image-tools__problem">{text(row.problem)}</span>}
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy !== null}
                  onClick={() => setPicked((current) => current.filter((_, at) => at !== index))}
                >
                  {text(copy.files.remove)}
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="nx-hint">{text(copy.files.dropsExif)}</p>
        <p className="nx-hint">{text(copy.files.keepsExif)}</p>
      </Card>

      <Card className="image-tools__card" title={text(copy.plan.title)}>
        <div className="image-tools__row">
          <Select
            className="image-tools__select"
            label={text(copy.plan.resize)}
            value={resizeKind}
            onChange={(event) => setResizeKind(asResize(event.target.value))}
          >
            <option value="none">{text(copy.plan.resizeNone)}</option>
            <option value="percent">{text(copy.plan.resizePercent)}</option>
            <option value="box">{text(copy.plan.resizeBox)}</option>
          </Select>
          {resizeKind === "percent" && (
            <TextField
              className="image-tools__field"
              label={text(copy.plan.percent)}
              inputMode="numeric"
              value={percentText}
              onChange={(event) => setPercentText(event.target.value)}
            />
          )}
          {resizeKind === "box" && (
            <>
              <TextField
                className="image-tools__field"
                label={text(copy.plan.boxWidth)}
                inputMode="numeric"
                value={widthText}
                onChange={(event) => setWidthText(event.target.value)}
              />
              <TextField
                className="image-tools__field"
                label={text(copy.plan.boxHeight)}
                inputMode="numeric"
                value={heightText}
                onChange={(event) => setHeightText(event.target.value)}
              />
            </>
          )}
        </div>
        <div className="image-tools__row">
          <Select
            className="image-tools__select"
            label={text(copy.plan.format)}
            value={format}
            onChange={(event) => setFormat(asFormat(event.target.value))}
          >
            <option value="keep">{text(copy.plan.formatKeep)}</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </Select>
          <TextField
            className="image-tools__field"
            label={text(copy.plan.quality)}
            inputMode="numeric"
            value={qualityText}
            onChange={(event) => setQualityText(event.target.value)}
          />
        </div>
        {resizeKind === "box" && <p className="nx-hint">{text(copy.plan.boxHint)}</p>}
        <p className="nx-hint">{text(copy.plan.qualityHint)}</p>
        {planProblem !== null && <p className="image-tools__problem">{text(planProblem)}</p>}
        <div className="image-tools__row">
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null || !picked.some((row) => row.info !== null)}
            onClick={() => void process()}
          >
            {text(copy.run.process)}
          </Button>
        </div>
      </Card>

      <Card className="image-tools__card" title={text(copy.run.title)}>
        {busy !== null && (
          <p className="nx-hint" role="status">
            {busy.done === null || busy.total === null
              ? text(busy.label)
              : sentence(busy.label, { done: busy.done, total: busy.total })}
          </p>
        )}
        {results.length === 0 ? (
          <p className="nx-hint">{text(copy.run.empty)}</p>
        ) : (
          <div className="image-tools__list">
            {results.map((file) => (
              <div className="image-tools__row-item" key={file.name}>
                <span className="image-tools__name">{file.name}</span>
                <span className="image-tools__meta">
                  {file.width}×{file.height}
                </span>
                <span className="image-tools__meta">{formatFileSize(file.bytes.byteLength)}</span>
                <span className="image-tools__meta">
                  {text(file.reencoded ? copy.run.reencoded : copy.run.copied)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="image-tools__row">
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null || results.length === 0}
            onClick={() => void save()}
          >
            {text(copy.run.save)}
          </Button>
        </div>
        {notice !== null && <p className="image-tools__notice">{notice}</p>}
        {problem !== null && <p className="image-tools__problem">{problem}</p>}
      </Card>
    </div>
  );
}

/**
 * What one file's EXIF block says, in one line: the three things a re-encode is
 * about to drop.
 *
 * Read from the file's own bytes by `@nexus/core`'s reader — never from a claim
 * the file makes about itself — so a file with no block says so rather than
 * showing blanks that could be read as "there was nothing to lose".
 */
function metadataLine(exif: ImageExifSummary): string {
  if (!exif.hasExif) return text(copy.files.noExif);
  const parts = [text(exif.hasGps ? copy.files.gpsYes : copy.files.gpsNo)];
  if (exif.camera !== null) parts.push(sentence(copy.files.camera, { camera: exif.camera }));
  if (exif.dateTime !== null) parts.push(sentence(copy.files.date, { date: exif.dateTime }));
  return parts.join(" · ");
}
