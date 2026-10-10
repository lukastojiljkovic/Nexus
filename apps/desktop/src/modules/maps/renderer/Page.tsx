import { useCallback, useEffect, useRef, useState } from "react";
import {
  GeoJSONSource,
  MapLibreMap,
  addProtocol,
  type MapMouseEvent,
  type MapOptions,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { Button, EmptyState, LoadingState, PageHeader, TextField } from "@nexus/ui";
import {
  formatCoordinates,
  formatDistanceKilometres,
  formatDistanceMetres,
  formatDistanceShort,
  haversineMetres,
  remoteStyleUrls,
  scaleBar,
  type GeoPoint,
  type MapPlace,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { MAP_PACK_STYLES, type MapPackTheme } from "../shared/packs.js";
import type { MapsPinView, MapsView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  emptyCollection,
  locationFeatureCollection,
  measureLineCollection,
  measureMetres,
  measurePointCollection,
  pinColourExpression,
  pinsFeatureCollection,
  selectedPinCollection,
  styleCamera,
} from "./mapData.js";
import { PinDialog, type DialogState } from "./PinDialog.js";
import { PinList } from "./PinList.js";
import { readPackText } from "./packFile.js";
import type { SearchRequest, SearchResponse } from "./searchWorker.js";
// The renderer's own stylesheet, and the ONLY third-party CSS in this module.
// MapLibre positions its canvas container and its overlay panes from these
// rules, and no amount of styling by this app can replace them: the classes are
// the renderer's internals rather than a public contract, so a module that
// restated them would break on the next MapLibre minor. Nothing in this module
// uses a MapLibre control, so what arrives is one canvas and no chrome.
import "maplibre-gl/dist/maplibre-gl.css";
import "./maps.css";

/**
 * MAPE (ADR-099) — the offline map.
 *
 * **The pack owns the map; the page owns the profile's marks on it.**
 * Everything the map is made of — the tiles, the style, the place labels, the
 * glyphs — comes out of the installed pack through the `nx-pack://` scheme, and
 * this file reads three of those files and hands the style to MapLibre. What it
 * draws itself is what belongs to the PROFILE rather than to the map: its pins,
 * where this machine is, and a measurement the user is taking right now. That
 * split is the difference between two lifetimes — a pack is replaced by
 * installing a new one, and a pin is the user's own mark that survives all of
 * them.
 *
 * **Nothing here animates.** The map is created at the style's own camera and
 * moved only by a gesture or an explicit control; selecting a search result
 * JUMPS rather than flies (`jumpTo`, not `flyTo`), because a camera that glides
 * for a second and a half is motion nobody asked for. `prefers-reduced-motion`
 * is respected by having nothing to reduce, which is a stronger answer than a
 * flag that switches off one effect and leaves the rest.
 *
 * **Every failure is a sentence and a next step.** A missing pack, a style this
 * app refuses to trust, an index that would not parse: each draws its own line
 * naming what failed and what to do about it, and none shows an exception.
 */

/** The layer and source ids this page adds to whatever style the pack carries. */
const PINS_SOURCE = "nexus-pins";
const PINS_LAYER = "nexus-pins";
const SELECTED_SOURCE = "nexus-pin-selected";
const SELECTED_LAYER = "nexus-pin-selected";
const LOCATION_SOURCE = "nexus-location";
const LOCATION_LAYER = "nexus-location";
const MEASURE_POINT_SOURCE = "nexus-measure-points";
const MEASURE_LINE_SOURCE = "nexus-measure-line";
const MEASURE_POINT_LAYER = "nexus-measure-points";
const MEASURE_LINE_LAYER = "nexus-measure-line";

/** How wide a scale bar may be drawn, in pixels — the width `.maps__scale` reserves. */
const SCALE_MAX_PX = 100;

/** How many search results the box draws. Ten is a column, not a page. */
const SEARCH_LIMIT = 10;

/**
 * MapLibre's own types for the three things this module builds as plain data.
 *
 * A GeoJSON feature collection and an expression are JSON — that is the point of
 * both formats — and MapLibre's declarations for them are unions of tuple types
 * that a variable-length array cannot be PROVED to be: `@types/geojson` and the
 * style spec's `ExpressionSpecification` are exported by neither package, so the
 * only honest spelling is a cast at the boundary. What makes it safe is that
 * there are three of them, all in this file, and `mapData.test.ts` asserts the
 * exact objects they carry.
 */
type GeoJsonData = Parameters<GeoJSONSource["setData"]>[0];
type MapStyleOption = NonNullable<MapOptions["style"]>;
/** `never` because the paint value's own union is unnameable here — see the note above. */
type PaintValue = never;

/** The theme the map is drawn for, read off the document the shell already drives. */
function currentTheme(): MapPackTheme {
  return document.documentElement.getAttribute("data-theme") === "noc" ? "noc" : "dan";
}

/** The live value of one design token. MapLibre paints from values, not from CSS variables. */
function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `--nx-swatch-<id>` for one pin colour: the palette's own name for it. */
function swatchValue(color: MapsPinView["color"]): string {
  return tokenValue(`--nx-swatch-${color}`);
}

/** The tile protocol is registered once per renderer process; `addProtocol` would throw on a second call. */
let pmtilesRegistered = false;
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

/** What the pack's own files are, as the page reads them. */
type PackState =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "style-broken" }
  | { readonly status: "network" }
  | { readonly status: "ready"; readonly styles: Readonly<Record<MapPackTheme, unknown>> };

/** What the search box is showing. */
interface SearchState {
  readonly status: "loading" | "ready" | "failed";
  readonly query: string;
  readonly results: readonly MapPlace[];
}

type Run = (action: (maps: typeof window.nexus.modules.maps) => Promise<MapsView>) => Promise<void>;

export default function MapsPage({ profileId }: ModulePageProps) {
  const locale = activeLocale();
  const [view, setView] = useState<MapsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<PackState>({ status: "loading" });
  const [theme, setTheme] = useState<MapPackTheme>(() => currentTheme());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<readonly GeoPoint[]>([]);
  const [camera, setCamera] = useState<GeoPoint | null>(null);
  const [scale, setScale] = useState<{ metres: number; pixels: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: "loading", query: "", results: [] });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** The newest question sent to the worker: an answer for an older one is stale and dropped. */
  const searchId = useRef(0);

  const pins = view?.pins ?? [];

  // --- The profile's own data (main's side) --------------------------------

  const run = useCallback<Run>(async (action) => {
    try {
      setView(await action(window.nexus.modules.maps));
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: a maps change failed:", failure);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.maps.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the map pins could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // --- The pack (the renderer's side) --------------------------------------

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const texts = await Promise.all([
          readPackText(MAP_PACK_STYLES.dan),
          readPackText(MAP_PACK_STYLES.noc),
        ]);
        if (!active) return;
        let styles: Record<MapPackTheme, unknown>;
        try {
          styles = { dan: JSON.parse(texts[0]) as unknown, noc: JSON.parse(texts[1]) as unknown };
        } catch (parseError) {
          setPack({ status: "style-broken" });
          console.error("Nexus: the map pack's style is not JSON:", parseError);
          return;
        }
        for (const style of [styles.dan, styles.noc]) {
          // The one promise this module makes is that the map works with the
          // network off. A style that names an address is refused rather than
          // drawn, because the failure it would produce is a blank map on an
          // offline machine and a fine-looking one on a developer's.
          if (remoteStyleUrls(style).length > 0) {
            setPack({ status: "network" });
            return;
          }
        }
        setPack({ status: "ready", styles });
      } catch (readError) {
        if (active) setPack({ status: "missing" });
        console.error("Nexus: the map pack could not be read:", readError);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The shell drives `<html data-theme>`, and the map's colours are baked into
  // the pack's two styles — so the map follows the theme by swapping the style,
  // which is also what re-reads the palette's values for the pin layer.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const styleForTheme = pack.status === "ready" ? pack.styles[theme] : null;
  const styleReady = styleForTheme !== null;
  /**
   * The style the map should be wearing, always the one from the last render.
   *
   * The two effects below are keyed on "is there a style at all" and on "the
   * theme changed", never on the style OBJECT: a theme switch swaps the style in
   * place rather than rebuilding the map, because a rebuilt map starts at the
   * pack's camera and a theme is not a reason to throw away where the user was
   * looking. A ref is how an effect can read the current value without listing
   * it — and without the stale closure a missing dependency would leave behind.
   */
  const styleRef = useRef<unknown>(null);
  styleRef.current = styleForTheme;

  // --- The map -------------------------------------------------------------

  useEffect(() => {
    const style = styleRef.current;
    if (!styleReady || containerRef.current === null || style === null) return;
    ensurePmtilesProtocol();
    const start = styleCamera(style);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: style as MapStyleOption,
      // The camera is the PACK's, not this app's: the builder writes the
      // region's centre and zoom into the style, so no coordinate of Serbia is
      // written down in this file.
      ...(start === null ? {} : { center: [start.center.lon, start.center.lat], zoom: start.zoom }),
      // The ODbL credit is drawn by this page, in the app's own type and
      // tokens, and it is drawn ALWAYS — see `.maps__attribution` in the render.
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;
    map.on("load", () => addMapLayers(map));
    // The camera readout and the scale bar follow every movement.
    const onMove = (): void => {
      const center = map.getCenter();
      setCamera({ lat: center.lat, lon: center.lng });
      const bar = scaleBar(map.getZoom(), center.lat, SCALE_MAX_PX, "en");
      setScale({ metres: bar.metres, pixels: bar.pixels });
    };
    map.on("move", onMove);
    return () => {
      map.off("move", onMove);
      map.remove();
      mapRef.current = null;
      setScale(null);
      setCamera(null);
    };
  }, [styleReady]);

  // A theme switch swaps the style in place, and the pins' colours have to be
  // re-read from the palette afterwards: MapLibre has no way to ask CSS.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const map = mapRef.current;
    const style = styleRef.current;
    if (map === null || style === null) return;
    map.setStyle(style as MapStyleOption);
    map.once("styledata", () => addMapLayers(map));
  }, [theme]);

  // The sources this page owns, kept in step with what main said.
  useEffect(() => {
    setData(mapRef.current, PINS_SOURCE, pinsFeatureCollection(pins));
  }, [pins]);

  useEffect(() => {
    setData(mapRef.current, SELECTED_SOURCE, selectedPinCollection(pins, selectedId));
  }, [pins, selectedId]);

  useEffect(() => {
    setData(mapRef.current, LOCATION_SOURCE, locationFeatureCollection(view?.location ?? null));
  }, [view?.location]);

  useEffect(() => {
    setData(mapRef.current, MEASURE_POINT_SOURCE, measurePointCollection(measurePoints));
    setData(mapRef.current, MEASURE_LINE_SOURCE, measureLineCollection(measurePoints));
  }, [measurePoints]);

  // A click on the map: measuring adds a point, a pin under the pointer is a
  // SELECTION, and anywhere else clears it.
  //
  // The pin dialog is deliberately not consulted here. It is a modal overlay
  // that covers the whole window, so a click while it is open never reaches the
  // map at all — and a pin is therefore placed where the map is looking when
  // the dialog opens. That is why the dialog says so in its own words rather
  // than promising a click that cannot arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    const onClick = (event: MapMouseEvent): void => {
      const point: GeoPoint = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      if (measuring) {
        setMeasurePoints((current) => [...current, point]);
        return;
      }
      // A pin under the pointer is a SELECTION, not a map click: the layer's
      // own handler would fire beside this one and the two answers would
      // disagree, so the question is asked once, here.
      const hit = map.queryRenderedFeatures(event.point, { layers: [PINS_LAYER] })[0];
      if (hit !== undefined && typeof hit.id === "string") {
        setSelectedId(hit.id);
        setListOpen(true);
        return;
      }
      setSelectedId(null);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [measuring]);

  // --- The search worker ---------------------------------------------------

  useEffect(() => {
    const worker = new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const answer = event.data;
      if (answer.type === "ready") {
        setSearch((current) => ({ ...current, status: "ready" }));
        return;
      }
      if (answer.type === "failed") {
        setSearch({ status: "failed", query: "", results: [] });
        return;
      }
      // An answer for a query the user has already typed past is dropped: the
      // box shows what was asked for last, never what came back last.
      if (answer.id !== searchId.current) return;
      setSearch((current) => ({
        status: "ready",
        query: current.query,
        results: answer.hits.map((hit) => hit.place),
      }));
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const askSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed === "") {
      // A cleared box asks nothing: the answer that would arrive is "everything
      // matches nothing", and drawing it would be a list of nothing under an
      // empty field.
      searchId.current += 1;
      setSearch((current) => ({ ...current, query, results: [] }));
      return;
    }
    searchId.current += 1;
    setSearch((current) => ({ ...current, query, results: [] }));
    const request: SearchRequest = {
      type: "search",
      id: searchId.current,
      query: trimmed,
      limit: SEARCH_LIMIT,
    };
    workerRef.current?.postMessage(request);
  }, []);

  const selectResult = useCallback((place: MapPlace) => {
    // `jumpTo`, not `flyTo`: the camera moves because the user asked where a
    // place is, and a glide nobody requested is motion this app must not add.
    mapRef.current?.jumpTo({ center: [place.lon, place.lat], zoom: 12 });
    setSelectedId(null);
    setSearch((current) => ({ ...current, query: place.name, results: [] }));
  }, []);

  const copyCoordinates = useCallback(async (point: GeoPoint) => {
    const both = formatCoordinates(point, activeLocale());
    try {
      await navigator.clipboard.writeText(`${both.decimal}\n${both.dms}`);
      setFeedback(copy.tools.copied);
    } catch (failure) {
      setFeedback(copy.tools.copyFailed);
      console.error("Nexus: the coordinates could not be copied:", failure);
    }
  }, []);

  useEffect(() => {
    if (feedback === null) return;
    const handle = window.setTimeout(() => setFeedback(null), 2000);
    return () => window.clearTimeout(handle);
  }, [feedback]);

  // Escape closes what this page opened, in the order a person would: the
  // dialog first (it owns the keyboard while it is open), then the pin list,
  // then the measurement.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dialog !== null) return; // the dialog's own handler closes it
      if (listOpen) {
        setListOpen(false);
        return;
      }
      if (measuring) setMeasuring(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, listOpen, measuring]);

  const measuredMetres = measureMetres(measurePoints, haversineMetres);
  const cursor: GeoPoint = dialog?.point ?? camera ?? { lat: 0, lon: 0 };
  const coordinates = formatCoordinates(cursor, locale);

  return (
    <div className="maps">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it (ADR-090). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="globe"
      />
      {error !== null && (
        <p className="maps__error" role="alert">
          {error}
        </p>
      )}

      {pack.status === "loading" && <LoadingState label={copy.page.loading} rows={4} />}
      {pack.status === "missing" && (
        <EmptyState
          variant="inline"
          sigil="globe"
          title={copy.pack.title}
          description={copy.pack.body}
        />
      )}
      {pack.status === "style-broken" && (
        <EmptyState variant="inline" title={copy.pack.styleTitle} description={copy.pack.styleBody} />
      )}
      {pack.status === "network" && (
        <EmptyState
          variant="inline"
          title={copy.pack.styleTitle}
          description={copy.pack.networkBody}
        />
      )}
      {search.status === "failed" && (
        <p className="maps__error" role="alert">
          {copy.pack.placesBody}
        </p>
      )}

      {pack.status === "ready" && (
        <>
          <div className="maps__tools">
            <div className="maps__search">
              <TextField
                label={copy.search.label}
                placeholder={copy.search.placeholder}
                value={search.query}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => askSearch(event.target.value)}
              />
              {search.status === "loading" && <p className="nx-hint">{copy.search.loading}</p>}
              {search.status !== "loading" && search.query.trim() !== "" && (
                <ul className="maps__results" aria-label={copy.search.results}>
                  {search.results.length === 0 && (
                    <li className="maps__result-empty">
                      <span className="nx-hint">{copy.search.empty}</span>
                    </li>
                  )}
                  {search.results.map((place) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        className="maps__result"
                        onClick={() => selectResult(place)}
                      >
                        <span className="maps__result-name">{place.name}</span>
                        <span className="maps__result-kind">
                          {place.kind}
                          {place.population === null
                            ? ""
                            : ` · ${formatPopulation(place.population, locale)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="maps__buttons">
              <Button size="sm" onClick={() => mapRef.current?.zoomIn()}>
                {copy.tools.zoomIn}
              </Button>
              <Button size="sm" onClick={() => mapRef.current?.zoomOut()}>
                {copy.tools.zoomOut}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (camera === null) return;
                  setDialog({ mode: "create", point: camera });
                }}
              >
                {copy.tools.newPin}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (camera === null) return;
                  // The input the Devices run will fill from a serial GPS is
                  // reachable today, from this button: a laptop with no
                  // receiver can still say where it is, and the marker and the
                  // "clear it" control are the same ones a GPS would use.
                  void run((maps) =>
                    maps.setLocation({ profileId, lat: camera.lat, lon: camera.lon }),
                  );
                }}
              >
                {copy.tools.here}
              </Button>
              {view?.location != null && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => void run((maps) => maps.clearLocation({ profileId }))}
                >
                  {copy.tools.clearLocation}
                </Button>
              )}
              <Button
                size="sm"
                aria-pressed={measuring}
                onClick={() => setMeasuring((current) => !current)}
              >
                {measuring ? copy.tools.stopMeasure : copy.tools.measure}
              </Button>
              {measurePoints.length > 0 && (
                <Button size="sm" variant="quiet" onClick={() => setMeasurePoints([])}>
                  {copy.tools.clearMeasure}
                </Button>
              )}
              <Button size="sm" onClick={() => void copyCoordinates(cursor)}>
                {copy.tools.copy}
              </Button>
              <Button
                size="sm"
                aria-pressed={listOpen}
                onClick={() => setListOpen((current) => !current)}
              >
                {listOpen ? copy.pins.hide : copy.tools.pins}
              </Button>
            </div>
          </div>

          <p className="nx-hint maps__readout" aria-live="polite">
            <span className="maps__readout-cell">
              {coordinates.decimal} · {coordinates.dms}
            </span>
            {measuring && (
              <span className="maps__readout-cell">
                {copy.pins.distance}: {formatDistanceMetres(measuredMetres, locale)} (
                {formatDistanceKilometres(measuredMetres, locale)})
              </span>
            )}
            {feedback !== null && <span className="maps__readout-cell">{feedback}</span>}
          </p>

          <div className="maps__frame">
            <div className="maps__canvas" ref={containerRef} />
            {measuring && <p className="maps__hint nx-hint">{copy.pins.measureHint}</p>}
            {scale !== null && (
              <div className="maps__scale" role="img" aria-label={copy.tools.scale}>
                <div
                  className="maps__scale-bar"
                  style={{ width: `${String(scale.pixels)}px` }}
                  aria-hidden="true"
                />
                <span className="maps__scale-label">{formatDistanceShort(scale.metres, locale)}</span>
              </div>
            )}
            {/* The ODbL credit, at all times and never faded (see ADR-099): the
                licence requires the notice to be one a person looking at the
                map can understand, and a notice that hides itself after five
                seconds is exactly what a screenshot of this map gets wrong. The
                address is PRINTED rather than linked — this app refuses to open
                a URL from the renderer (ADR-089) — so it is readable and
                copyable, with no control that looks like a link and does
                nothing. */}
            <p className="maps__attribution" aria-label={copy.attribution.label}>
              {copy.attribution.credit} · {copy.attribution.licence}
            </p>
            {listOpen && (
              <PinList
                pins={pins}
                selectedId={selectedId}
                onSelect={(pin) => {
                  setSelectedId(pin.id);
                  mapRef.current?.jumpTo({ center: [pin.lon, pin.lat], zoom: 14 });
                }}
                onEdit={(pin) => setDialog({ mode: "edit", pin, point: { lat: pin.lat, lon: pin.lon } })}
                onRemove={(pin) => {
                  setSelectedId(null);
                  void run((maps) => maps.removePin({ profileId, id: pin.id }));
                }}
              />
            )}
          </div>
        </>
      )}

      {dialog !== null && (
        <PinDialog
          profileId={profileId}
          state={dialog}
          onCancel={() => setDialog(null)}
          onSaved={(next) => {
            setDialog(null);
            setView(next);
          }}
        />
      )}
    </div>
  );
}

/**
 * The layers this page adds to whatever style the pack carries: the pins, the
 * selected pin's ring, where the machine is, and the measurement.
 *
 * **Added after every `load` and after every `styledata`.** `setStyle` throws
 * every layer and source away, so this is called again rather than the layers
 * being readded by hand at one call site. Every `addSource`/`addLayer` below is
 * guarded by the getters above it, which is what makes it safe to call twice.
 */
function addMapLayers(map: MapLibreMap): void {
  if (map.getSource(PINS_SOURCE) === undefined) {
    map.addSource(PINS_SOURCE, {
      type: "geojson",
      data: emptyCollection() as GeoJsonData,
      promoteId: "id",
    });
    map.addSource(SELECTED_SOURCE, { type: "geojson", data: emptyCollection() as GeoJsonData });
    map.addSource(LOCATION_SOURCE, { type: "geojson", data: emptyCollection() as GeoJsonData });
    map.addSource(MEASURE_POINT_SOURCE, {
      type: "geojson",
      data: emptyCollection() as GeoJsonData,
    });
    map.addSource(MEASURE_LINE_SOURCE, { type: "geojson", data: emptyCollection() as GeoJsonData });
  }
  // The palette is read ONCE per pass and baked into the expression, which is
  // why a theme change calls this again: MapLibre cannot ask CSS for a colour.
  const colours = pinColourExpression(swatchValue);
  if (map.getLayer(MEASURE_LINE_LAYER) === undefined) {
    map.addLayer({
      id: MEASURE_LINE_LAYER,
      type: "line",
      source: MEASURE_LINE_SOURCE,
      paint: {
        "line-color": tokenValue("--nx-accent"),
        "line-width": 2,
        "line-dasharray": [2, 1.5],
      },
    });
  }
  if (map.getLayer(PINS_LAYER) === undefined) {
    map.addLayer({
      id: PINS_LAYER,
      type: "circle",
      source: PINS_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": tokenValue("--nx-surface-raised"),
      },
    });
  }
  map.setPaintProperty(PINS_LAYER, "circle-color", colours as PaintValue);
  if (map.getLayer(SELECTED_LAYER) === undefined) {
    map.addLayer({
      id: SELECTED_LAYER,
      type: "circle",
      source: SELECTED_SOURCE,
      paint: {
        // A RING rather than a second dot: the selected pin keeps its own
        // colour and gains a statement that says "this one".
        "circle-radius": 11,
        "circle-color": "transparent",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": tokenValue("--nx-text"),
      },
    });
  }
  if (map.getLayer(LOCATION_LAYER) === undefined) {
    map.addLayer({
      id: LOCATION_LAYER,
      type: "circle",
      source: LOCATION_SOURCE,
      paint: {
        "circle-radius": 6,
        "circle-color": tokenValue("--nx-data"),
        "circle-stroke-width": 2.5,
        "circle-stroke-color": tokenValue("--nx-surface-raised"),
      },
    });
  }
  if (map.getLayer(MEASURE_POINT_LAYER) === undefined) {
    map.addLayer({
      id: MEASURE_POINT_LAYER,
      type: "circle",
      source: MEASURE_POINT_SOURCE,
      paint: {
        "circle-radius": 4,
        "circle-color": tokenValue("--nx-accent"),
        "circle-stroke-width": 1.5,
        "circle-stroke-color": tokenValue("--nx-surface-raised"),
      },
    });
  }
}

/** Data into one source, if the map and the source both exist yet. */
function setData(map: MapLibreMap | null, sourceId: string, data: unknown): void {
  const source = map?.getSource(sourceId);
  if (source instanceof GeoJSONSource) source.setData(data as GeoJsonData);
}

/** A population through `Intl`, so a Serbian reading groups with a dot: `1.197.714`. */
function formatPopulation(population: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(population);
}
