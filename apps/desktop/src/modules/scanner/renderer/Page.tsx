import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  TextField,
} from "@nexus/ui";
import { numberFormat } from "../../../renderer/src/intl.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import {
  canvasFromPixels,
  pixelsFromBlob,
  pixelsFromCanvas,
  canvasFromSource,
} from "./canvasImage.js";
import {
  composeSelection,
  cropTo,
  prepareForOcr,
  rotateQuarterTurns,
  selectionRect,
  type RgbaImage,
  type SelectionPercent,
} from "./imageOps.js";
import { TESSDATA_PACK_ID, type OcrLanguage } from "./ocrConfig.js";
import { scanPhase, type ScanOutcome } from "./ocrResult.js";
import { createScanSession } from "./ocrSession.js";
import "./scanner.css";

/**
 * SKENER (ADR-090) - text from a photograph, a paste or the camera, read on
 * this machine.
 *
 * **The page keeps nothing.** There is no list of past scans, no history and no
 * table behind this page: a scan is an act, and its two outcomes are the
 * clipboard and a note the user asked for. That is why the module has exactly
 * one op (`saveAsNote`) and no dashboard card - a "recent scans" list would be
 * a second, worse copy of the notes module's own list.
 *
 * **Where the picture comes from, and why the page reads it itself.** A file
 * the user picks, a paste, or one frame from the camera. All three arrive as
 * browser objects (`File`, `ClipboardEvent.dataTransfer`, `MediaStream`), which
 * is what makes them the renderer's business: nothing crosses the IPC bridge on
 * the way IN, so there is no path from the renderer to an arbitrary file, and
 * the permission the camera needs is asked for by the page and granted by main
 * only for this app's own origin (`main/scannerMedia.ts`).
 *
 * **Where the arithmetic is.** Nothing on this page decides a pixel: rotate,
 * crop, the contrast step and the selection composition are all in
 * `imageOps.ts`, pure and tested there, and this page only decides WHICH of them
 * the user is asking for. The recognition runs in a Web Worker the session in
 * `ocrSession.ts` owns, so the seconds it takes are never spent on the UI
 * thread - this page draws a progress bar while it waits.
 *
 * **What the note gets, and what it does not.** The text, exactly as read (the
 * low-confidence marks are the page's, not the note's). The picture, if the
 * user asks for it, is the FRAMED photograph - rotated and cropped the way the
 * user framed it, not the binarised copy the engine read, because the threshold
 * is a reading aid and a note should keep the photograph.
 */

/** The selection that means "the whole picture", in percentages. */
const WHOLE_CROP: SelectionPercent = { left: 0, top: 0, width: 100, height: 100 };

/** The three tessdata models, and the copy key each one's name lives under. */
const LANGUAGE_ROWS: readonly { readonly code: OcrLanguage; readonly copyKey: "latin" | "cyrillic" | "english" }[] = [
  { code: "srp_latn", copyKey: "latin" },
  { code: "srp", copyKey: "cyrillic" },
  { code: "eng", copyKey: "english" },
];

/** What the page knows about the language pack: still asking, installed, not installed, or unreadable. */
type PackState = "checking" | "ready" | "missing" | "unknown";

export default function ScannerPage({ profileId }: ModulePageProps) {
  /** The picture as loaded, before any edit. */
  const [source, setSource] = useState<RgbaImage | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  /** The crop in percentages OF THE ROTATED PICTURE; the two sources of it are the drag and the four fields. */
  const [crop, setCrop] = useState<SelectionPercent>(WHOLE_CROP);
  /**
   * The rectangle being dragged right now, in percentages of the crop that is
   * ALREADY applied - or null when nothing is being dragged.
   *
   * Kept apart from `crop` on purpose. The preview is derived from `crop`, so a
   * drag that wrote straight into it would redraw the very picture the drag is
   * measuring: the pointer would be chasing a canvas that shrinks under it, and
   * every move after the first would be computed against a different box. The
   * in-progress rectangle is an overlay instead, and the crop changes once, on
   * release.
   */
  const [dragRect, setDragRect] = useState<SelectionPercent | null>(null);
  /** The four fields as typed, so a half-typed number is not rounded under the caret. */
  const [cropText, setCropText] = useState({ left: "0", top: "0", width: "100", height: "100" });
  const [threshold, setThreshold] = useState(true);
  const [languages, setLanguages] = useState<readonly OcrLanguage[]>(["srp_latn", "eng"]);
  const [pack, setPack] = useState<PackState>("checking");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ status: string; progress: number } | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [failure, setFailure] = useState<"read" | "copy" | "save" | "attach" | null>(null);
  const [copied, setCopied] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [attachImage, setAttachImage] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraFailure, setCameraFailure] = useState<"denied" | "unavailable" | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  /** The crop applied when the current drag began: the frame an inner rectangle is relative to. */
  const dragBase = useRef<SelectionPercent | null>(null);
  const session = useRef<ReturnType<typeof createScanSession> | null>(null);

  /**
   * The rotated and cropped picture - what the user framed, and what travels
   * with the note when they ask for the picture too.
   */
  const framed = useMemo<RgbaImage | null>(() => {
    if (source === null) return null;
    const turned = rotateQuarterTurns(source, rotation);
    const rect = selectionRect(turned, crop);
    if (rect.x === 0 && rect.y === 0 && rect.width === turned.width && rect.height === turned.height) {
      return turned;
    }
    return cropTo(turned, rect);
  }, [source, rotation, crop]);

  /** What the engine reads and the preview draws: the framed picture, binarised when the contrast step is on. */
  const prepared = useMemo<RgbaImage | null>(
    () => (framed === null || !threshold ? framed : prepareForOcr(framed)),
    [framed, threshold],
  );

  // --- The pack, and the session's lifetime ----------------------------------

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const packs = await window.nexus.packsList();
        if (active) setPack(packs.some((entry) => entry.id === TESSDATA_PACK_ID) ? "ready" : "missing");
      } catch (error) {
        if (active) setPack("unknown");
        console.error("Nexus: the installed packs could not be listed:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      const active = session.current;
      session.current = null;
      void active?.dispose();
    },
    [],
  );

  // --- The picture -----------------------------------------------------------

  const loadBlob = useCallback(async (blob: Blob): Promise<void> => {
    try {
      setSource(await pixelsFromBlob(blob));
      setSourceFailed(false);
      setRotation(0);
      setCrop(WHOLE_CROP);
      setCropText({ left: "0", top: "0", width: "100", height: "100" });
      setOutcome(null);
      setSavedTitle(null);
      setFailure(null);
    } catch (error) {
      setSourceFailed(true);
      setSource(null);
      console.error("Nexus: a picture for the scanner could not be read:", error);
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const item = [...(event.clipboardData?.items ?? [])].find((entry) =>
        entry.type.startsWith("image/"),
      );
      const file = item?.getAsFile() ?? null;
      if (file === null) return;
      // Only an image is taken, and only when there is one: text pasted into the
      // title field keeps whatever the browser would have done with it.
      event.preventDefault();
      void loadBlob(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadBlob]);

  // --- The camera ------------------------------------------------------------

  const stopCamera = useCallback((): void => {
    setCamera((current) => {
      for (const track of current?.getTracks() ?? []) track.stop();
      return null;
    });
  }, []);

  useEffect(
    () => () => {
      for (const track of camera?.getTracks() ?? []) track.stop();
    },
    [camera],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || camera === null) return;
    video.srcObject = camera;
    void video.play().catch(() => undefined);
  }, [camera]);

  async function startCamera(): Promise<void> {
    setCameraFailure(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setCamera(stream);
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setCameraFailure(denied ? "denied" : "unavailable");
      console.error("Nexus: the scanner could not open the camera:", error);
    }
  }

  function captureFrame(): void {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return;
    const pixels = pixelsFromCanvas(canvasFromSource(video, video.videoWidth, video.videoHeight));
    setSource(pixels);
    setSourceFailed(false);
    setRotation(0);
    setCrop(WHOLE_CROP);
    setCropText({ left: "0", top: "0", width: "100", height: "100" });
    setOutcome(null);
    setSavedTitle(null);
    setFailure(null);
    stopCamera();
  }

  // --- The preview -----------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || prepared === null) return;
    canvas.width = prepared.width;
    canvas.height = prepared.height;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(prepared.data), prepared.width, prepared.height),
      0,
      0,
    );
  }, [prepared]);

  // --- The crop --------------------------------------------------------------

  function applyCrop(next: SelectionPercent): void {
    setCrop(next);
    setCropText({
      left: String(Math.round(next.left)),
      top: String(Math.round(next.top)),
      width: String(Math.round(next.width)),
      height: String(Math.round(next.height)),
    });
  }

  function pointerPercent(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clampPercent(((event.clientX - box.left) / Math.max(box.width, 1)) * 100),
      y: clampPercent(((event.clientY - box.top) / Math.max(box.height, 1)) * 100),
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (prepared === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPercent(event);
    dragStart.current = point;
    dragBase.current = crop;
    setDragRect({ left: point.x, top: point.y, width: 0, height: 0 });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const start = dragStart.current;
    if (start === null) return;
    const point = pointerPercent(event);
    // The box is normalised, so a drag in any direction is the same rectangle.
    setDragRect({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function onPointerUp(): void {
    const base = dragBase.current;
    const rect = dragRect;
    dragStart.current = null;
    dragBase.current = null;
    setDragRect(null);
    // A tap - a press with no drag - is not a selection: it would be a
    // rectangle of no pixels, which is not a crop anybody asked for.
    if (base === null || rect === null || rect.width < 1 || rect.height < 1) return;
    applyCrop(composeSelection(base, rect));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dragStart.current !== null) {
        // Letting go of the rectangle being drawn: the crop it was drawn over,
        // and the picture, stay exactly as they were.
        dragStart.current = null;
        dragBase.current = null;
        setDragRect(null);
        return;
      }
      if (camera !== null) {
        stopCamera();
        return;
      }
      applyCrop(WHOLE_CROP);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `applyCrop` writes state only, so it needs no dependency of its own.
  }, [camera, stopCamera]);

  // --- Reading ---------------------------------------------------------------

  async function readText(): Promise<void> {
    if (prepared === null || languages.length === 0) return;
    setBusy(true);
    setFailure(null);
    setOutcome(null);
    setSavedTitle(null);
    setCopied(false);
    setProgress({ status: "initializing tesseract", progress: 0 });
    try {
      session.current ??= createScanSession();
      setOutcome(await session.current.recognize(prepared, languages, setProgress));
    } catch (error) {
      setFailure("read");
      console.error("Nexus: the scan could not be recognised:", error);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // --- The two outcomes ------------------------------------------------------

  async function copyText(): Promise<void> {
    if (outcome === null) return;
    try {
      await navigator.clipboard.writeText(outcome.text);
      setCopied(true);
      setFailure(null);
    } catch (error) {
      setFailure("copy");
      console.error("Nexus: the scanned text could not be copied:", error);
    }
  }

  async function saveAsNote(): Promise<void> {
    if (outcome === null || outcome.text.length === 0) return;
    setFailure(null);
    setSavedTitle(null);
    try {
      const note = await window.nexus.modules.scanner.saveAsNote({
        profileId,
        text: outcome.text,
        title: noteTitle,
      });
      if (attachImage && framed !== null) {
        try {
          await window.nexus.attachNoteFile(
            profileId,
            note.noteId,
            attachmentName(),
            await pngBytes(framed),
          );
        } catch (error) {
          setFailure("attach");
          console.error("Nexus: the scanned picture could not be attached:", error);
          return;
        }
      }
      setSavedTitle(note.title);
    } catch (error) {
      setFailure("save");
      console.error("Nexus: the scanned text could not be saved as a note:", error);
    }
  }

  // --- The page --------------------------------------------------------------

  const reading = progress !== null;

  return (
    <div className="scanner">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="scan"
      />
      {failure !== null && (
        <p className="scanner__error" role="alert">
          {failure === "read" && copy.read.readError}
          {failure === "copy" && copy.result.copyError}
          {failure === "save" && copy.result.saveError}
          {failure === "attach" && copy.result.attachError}
        </p>
      )}

      <Card className="scanner__card" title={copy.source.title}>
        <div className="scanner__row">
          <label className="scanner__file">
            <span className="scanner__file-name">{copy.source.file}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={copy.source.file}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void loadBlob(file);
                // The same file may be picked twice in a row; without this the
                // second pick fires no change event at all.
                event.target.value = "";
              }}
            />
          </label>
          {camera === null ? (
            <Button size="sm" onClick={() => void startCamera()}>
              {copy.source.camera}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={captureFrame}>
                {copy.source.capture}
              </Button>
              <Button size="sm" variant="quiet" onClick={stopCamera}>
                {copy.source.stopCamera}
              </Button>
            </>
          )}
        </div>
        <p className="nx-hint">{copy.source.fileHint}</p>
        <p className="nx-hint">{copy.source.cameraHint}</p>
        <p className="nx-hint">{copy.source.pasteHint}</p>
        {cameraFailure !== null && (
          <p className="scanner__error" role="alert">
            {cameraFailure === "denied" ? copy.source.cameraDenied : copy.source.cameraError}
          </p>
        )}
        {sourceFailed && (
          <p className="scanner__error" role="alert">
            {copy.source.decodeError}
          </p>
        )}
        {camera !== null && (
          <video
            ref={videoRef}
            className="scanner__camera"
            muted
            playsInline
            aria-label={copy.source.camera}
          />
        )}
      </Card>

      {prepared === null ? (
        <Card className="scanner__card">
          <EmptyState
            variant="inline"
            sigil="scan"
            title={copy.source.emptyTitle}
            description={copy.source.emptyBody}
          />
        </Card>
      ) : (
        <Card className="scanner__card" title={copy.edit.title}>
          <div
            className="scanner__frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas ref={canvasRef} className="scanner__canvas" aria-label={copy.edit.cropHint} />
            {dragRect !== null && (
              // The rectangle being drawn, in the units it is dragged in. No
              // colour and no layer here: geometry is data, and the stylesheet
              // owns how a selection looks.
              <div
                className="scanner__selection"
                style={{
                  left: `${String(dragRect.left)}%`,
                  top: `${String(dragRect.top)}%`,
                  width: `${String(dragRect.width)}%`,
                  height: `${String(dragRect.height)}%`,
                }}
              />
            )}
          </div>
          <p className="nx-hint">{copy.edit.cropHint}</p>
          <div className="scanner__row">
            <Button size="sm" onClick={() => setRotation((turns) => turns - 1)}>
              <Icon name="undo" />
              {copy.edit.rotateLeft}
            </Button>
            <Button size="sm" onClick={() => setRotation((turns) => turns + 1)}>
              <Icon name="repeat" />
              {copy.edit.rotateRight}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => applyCrop(WHOLE_CROP)}>
              {copy.edit.whole}
            </Button>
          </div>
          <div className="scanner__crop">
            {(["left", "top", "width", "height"] as const).map((part) => (
              <TextField
                key={part}
                className="scanner__crop-field"
                label={copy.edit[part]}
                inputMode="numeric"
                value={cropText[part]}
                onChange={(event) => {
                  const next = { ...cropText, [part]: event.target.value };
                  setCropText(next);
                  setCrop({
                    left: numberOf(next.left, 0),
                    top: numberOf(next.top, 0),
                    width: numberOf(next.width, 100),
                    height: numberOf(next.height, 100),
                  });
                }}
              />
            ))}
          </div>
          <div className="scanner__row">
            <Checkbox checked={threshold} onChange={(event) => setThreshold(event.target.checked)}>
              {copy.edit.threshold}
            </Checkbox>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setThreshold(true);
                setRotation(0);
                applyCrop(WHOLE_CROP);
              }}
            >
              {copy.edit.reset}
            </Button>
          </div>
          <p className="nx-hint">{copy.edit.thresholdHint}</p>
        </Card>
      )}

      <Card className="scanner__card" title={copy.read.title}>
        {pack === "checking" ? (
          <LoadingState label={copy.pack.checking} rows={2} />
        ) : pack === "ready" ? (
          <>
            <div className="scanner__languages">
              {LANGUAGE_ROWS.map((row) => (
                <Checkbox
                  key={row.code}
                  checked={languages.includes(row.code)}
                  onChange={(event) =>
                    setLanguages((current) =>
                      event.target.checked
                        ? [...current, row.code]
                        : current.filter((code) => code !== row.code),
                    )
                  }
                >
                  {copy.read[row.copyKey]}
                </Checkbox>
              ))}
            </div>
            <p className="nx-hint">{copy.read.languageHint}</p>
          </>
        ) : (
          <div className="scanner__notice">
            <p className="scanner__notice-title">
              {pack === "missing" ? copy.pack.missingTitle : copy.pack.unknownTitle}
            </p>
            <p className="nx-hint">
              {pack === "missing" ? copy.pack.missingBody : copy.pack.unknownBody}
            </p>
          </div>
        )}
        <div className="scanner__row">
          <Button
            size="sm"
            variant="primary"
            disabled={prepared === null || languages.length === 0 || pack !== "ready" || busy}
            onClick={() => void readText()}
          >
            {reading ? copy.read.reading : copy.read.read}
          </Button>
        </div>
        {progress !== null && (
          <div className="scanner__progress">
            <span className="nx-hint">
              {copy.read.phaseLabel}: {copy.read.phase[scanPhase(progress.status)]}
            </span>
            <span className="nx-hint">
              {copy.read.progressLabel}:{" "}
              {numberFormat({ style: "percent", maximumFractionDigits: 0 }).format(progress.progress)}
            </span>
            <progress
              className="scanner__bar"
              max={1}
              value={progress.progress}
              aria-label={copy.read.reading}
            />
          </div>
        )}
      </Card>

      <Card className="scanner__card" title={copy.result.title}>
        {outcome === null ? (
          <EmptyState variant="inline" title={copy.result.emptyTitle} description={copy.result.emptyBody} />
        ) : (
          <>
            <div className="scanner__row">
              <Chip variant="data">
                {copy.result.confidenceLabelSummary}: {outcome.confidence}%
              </Chip>
              {outcome.lowCount > 0 && <Chip variant="danger">{copy.result.lowMark}</Chip>}
            </div>
            {outcome.lowCount > 0 && <p className="nx-hint">{copy.result.lowNote}</p>}
            <div className="scanner__lines" aria-label={copy.result.linesLabel}>
              {outcome.lines.map((line, index) => (
                <ListRow
                  key={`${String(index)}:${line.text}`}
                  muted={line.low}
                  leading={<span className="scanner__line-number">{index + 1}</span>}
                  trailing={
                    <span className="scanner__line-mark">
                      {line.low && <Chip variant="danger">{copy.result.lowMark}</Chip>}
                      <span
                        className="scanner__line-confidence"
                        aria-label={`${copy.result.confidenceLabel}: ${String(line.confidence)}%`}
                      >
                        {line.confidence}%
                      </span>
                    </span>
                  }
                >
                  <span className="scanner__line" aria-label={`${copy.result.lineLabel} ${String(index + 1)}`}>
                    {line.text}
                  </span>
                </ListRow>
              ))}
            </div>
            <TextField
              label={copy.result.noteTitle}
              value={noteTitle}
              maxLength={200}
              onChange={(event) => setNoteTitle(event.target.value)}
            />
            <p className="nx-hint">{copy.result.noteTitleHint}</p>
            <Checkbox checked={attachImage} onChange={(event) => setAttachImage(event.target.checked)}>
              {copy.result.attach}
            </Checkbox>
            <div className="scanner__row">
              <Button size="sm" onClick={() => void copyText()}>
                {copy.result.copy}
              </Button>
              <Button size="sm" variant="primary" onClick={() => void saveAsNote()}>
                {copy.result.save}
              </Button>
            </div>
            {copied && <p className="nx-hint">{copy.result.copied}</p>}
            {savedTitle !== null && <p className="nx-hint">{`${copy.result.saved} ${savedTitle}`}</p>}
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * A percentage from one of the four crop fields, tolerating the decimal comma
 * the app's own locale writes.
 *
 * A field the user has cleared answers the FALLBACK rather than zero:
 * `Number("")` is 0, so the empty string would otherwise be "a one-pixel crop"
 * the moment somebody selected a field's contents and pressed Backspace.
 */
function numberOf(value: string, fallback: number): number {
  const text = value.trim().replace(",", ".");
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? clampPercent(parsed) : fallback;
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

/**
 * The name a scan's picture is attached under.
 *
 * A local-time-free stamp from the real clock, so two scans of one day do not
 * collide in the notes module's attachment list. A file name is data and not
 * copy, which is why it is not in the copy table: nothing here is a sentence.
 */
function attachmentName(): string {
  return `skener-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
}

/** A framed picture as the PNG bytes the notes module's own attachment channel takes. */
async function pngBytes(image: RgbaImage): Promise<Uint8Array> {
  const canvas = canvasFromPixels(image);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (blob === null) throw new Error("Nexus: the canvas did not produce a PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}
