import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  ListRow,
  LoadingState,
  PageHeader,
  StatBand,
  type Stat,
} from "@nexus/ui";
import { boardSizeMm, GERBER_ROLES, type GcodeModel, type StlMesh } from "@nexus/core";
import type { ThemeName } from "@nexus/tokens";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import {
  type WorkshopBoardLayer,
  type WorkshopFileProblem,
  type WorkshopRefusedFile,
  type WorkshopResult,
  type WorkshopTarget,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { ImageTools } from "./images/ImageTools.js";
import { PdfTools } from "./pdf/PdfTools.js";
import {
  boundsText,
  countText,
  durationText,
  millimetreCubeText,
  millimetreSquareText,
  millimetreText,
  pathParts,
} from "./format.js";
import { activeTheme, layerColour, viewerColours, withLayerColour } from "./palette.js";
import { forgetRecentFiles, readRecentFiles, rememberRecentFile, type RecentFile } from "./recentFiles.js";
import { buildModelScene, buildToolpathScene, type ToolpathScene } from "./scenes.js";
import { Viewport3D, type SceneApi, type ViewportHandle } from "./Viewport3D.js";
import { isViewer, viewLabel, WORKSHOP_VIEWS, type WorkshopView } from "./views.js";
import { createParseClient, type ParseClient } from "./workerClient.js";
import "./workshop.css";

/**
 * RADIONICA (ADR-090) - the three viewers and the two tool sets, one page.
 *
 * **Why one page rather than three.** A maker arrives with a file, not with a
 * module: the person who opens a bracket's STL to check its bounds is the person
 * who opens the G-code of the same part a minute later, and the switcher keeps
 * one of each loaded while the other is looked at. Three pages would be three
 * rail entries that say the same word, and three of everything else.
 *
 * **Why the PDF and image tools are views of it.** They are the same errand one
 * step further on: the file that arrives from a machine or a fabricator is
 * sometimes a document that has to be merged, split or written back out, and a
 * fourth and fifth rail entry would be two more pages that say "workshop". The
 * tool sets bring their own words and their own stylesheet
 * (`pdf/`, `images/`), so what this page adds is the segment and the file API
 * the two components take as a prop.
 *
 * **What happens where.** Main opens the dialog and reads the file - the
 * capability and the caps. The PARSE worker reads the model and the toolpath,
 * because those are millions of numbers and the window must not freeze. Main
 * converts a board layer through `gerber-to-svg`, for the reason `main/gerber.ts`
 * records at length. This page draws, formats and remembers - and it is the only
 * one of the three that knows the active language or the active theme.
 *
 * **The one thing it keeps is a list of paths.** No geometry survives a reload,
 * nothing is written to the profile, and the list belongs to this machine
 * (`recentFiles.ts`) - which is why the module has no migration, no archive
 * section and no dashboard card.
 */

/** A model as this page holds it: the parsed mesh, and the two facts about the file itself. */
interface ModelState {
  readonly name: string;
  readonly mesh: StlMesh;
  readonly closed: boolean;
}

/** A toolpath as this page holds it. */
interface ToolpathState {
  readonly name: string;
  readonly model: GcodeModel;
}

/** One layer of the open board, with an id of its own for the show/hide chips. */
type BoardLayer = WorkshopBoardLayer & { readonly id: string };

export default function WorkshopPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<WorkshopView>("model");
  const [model, setModel] = useState<ModelState | null>(null);
  const [toolpath, setToolpath] = useState<ToolpathState | null>(null);
  const [board, setBoard] = useState<readonly BoardLayer[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [recent, setRecent] = useState<readonly RecentFile[]>(() => readRecentFiles(profileId));
  const [busy, setBusy] = useState(false);
  /** True only while the WORKER is reading a file: the dialog's own wait is not a parse. */
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<readonly WorkshopRefusedFile[]>([]);
  const [problem, setProblem] = useState<WorkshopFileProblem | null>(null);
  const [topLayer, setTopLayer] = useState<number | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [theme, setTheme] = useState(() => activeTheme());

  const colours = useMemo(() => viewerColours(theme), [theme]);

  /**
   * The parse worker: one per open page, created once and stopped when the page
   * unmounts. A worker nobody will ask again is memory held for a module nobody
   * has open, and it also owns `@nexus/core`'s two readers, which nothing else
   * in the renderer needs.
   */
  const worker = useRef<ParseClient | null>(null);
  useEffect(() => {
    const client = createParseClient();
    worker.current = client;
    return () => {
      client.dispose();
      worker.current = null;
    };
  }, []);

  /**
   * The theme is a document attribute (`theme.ts` writes `<html data-theme>`) and
   * the two 3D surfaces read their colours from it, so the page watches the
   * attribute rather than capturing it: toggling Dan/Noć while a model is open
   * must repaint the bench.
   */
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(activeTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  /** What came back from main: a board stacks onto the board, a model or a toolpath goes to the worker. */
  const accept = useCallback(
    async (result: WorkshopResult) => {
      setRefused(result.refused);
      setProblem(result.problem ?? null);
      if (result.canceled) return;
      const layers: BoardLayer[] = [];
      for (const file of result.files) {
        setRecent(
          rememberRecentFile(
            profileId,
            { path: file.path, name: file.name, target: file.kind },
            new Date().toISOString(),
          ),
        );
        if (file.kind === "board") {
          layers.push({ ...file, id: `${file.path}#${layers.length}` });
          continue;
        }
        const client = worker.current;
        if (client === null) continue;
        setParsing(true);
        const answer = await client.parse({
          kind: file.kind,
          name: file.name,
          // The file's bytes are a view over a buffer the IPC layer produced, so
          // the slice that is handed over is exact: transferring the whole
          // underlying buffer would take bytes that are not this file's.
          bytes: file.bytes.buffer.slice(
            file.bytes.byteOffset,
            file.bytes.byteOffset + file.bytes.byteLength,
          ) as ArrayBuffer,
        });
        setParsing(false);
        if (!answer.ok) {
          // A reader that refused the file is one sentence; a worker that died is
          // another, and neither is the page's own failure to call main.
          setError(
            answer.problem === "failed"
              ? copy.errors.read
              : file.kind === "model"
                ? copy.model.readError
                : copy.toolpath.readError,
          );
          continue;
        }
        setError(null);
        if (answer.result.kind === "model") {
          setModel({ name: file.name, mesh: answer.result.mesh, closed: answer.result.closed });
        } else {
          setToolpath({ name: file.name, model: answer.result.model });
          // A new toolpath starts with every layer drawn: the slider's position
          // is the section's state, not something a file carries.
          setTopLayer(null);
        }
      }
      if (layers.length > 0) {
        setBoard((current) => [...current, ...layers]);
        setError(null);
      }
    },
    [profileId],
  );

  /** Opens the dialog for one target. A call that itself fails is a page error, not a file's. */
  const open = useCallback(
    async (which: WorkshopTarget) => {
      setBusy(true);
      setError(null);
      setProblem(null);
      try {
        await accept(await window.nexus.modules.workshop.open({ target: which }));
      } catch (failure) {
        setError(copy.errors.load);
        console.error("Nexus: the workshop could not open a file:", failure);
      } finally {
        setBusy(false);
      }
    },
    [accept],
  );

  /**
   * Re-reads a path this session already opened.
   *
   * Main refuses anything it did not hand out in this session, and that refusal
   * is the honest answer for an entry from yesterday: the page then says so and
   * leaves the open dialog as the way in.
   */
  const reopen = useCallback(
    async (which: WorkshopTarget, path: string) => {
      setBusy(true);
      setError(null);
      setProblem(null);
      try {
        await accept(await window.nexus.modules.workshop.reopen({ target: which, path }));
      } catch (failure) {
        setError(copy.errors.load);
        console.error("Nexus: the workshop could not re-open a file:", failure);
      } finally {
        setBusy(false);
      }
    },
    [accept],
  );

  /** The button that opens each section's dialog: one shape, three labels. */
  const openButton = (which: WorkshopTarget) => (
    <Button size="sm" variant="primary" disabled={busy} onClick={() => void open(which)}>
      {busy ? copy.open.busy : copy.open[which]}
    </Button>
  );

  /**
   * The file API the two tool sets take as a prop: the module's own contract,
   * the same object every other call on this page goes through. The tools never
   * reach `window` themselves, so a tool set can be mounted by another surface
   * without knowing where its ops come from.
   */
  const files = window.nexus.modules.workshop;
  const viewer = isViewer(view) ? view : null;

  return (
    <div className="workshop">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="grid"
      />

      <div className="workshop__switcher" role="group" aria-label={copy.page.subtitle}>
        {WORKSHOP_VIEWS.map((which) => (
          <Button
            key={which}
            size="sm"
            className="nx-segmented__option"
            aria-pressed={view === which}
            onClick={() => setView(which)}
          >
            {viewLabel(which)}
          </Button>
        ))}
      </div>

      {viewer !== null && error !== null && (
        <p className="workshop__error" role="alert">
          {error}
        </p>
      )}
      {viewer !== null && problem !== null && (
        <p className="workshop__error">{copy.problems[problem]}</p>
      )}
      {viewer !== null && refused.length > 0 && (
        <ul className="workshop__refused">
          {refused.map((entry, index) => (
            <li key={`${entry.name}-${entry.problem}-${index}`}>
              {entry.name}: {copy.problems[entry.problem]}
            </li>
          ))}
        </ul>
      )}

      {view === "model" && (
        <ModelSection
          model={model}
          colours={colours}
          parsing={parsing}
          wireframe={wireframe}
          onWireframe={setWireframe}
          openButton={openButton("model")}
        />
      )}
      {view === "toolpath" && (
        <ToolpathSection
          toolpath={toolpath}
          colours={colours}
          parsing={parsing}
          topLayer={topLayer}
          onTopLayer={setTopLayer}
          openButton={openButton("toolpath")}
        />
      )}
      {view === "board" && (
        <BoardSection
          layers={board}
          theme={theme}
          flipped={flipped}
          onFlip={setFlipped}
          hidden={hidden}
          onToggle={(id) => setHidden(toggleIn(hidden, id))}
          openButton={openButton("board")}
        />
      )}

      {/* The two tool sets: their own components, their own words, the same file
          API — the module's contract rather than a shell-wide one, so a tool
          set reads and writes files exactly as the viewers do. */}
      {view === "pdf" && <PdfTools files={files} />}
      {view === "images" && <ImageTools files={files} />}

      {viewer !== null && (
        <Card className="workshop__card" title={copy.recent.title}>
          <p className="nx-hint">{copy.recent.caption}</p>
          {recent.length === 0 ? (
            <p className="nx-hint">{copy.recent.empty}</p>
          ) : (
            <div className="workshop__list">
              {recent.map((entry) => (
                <ListRow
                  key={entry.path}
                  trailing={
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void reopen(entry.target, entry.path)}
                    >
                      {copy.open.again}
                    </Button>
                  }
                >
                  <span className="workshop__recent-name">{entry.name}</span>
                  <span className="workshop__recent-path">{pathParts(entry.path).directory}</span>
                  <Chip>{copy.targets[entry.target]}</Chip>
                </ListRow>
              ))}
            </div>
          )}
          <div className="workshop__actions">
            <Button
              size="sm"
              variant="quiet"
              disabled={recent.length === 0}
              onClick={() => {
                forgetRecentFiles(profileId);
                setRecent([]);
              }}
            >
              {copy.recent.forget}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// --- The model ---------------------------------------------------------------

/**
 * The STL view: the mesh on a grid, the bounding box drawn around it, and the
 * four numbers the file itself holds.
 *
 * The wireframe is part of the BUILD key rather than an update, and that is a
 * deliberate trade: a material asks three.js to draw the same geometry a second
 * way, which is free, while switching a wireframe on a mesh whose buffer is
 * already on the GPU means re-uploading it in this component's own design. One
 * click, one upload, and the control says what it does.
 */
function ModelSection({
  model,
  colours,
  parsing,
  wireframe,
  onWireframe,
  openButton,
}: {
  readonly model: ModelState | null;
  readonly colours: ReturnType<typeof viewerColours>;
  readonly parsing: boolean;
  readonly wireframe: boolean;
  readonly onWireframe: (on: boolean) => void;
  readonly openButton: ReactNode;
}) {
  const viewport = useRef<ViewportHandle | null>(null);
  const build = useCallback(
    (api: SceneApi) => {
      if (model !== null) buildModelScene(api, model.mesh, wireframe);
    },
    [model, wireframe],
  );

  // Nothing on screen and a read in flight: the page is working, and it says so
  // rather than showing an empty state that looks like a failure.
  if (model === null && parsing) return <LoadingState label={copy.model.reading} rows={3} />;
  if (model === null) {
    return (
      <EmptyState
        sigil="grid"
        title={copy.empty.modelTitle}
        description={copy.empty.modelBody}
        action={openButton}
      />
    );
  }

  const stats: readonly Stat[] = [
    { label: copy.model.triangles, value: countText(model.mesh.triangleCount) },
    { label: copy.model.bounds, value: boundsText(model.mesh.bounds.size) },
    {
      label: copy.model.volume,
      value: millimetreCubeText(model.mesh.volume),
      // The one caveat this figure needs, and it is not a footnote: the sum is
      // exact for a closed mesh and meaningless for anything else.
      note: model.closed ? copy.model.closedNote : copy.model.openNote,
    },
    { label: copy.model.area, value: millimetreSquareText(model.mesh.area) },
  ];

  return (
    <Card className="workshop__card" title={model.name}>
      <div className="workshop__toolbar">
        <Chip variant="data">
          {copy.model.format}: {model.mesh.format === "binary" ? copy.model.formatBinary : copy.model.formatAscii}
        </Chip>
        <label className="workshop__check">
          <Checkbox checked={wireframe} onChange={(event) => onWireframe(event.target.checked)} />
          {copy.model.wireframe}
        </label>
        <Button size="sm" onClick={() => viewport.current?.fit()}>
          {copy.view.fit}
        </Button>
        {openButton}
      </div>
      <Viewport3D
        ref={viewport}
        label={copy.empty.modelTitle}
        colours={colours}
        buildKey={`${model.name}:${wireframe ? "mesh" : "solid"}`}
        updateKey=""
        build={build}
      />
      <StatBand stats={stats} caption={copy.model.unitsNote} />
    </Card>
  );
}

// --- The toolpath ------------------------------------------------------------

/**
 * The G-code view: the toolpath by layer, with the layer slider and the four
 * figures the file itself holds.
 *
 * The slider moves an `updateKey`, not the build: showing fewer layers is
 * `visible` on objects that are already uploaded, which is what makes dragging
 * it free instead of a two-million-segment re-upload per frame.
 */
function ToolpathSection({
  toolpath,
  colours,
  parsing,
  topLayer,
  onTopLayer,
  openButton,
}: {
  readonly toolpath: ToolpathState | null;
  readonly colours: ReturnType<typeof viewerColours>;
  readonly parsing: boolean;
  readonly topLayer: number | null;
  readonly onTopLayer: (top: number | null) => void;
  readonly openButton: ReactNode;
}) {
  const viewport = useRef<ViewportHandle | null>(null);
  const scene = useRef<ToolpathScene | null>(null);

  const build = useCallback(
    (api: SceneApi) => {
      scene.current = toolpath === null ? null : buildToolpathScene(api, toolpath.model);
    },
    [toolpath],
  );
  const update = useCallback(() => {
    if (toolpath !== null) scene.current?.setTop(topLayer ?? toolpath.model.layers.length - 1);
  }, [toolpath, topLayer]);

  if (toolpath === null && parsing) return <LoadingState label={copy.toolpath.reading} rows={3} />;
  if (toolpath === null) {
    return (
      <EmptyState
        sigil="grid"
        title={copy.empty.toolpathTitle}
        description={copy.empty.toolpathBody}
        action={openButton}
      />
    );
  }

  const { model } = toolpath;
  const last = Math.max(0, model.layers.length - 1);
  const top = topLayer ?? last;
  const shown = model.layers[top];
  const stats: readonly Stat[] = [
    { label: copy.toolpath.layers, value: countText(model.layers.length) },
    { label: copy.toolpath.extruding, value: millimetreText(model.extrusionMm) },
    { label: copy.toolpath.travel, value: millimetreText(model.travelMm) },
    { label: copy.toolpath.filament, value: millimetreText(model.filamentMm) },
    {
      label: copy.toolpath.time,
      value: durationText(model.estimatedSeconds),
      note: copy.toolpath.timeNote,
    },
  ];

  return (
    <Card className="workshop__card" title={toolpath.name}>
      <div className="workshop__toolbar">
        <Chip variant="data">
          {copy.toolpath.units}: {model.units === "inch" ? copy.toolpath.unitsInch : "mm"}
        </Chip>
        <Button size="sm" onClick={() => viewport.current?.fit()}>
          {copy.view.fit}
        </Button>
        {openButton}
      </div>
      <div className="workshop__slider">
        <label className="workshop__slider-label" htmlFor="workshop-layer">
          {copy.toolpath.layer} {top + 1} / {countText(model.layers.length)}
        </label>
        {/* A range input rather than a component, because the design system has
            no slider and this is one control: the track is painted by the
            browser from `accent-color`, which is a token. */}
        <input
          id="workshop-layer"
          className="workshop__range"
          type="range"
          min={0}
          max={last}
          step={1}
          value={top}
          aria-valuetext={`${copy.toolpath.layer} ${top + 1}`}
          onChange={(event) => onTopLayer(Number(event.target.value))}
        />
        <Button size="sm" variant="quiet" onClick={() => onTopLayer(null)}>
          {copy.toolpath.showingAll}
        </Button>
        <span className="nx-hint">
          {copy.toolpath.zHeight}: {millimetreText(shown?.zMm ?? 0, 2)}
        </span>
      </div>
      <Viewport3D
        ref={viewport}
        label={copy.empty.toolpathTitle}
        colours={colours}
        buildKey={toolpath.name}
        updateKey={String(top)}
        build={build}
        update={update}
      />
      <StatBand stats={stats} />
      {model.warnings.length > 0 && (
        <div className="workshop__warnings">
          <p className="nx-eyebrow">{copy.toolpath.warnings.title}</p>
          <ul>
            {model.warnings.map((warning) => (
              <li key={warning}>{copy.toolpath.warnings[warning]}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --- The board ---------------------------------------------------------------

/**
 * The board: every opened layer as an `<img>` over a Blob URL, on the bench.
 *
 * **Why an `<img>` and not the SVG in the document.** The conversion's output is
 * a document, and inlining one into this page would put a thousand generated
 * elements into the DOM of the app - a different security and performance shape
 * from showing a picture. A `Blob` URL is a reference the browser loads like any
 * other image, and it is revoked when the layers or the theme change.
 *
 * **Two transforms, both of them the board's own geometry.** The layers are laid
 * out at one pixel per millimetre inside a box the board's size, and that box is
 * scaled to fit the stage; the flip is a mirror in Y about the board's centre,
 * which is what turning a board over does.
 */
function BoardSection({
  layers,
  theme,
  flipped,
  onFlip,
  hidden,
  onToggle,
  openButton,
}: {
  readonly layers: readonly BoardLayer[];
  readonly theme: ThemeName | null;
  readonly flipped: boolean;
  readonly onFlip: (flipped: boolean) => void;
  readonly hidden: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly openButton: ReactNode;
}) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [urls, setUrls] = useState<readonly { readonly id: string; readonly url: string }[]>([]);
  useEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setStageSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setStageSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  /**
   * The layer colours live INSIDE each SVG (`withLayerColour`), because a
   * document shown through an `<img>` inherits nothing from this page. So the
   * Blob URLs are rebuilt when the layers or the theme change, and the ones they
   * replace are revoked in the same pass - a URL nobody revokes is the document
   * held in memory for the life of the process.
   */
  useEffect(() => {
    const made = layers.map((layer) => ({
      id: layer.id,
      url: URL.createObjectURL(
        new Blob([withLayerColour(layer.svg, layerColour(layer.role, theme))], {
          type: "image/svg+xml",
        }),
      ),
    }));
    setUrls(made);
    return () => {
      for (const { url } of made) URL.revokeObjectURL(url);
    };
  }, [layers, theme]);

  if (layers.length === 0) {
    return (
      <EmptyState
        sigil="grid"
        title={copy.empty.boardTitle}
        description={copy.empty.boardBody}
        action={openButton}
      />
    );
  }

  /**
   * The layers in the order a fabricator reads a board: copper, then the mask,
   * then the silkscreen, then the paste, then the outline and the drill.
   *
   * `GERBER_ROLES` states that order once, and the sort is on the role's own
   * position in it - so this is not an alphabetical sort of anybody's text and
   * needs no collator. Within one role the order the files were opened is kept,
   * because that is the order the person chose them.
   */
  const ordered = [...layers].sort(
    (left, right) => GERBER_ROLES.indexOf(left.role) - GERBER_ROLES.indexOf(right.role),
  );
  const size = boardSizeMm(ordered);
  const scale =
    size.widthMm > 0 && size.heightMm > 0 && stageSize.width > 0
      ? Math.min((stageSize.width - 24) / size.widthMm, (stageSize.height - 24) / size.heightMm)
      : 1;
  const minX = Math.min(...layers.map((layer) => layer.originXmm));
  const minY = Math.min(...layers.map((layer) => layer.originYmm));

  return (
    <Card className="workshop__card" title={copy.targets.board}>
      <div className="workshop__toolbar">
        <span className="nx-hint">
          {copy.board.layers}: {countText(layers.length)}
        </span>
        {/* Which side of the board is shown is an either/or, so it is drawn as
            one: two buttons with `aria-pressed`, the same shape the shell's own
            view switchers have, rather than a checkbox that would have to imply
            what "checked" means. */}
        <div className="workshop__switcher" role="group" aria-label={copy.board.flip}>
          <Button
            size="sm"
            className="nx-segmented__option"
            aria-pressed={!flipped}
            onClick={() => onFlip(false)}
          >
            {copy.board.flipOff}
          </Button>
          <Button
            size="sm"
            className="nx-segmented__option"
            aria-pressed={flipped}
            onClick={() => onFlip(true)}
          >
            {copy.board.flipOn}
          </Button>
        </div>
        {openButton}
      </div>
      <div className="workshop__stage" ref={stage}>
        <div
          className="workshop__board"
          style={{
            width: `${size.widthMm}px`,
            height: `${size.heightMm}px`,
            transform: `translate(-50%, -50%) scale(${scale}, ${flipped ? -scale : scale})`,
          }}
        >
          {ordered.map((layer) => (hidden.has(layer.id) ? null : <img
            key={layer.id}
            className="workshop__layer"
            src={urls.find((entry) => entry.id === layer.id)?.url ?? ""}
            alt={`${copy.layers[layer.role]}: ${layer.name}`}
            style={{
              left: `${layer.originXmm - minX}px`,
              top: `${layer.originYmm - minY}px`,
              width: `${layer.widthMm}px`,
              height: `${layer.heightMm}px`,
            }}
          />))}
        </div>
      </div>
      <p className="nx-hint">
        {copy.board.size}: {millimetreText(size.widthMm)} × {millimetreText(size.heightMm)} —{" "}
        {size.from === "outline" ? copy.board.fromOutline : copy.board.fromLayers}
      </p>
      <div className="workshop__layers" role="group" aria-label={copy.board.layers}>
        {ordered.map((layer) => (
          <label key={layer.id} className="workshop__layer-chip">
            <Checkbox
              checked={!hidden.has(layer.id)}
              aria-label={`${copy.layers[layer.role]}: ${layer.name}`}
              onChange={() => onToggle(layer.id)}
            />
            <span
              className="workshop__layer-colour"
              style={{ background: layerColour(layer.role, theme) }}
              aria-hidden="true"
            />
            <span className="workshop__layer-name">
              {copy.layers[layer.role]} — {layer.name}
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}

/** A set with one id toggled, as a new set - what a React state update needs. */
function toggleIn(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
