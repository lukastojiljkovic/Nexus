import { useCallback, useEffect, useRef, useState } from "react";
import { GeoJSONSource, MapLibreMap, addProtocol, type MapMouseEvent, type MapOptions } from "maplibre-gl";
import { PMTiles } from "pmtiles";
import { Button, LoadingState, PageHeader, TextField } from "@nexus/ui";
import {
  formatCoordinates,
  formatDistanceKilometres,
  formatDistanceMetres,
  formatDistanceShort,
  haversineMetres,
  scaleBar,
  type GeoPoint,
  type MapPlace,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import {
  MAP_REGION_DETAILS,
  type MapRegionView,
  type MapRegionsView,
  type MapsPinView,
  type MapsView,
} from "../shared/ipc.js";
import { regionById, type WorldBounds } from "../shared/world/outline.js";
import { copy } from "./copy.js";
import {
  locationFeatureCollection,
  measureLineCollection,
  measureMetres,
  measurePointCollection,
  pinColourExpression,
  pinsFeatureCollection,
  selectedPinCollection,
  type MapLineCollection,
  type MapPointCollection,
} from "./mapData.js";
import { PinDialog, type DialogState } from "./PinDialog.js";
import { PinList } from "./PinList.js";
import { REGION_TILE_SCHEME, createRegionTiles } from "./regionTiles.js";
import { RegionCard } from "./regions/RegionCard.js";
import type { Locale } from "./regions/names.js";
import { coverBounds, installedTerritories } from "./regions/scope.js";
import { SEARCH_START, answeredWith, askedFor, pickedPlace, shownResults, type SearchState } from "./searchState.js";
import type { SearchMessage, SearchResponse } from "./searchWorker.js";
import {
  OUTLINE_LAND_LAYER,
  PICK_INSTALLED_LAYER,
  PICK_SELECTED_LAYER,
  fontStack,
  installedFilter,
  regionStyle,
  selectedFilter,
} from "./style.js";
// The renderer's own stylesheet, and the ONLY third-party CSS in this module.
// MapLibre positions its canvas container and its overlay panes from these
// rules, and no amount of styling by this app can replace them: the classes are
// the renderer's internals rather than a public contract, so a module that
// restated them would break on the next MapLibre minor. Nothing in this module
// uses a MapLibre control, so what arrives is one canvas and no chrome.
import "maplibre-gl/dist/maplibre-gl.css";
import "./mapLibre.js";
import "./maps.css";

/**
 * MAPE (ADR-099, ADR-118) — the offline map.
 *
 * **The machine owns the map; the page owns the profile's marks on it.** The
 * map is the regions downloaded on this machine, read through `nx-map://` and
 * drawn with a style this page builds from the app's own tokens (`style.ts`),
 * over the bundled world outline. What the page draws besides is what belongs
 * to the PROFILE: its pins, where this machine is, and a measurement the user
 * is taking right now. A region is replaced by updating it, and a pin is the
 * user's own mark that survives every update.
 *
 * **The map is also where a region is chosen.** With the picker on, a click on
 * a territory opens its card, which downloads it, its continent or the world
 * at a chosen detail. The picker is on by itself while nothing is downloaded,
 * because the outline is then all there is to look at.
 *
 * **Nothing here animates.** The map opens on the most detailed region on this
 * machine, or on the world, and moves only by a gesture or an explicit
 * control; selecting a search result JUMPS rather than flies (`jumpTo`, not
 * `flyTo`), because a camera that glides for a second and a half is motion
 * nobody asked for. `prefers-reduced-motion` is respected by having nothing to
 * reduce, which is a stronger answer than a flag that switches off one effect
 * and leaves the rest.
 *
 * **Every failure is a sentence and a next step.** A region list that would not
 * load, a download that stopped, an index that would not be read: each draws
 * its own line naming what failed and what to do about it, and none shows an
 * exception.
 */

/** The layer and source ids this page adds to the regions' style. */
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

/** The world as the map frames it: every inhabited latitude, without the empty poles. */
const WORLD: WorldBounds = { minLon: -180, minLat: -58, maxLon: 180, maxLat: 78 };

/** The room left around a region the camera is fitted to, in pixels. */
const FIT_PADDING = 32;

/** What the page draws when the regions could not be listed: the outline, and nothing on it. */
const NO_REGIONS: MapRegionsView = { installed: [], job: null, newestBuild: null };

/**
 * MapLibre's own types for the things this module builds as plain data.
 *
 * A GeoJSON feature collection and an expression are JSON — that is the point of
 * both formats — and MapLibre's declarations for them are unions of tuple types
 * that a variable-length array cannot be PROVED to be: `@types/geojson` and the
 * style spec's `ExpressionSpecification` are exported by neither package, so the
 * only honest spelling is a cast at the boundary. What makes it safe is that
 * they are all in this file, and `mapData.test.ts` and `style.test.ts` assert
 * the exact objects they carry.
 */
type GeoJsonData = Parameters<GeoJSONSource["setData"]>[0];

/**
 * The one GeoJSON cast. It goes through `unknown` because this module's
 * collections are readonly and `@types/geojson`'s arrays are not; MapLibre reads
 * the data it is handed and never writes to it.
 */
function geoJson(data: MapPointCollection | MapLineCollection): GeoJsonData {
  return data as unknown as GeoJsonData;
}
/** `never` because the paint value's own union is unnameable here — see the note above. */
type PaintValue = never;
/** `never` for the same reason: a filter is an expression. */
type FilterValue = never;

/** The theme the map is drawn for, read off the document the shell already drives. */
function currentTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? "";
}

/** The live value of one design token. MapLibre paints from values, not from CSS variables. */
function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `--nx-swatch-<id>` for one pin colour: the palette's own name for it. */
function swatchValue(color: MapsPinView["color"]): string {
  return tokenValue(`--nx-swatch-${color}`);
}

/**
 * The regions' tiles, once per renderer process: the tile scheme is registered
 * once (`addProtocol` would throw on a second call), and the archives it reads
 * stay open across visits to the page.
 */
const regionTiles = createRegionTiles((url) => new PMTiles(url));
let regionSchemeRegistered = false;
function ensureRegionScheme(): void {
  if (regionSchemeRegistered) return;
  addProtocol(REGION_TILE_SCHEME, async (request, abort) => ({
    data: await regionTiles.tile(request.url, abort.signal),
  }));
  regionSchemeRegistered = true;
}

/** The style for what is installed, painted from the document's live tokens. */
function buildStyle(installed: readonly MapRegionView[], locale: Locale): NonNullable<MapOptions["style"]> {
  return regionStyle({
    token: (name) => tokenValue(`--nx-${name}`),
    fonts: fontStack(tokenValue("--nx-font-family-ui")),
    locale,
    sources: regionTiles.set(installed),
  });
}

/** What a style was built from: a change in any of it is a new style. */
function styleKey(theme: string, locale: Locale, installed: readonly MapRegionView[]): string {
  return [theme, locale, ...installed.map((region) => region.url)].join("|");
}

/** The box the map opens on: the most detailed region on this machine, or the world. */
function openingBounds(installed: readonly MapRegionView[]): WorldBounds {
  const rank = (region: MapRegionView) => MAP_REGION_DETAILS.indexOf(region.detail);
  const best = [...installed].sort((left, right) => rank(right) - rank(left))[0];
  return (best === undefined ? null : coverBounds(best.id)) ?? WORLD;
}

function lngLatBox(box: WorldBounds): [[number, number], [number, number]] {
  return [
    [box.minLon, box.minLat],
    [box.maxLon, box.maxLat],
  ];
}

/** The page's own sources, as they should read now. */
interface Overlay {
  readonly pins: MapPointCollection;
  readonly selected: MapPointCollection;
  readonly location: MapPointCollection;
  readonly measurePoints: MapPointCollection;
  readonly measureLine: MapLineCollection;
}

/** What the picker draws: whether it is on, which territories are installed, and which one the card is open for. */
interface PickState {
  readonly on: boolean;
  readonly installed: readonly string[];
  readonly selected: string | null;
}

type Run = (action: (maps: typeof window.nexus.modules.maps) => Promise<MapsView>) => Promise<void>;

export default function MapsPage({ profileId }: ModulePageProps) {
  const locale = activeLocale();
  const [view, setView] = useState<MapsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<MapRegionsView | null>(null);
  const [theme, setTheme] = useState(() => currentTheme());
  /** `null` until the person switches it: the picker then follows whether anything is installed. */
  const [picking, setPicking] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<readonly GeoPoint[]>([]);
  const [camera, setCamera] = useState<GeoPoint | null>(null);
  const [scale, setScale] = useState<{ metres: number; pixels: number } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>(SEARCH_START);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** The newest question sent to the worker: an answer for an older one is stale and dropped. */
  const searchId = useRef(0);

  const pins = view?.pins ?? [];
  const installed = regions?.installed ?? null;
  const installedKey = installed?.map((region) => region.url).join("|") ?? null;
  const pickingOn = !measuring && (picking ?? installed?.length === 0);
  const results = shownResults(search);
  const pickedTerritory = picked === null ? undefined : regionById(picked);

  /**
   * What the map's own layers should show, always from the last render.
   *
   * A new style throws every source and layer away, the page's own included,
   * and they are added again on its `style.load`. That handler is registered
   * once, when the map is made, so it reads these refs rather than a closure
   * from that first render, which would put back the pins of an hour ago.
   */
  const overlayRef = useRef<Overlay | null>(null);
  overlayRef.current = {
    pins: pinsFeatureCollection(pins),
    selected: selectedPinCollection(pins, selectedId),
    location: locationFeatureCollection(view?.location ?? null),
    measurePoints: measurePointCollection(measurePoints),
    measureLine: measureLineCollection(measurePoints),
  };
  const pickRef = useRef<PickState>({ on: false, installed: [], selected: null });
  pickRef.current = {
    on: pickingOn,
    installed: installedTerritories(installed?.map((region) => region.id) ?? []),
    selected: picked,
  };
  const installedRef = useRef(installed);
  installedRef.current = installed;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  /** What the map's current style was built from. */
  const appliedStyle = useRef<string | null>(null);

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

  // --- The regions on this machine (main's side) ---------------------------

  const loadRegions = useCallback(async () => {
    try {
      setRegions(await window.nexus.modules.maps.regions({}));
    } catch (failure) {
      setRegions((current) => current ?? NO_REGIONS);
      setError(copy.errors.regions);
      console.error("Nexus: the map regions could not be listed:", failure);
    }
  }, []);

  useEffect(() => {
    void loadRegions();
  }, [loadRegions]);

  // A download reports through the list it changes, read once a second while
  // it runs: the way the wiki follows a ZIM download.
  const jobRunning = regions?.job?.state === "measuring" || regions?.job?.state === "downloading";
  useEffect(() => {
    if (!jobRunning) return;
    const handle = window.setInterval(() => void loadRegions(), 1000);
    return () => window.clearInterval(handle);
  }, [jobRunning, loadRegions]);

  // The shell drives `<html data-theme>`, and MapLibre paints from values, not
  // from CSS variables, so a theme switch is a new style read from the tokens.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // --- The map -------------------------------------------------------------

  const listed = installed !== null;
  useEffect(() => {
    const regionsNow = installedRef.current;
    if (!listed || containerRef.current === null || regionsNow === null) return;
    ensureRegionScheme();
    appliedStyle.current = styleKey(themeRef.current, localeRef.current, regionsNow);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildStyle(regionsNow, localeRef.current),
      bounds: lngLatBox(openingBounds(regionsNow)),
      fitBoundsOptions: { padding: FIT_PADDING },
      // The ODbL credit is drawn by this page, in the app's own type and
      // tokens, and it is drawn ALWAYS — see `.maps__attribution` in the render.
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;
    // Every style, the first and each one after, gets the page's layers back.
    map.on("style.load", () => {
      if (overlayRef.current !== null) addMapLayers(map, overlayRef.current);
      applyPicking(map, pickRef.current);
    });
    // The camera readout and the scale bar follow every movement.
    const onMove = (): void => {
      const center = map.getCenter();
      setCamera({ lat: center.lat, lon: center.lng });
      const bar = scaleBar(map.getZoom(), center.lat, SCALE_MAX_PX, "en");
      setScale({ metres: bar.metres, pixels: bar.pixels });
    };
    map.on("move", onMove);
    onMove();
    return () => {
      map.off("move", onMove);
      map.remove();
      mapRef.current = null;
      appliedStyle.current = null;
      setScale(null);
      setCamera(null);
    };
  }, [listed]);

  // A new theme, language or set of regions is a new style. The camera stays
  // where the person left it.
  useEffect(() => {
    const map = mapRef.current;
    const regionsNow = installedRef.current;
    if (map === null || regionsNow === null) return;
    const key = styleKey(theme, locale, regionsNow);
    if (key === appliedStyle.current) return;
    appliedStyle.current = key;
    map.setStyle(buildStyle(regionsNow, locale), { diff: false });
  }, [theme, locale, installedKey]);

  useEffect(() => {
    if (mapRef.current !== null) applyPicking(mapRef.current, pickRef.current);
  }, [pickingOn, picked, installedKey]);

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

  // A click on the map: measuring adds a point, the picker opens the card of
  // the territory under the pointer, a pin under the pointer is a SELECTION,
  // and anywhere else clears it.
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
      if (pickingOn) {
        const id: unknown = map.queryRenderedFeatures(event.point, { layers: [OUTLINE_LAND_LAYER] })[0]?.properties
          .id;
        setPicked(typeof id === "string" ? id : null);
        // A click that opened a card keeps the picker on once something is installed.
        setPicking(true);
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
  }, [listed, measuring, pickingOn]);

  const showRegion = useCallback((id: string) => {
    mapRef.current?.fitBounds(lngLatBox(coverBounds(id) ?? WORLD), { padding: FIT_PADDING, animate: false });
  }, []);

  // --- The search worker ---------------------------------------------------

  useEffect(() => {
    const worker = new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const answer = event.data;
      if (answer.type === "ready") {
        setSearch((current) => ({ ...current, status: "ready", count: answer.count }));
        return;
      }
      if (answer.type === "failed") {
        setSearch({ ...SEARCH_START, status: "failed" });
        return;
      }
      // An answer for a query the user has already typed past is dropped: the
      // box shows what was asked for last, never what came back last.
      if (answer.id !== searchId.current) return;
      setSearch((current) => answeredWith(current, answer.hits.map((hit) => hit.place)));
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // The index is the installed regions' places, so it is read again when they change.
  useEffect(() => {
    const regionsNow = installedRef.current;
    if (regionsNow === null) return;
    setSearch((current) => ({ ...current, status: "loading" }));
    const message: SearchMessage = {
      type: "regions",
      regions: regionsNow.map(({ id, detail, url }) => ({ id, detail, url })),
    };
    workerRef.current?.postMessage(message);
  }, [installedKey]);

  const askSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    searchId.current += 1;
    setSearch((current) => askedFor(current, query));
    // A cleared box asks nothing: the answer that would arrive is "everything
    // matches nothing", and drawing it would be a list of nothing under an
    // empty field.
    if (trimmed === "") return;
    const request: SearchMessage = {
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
    setSearch((current) => pickedPlace(current, place.name));
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
  // then the region card, then the measurement.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dialog !== null) return; // the dialog's own handler closes it
      if (listOpen) {
        setListOpen(false);
        return;
      }
      if (picked !== null) {
        setPicked(null);
        return;
      }
      if (measuring) setMeasuring(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, listOpen, picked, measuring]);

  const measuredMetres = measureMetres(measurePoints, haversineMetres);
  const cursor: GeoPoint = dialog?.point ?? camera ?? { lat: 0, lon: 0 };
  const coordinates = formatCoordinates(cursor, locale);

  return (
    <div className="maps">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it (ADR-090). */}
      <PageHeader title={declaredText(manifest.copy?.name)} subtitle={copy.page.subtitle} sigil="globe" />
      {error !== null && (
        <p className="maps__error" role="alert">
          {error}
        </p>
      )}

      {regions === null && <LoadingState label={copy.page.loading} rows={4} />}
      {search.status === "failed" && (
        <p className="maps__error" role="alert">
          {copy.search.failed}
        </p>
      )}

      {regions !== null && (
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
              {search.status === "ready" && regions.installed.length === 0 && (
                <p className="nx-hint">{copy.search.none}</p>
              )}
              {results !== null && (
                <ul className="maps__results" aria-label={copy.search.results}>
                  {results.length === 0 && (
                    <li className="maps__result-empty">
                      <span className="nx-hint">{copy.search.empty}</span>
                    </li>
                  )}
                  {results.map((place) => (
                    <li key={place.id}>
                      <button type="button" className="maps__result" onClick={() => selectResult(place)}>
                        <span className="maps__result-name">
                          {locale === "en" ? (place.nameEn ?? place.name) : place.name}
                        </span>
                        <span className="maps__result-kind">
                          {copy.search.kinds[place.kind]}
                          {place.population === null ? "" : ` · ${formatPopulation(place.population, locale)}`}
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
                aria-pressed={pickingOn}
                onClick={() => {
                  setPicking(!pickingOn);
                  setMeasuring(false);
                }}
              >
                {copy.tools.regions}
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
                  void run((maps) => maps.setLocation({ profileId, lat: camera.lat, lon: camera.lon }));
                }}
              >
                {copy.tools.here}
              </Button>
              {view?.location != null && (
                <Button size="sm" variant="quiet" onClick={() => void run((maps) => maps.clearLocation({ profileId }))}>
                  {copy.tools.clearLocation}
                </Button>
              )}
              <Button size="sm" aria-pressed={measuring} onClick={() => setMeasuring((current) => !current)}>
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
              <Button size="sm" aria-pressed={listOpen} onClick={() => setListOpen((current) => !current)}>
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
            {pickingOn && pickedTerritory === undefined && (
              <p className="maps__hint nx-hint">
                {regions.installed.length === 0 ? copy.picker.empty : copy.picker.hint}
              </p>
            )}
            {pickedTerritory !== undefined && (
              <div className="maps__card">
                <RegionCard
                  territory={pickedTerritory}
                  regions={regions}
                  api={window.nexus.modules.maps}
                  onChange={setRegions}
                  onShow={showRegion}
                  onClose={() => setPicked(null)}
                />
              </div>
            )}
            {scale !== null && (
              <div className="maps__scale" role="img" aria-label={copy.tools.scale}>
                <div className="maps__scale-bar" style={{ width: `${String(scale.pixels)}px` }} aria-hidden="true" />
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
                  setSelectedId(pin?.id ?? null);
                  if (pin !== null) mapRef.current?.jumpTo({ center: [pin.lon, pin.lat], zoom: 14 });
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

/** The picker's tint and outline, shown or hidden, with the territories they draw. */
function applyPicking(map: MapLibreMap, pick: PickState): void {
  if (map.getLayer(PICK_INSTALLED_LAYER) === undefined) return;
  map.setFilter(PICK_INSTALLED_LAYER, installedFilter(pick.installed) as FilterValue);
  map.setFilter(PICK_SELECTED_LAYER, selectedFilter(pick.selected) as FilterValue);
  map.setLayoutProperty(PICK_INSTALLED_LAYER, "visibility", pick.on ? "visible" : "none");
  map.setLayoutProperty(PICK_SELECTED_LAYER, "visibility", pick.selected === null ? "none" : "visible");
}

/**
 * The layers this page adds to the regions' style: the pins, the selected
 * pin's ring, where the machine is, and the measurement.
 *
 * **Added after every `style.load`.** A new style throws every layer and source
 * away, so this runs again for each one, with the data the page holds now.
 */
function addMapLayers(map: MapLibreMap, overlay: Overlay): void {
  map.addSource(PINS_SOURCE, { type: "geojson", data: geoJson(overlay.pins), promoteId: "id" });
  map.addSource(SELECTED_SOURCE, { type: "geojson", data: geoJson(overlay.selected) });
  map.addSource(LOCATION_SOURCE, { type: "geojson", data: geoJson(overlay.location) });
  map.addSource(MEASURE_POINT_SOURCE, { type: "geojson", data: geoJson(overlay.measurePoints) });
  map.addSource(MEASURE_LINE_SOURCE, { type: "geojson", data: geoJson(overlay.measureLine) });
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
  map.addLayer({
    id: PINS_LAYER,
    type: "circle",
    source: PINS_SOURCE,
    paint: {
      "circle-radius": 7,
      // The palette is read here and baked into the expression, which is why a
      // theme's new style calls this again: MapLibre cannot ask CSS for a colour.
      "circle-color": pinColourExpression(swatchValue) as PaintValue,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": tokenValue("--nx-surface-raised"),
    },
  });
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

/** Data into one source, if the map and the source both exist yet. */
function setData(map: MapLibreMap | null, sourceId: string, data: MapPointCollection | MapLineCollection): void {
  const source = map?.getSource(sourceId);
  if (source instanceof GeoJSONSource) source.setData(geoJson(data));
}

/** A population through `Intl`, so a Serbian reading groups with a dot: `1.197.714`. */
function formatPopulation(population: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(population);
}
