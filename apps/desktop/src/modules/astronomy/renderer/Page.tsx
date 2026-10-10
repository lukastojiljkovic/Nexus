import { useCallback, useEffect, useMemo, useState } from "react";
import {
  computerZone,
  dayNightAt,
  type BodyId,
  type LatLon,
  type OrbitPath,
  type SolarSystemSnapshot,
  solarSystemAt,
} from "@nexus/core";
import { Button, Card, PageHeader, TextField } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import {
  dateTimeFormat,
  declaredText,
  numberFormat,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { fill } from "../../../renderer/src/strings.js";
import type { AstronomyPacksView } from "../shared/ipc.js";
import { manifest } from "../shared/manifest.js";
import {
  datetimeLocalValue,
  fixedClock,
  isFollowing,
  nowClock,
  parseDatetimeLocal,
  tickClock,
  type SkyClock,
} from "./clock.js";
import { copy } from "./copy.js";
import { EarthDayNightMap } from "./earth/EarthDayNightMap.js";
import {
  ASTRONOMY_DEFAULTS,
  persistAstronomyPrefs,
  readAstronomyPrefs,
  resolveObserver,
  type AstronomyPrefs,
} from "./prefs.js";
import { bodyLabel } from "./solar/bodies.js";
import { textureCredits } from "./solar/credit.js";
import { orbitPaths } from "./solar/orbits.js";
import { type SolarScale } from "./solar/scale.js";
import { SolarSystemView } from "./solar/SolarSystemView.js";
import type { PlanetTextures } from "./solar/textures.js";
import { StarMap } from "./stars/StarMap.js";
import { PlacePicker } from "./sunmoon/PlacePicker.js";
import { SunMoonPanel } from "./sunmoon/SunMoonPanel.js";
import "./astronomy.css";

/**
 * ASTRONOMIJA (ADR-090 / ADR-109) — the four views wave 1 built as components,
 * assembled around one page, one instant and one place.
 *
 * **One clock, and it is the page's.** Every view here answers a question about
 * an instant: where the planets are, where it is day, what is overhead, when
 * the Sun rises. `clock.ts` holds that instant once and the page hands it to all
 * four, so the corner cannot disagree with itself — which is the whole reason
 * the four are one module rather than four.
 *
 * **One place, and it is a device preference.** The default is the principal
 * city of this computer's zone, and a picked place overrides it
 * (`prefs.ts`); the same value feeds the map, the star chart, the panel and the
 * settings card, so there is no second idea of where "here" is.
 *
 * **What the module reads from main is one pack.** `packs` answers the
 * planet-textures layout with `nx-pack://` addresses; everything else on this
 * page is computed from `@nexus/core` in the renderer. Without the pack the
 * corner still works — the solar view draws plain coloured bodies and the map
 * falls back to its shipped coastline — and the page says which pack adds the
 * photographs.
 *
 * **Only the visible view draws.** The page holds one tab at a time, and the 3D
 * view additionally stops painting when it is off screen or the window is
 * hidden (see `SolarSystemView`), so a clock ticking behind three hidden views
 * costs arithmetic rather than frames.
 */

const TABS = ["solar", "earth", "stars", "sunmoon"] as const;

type TabId = (typeof TABS)[number];

/**
 * How long the orbit paths are reused before they are rebuilt.
 *
 * 10 minutes, and the number is about the SCENE GRAPH rather than astronomy:
 * `SolarSystemView` rebuilds its graph when the `orbits` array's identity
 * changes, so a fresh array per tick would reallocate every geometry and
 * material once a second. Ten minutes of planetary motion moves a drawn path by
 * far less than a pixel, and the Moon's loop — the one path whose phase matters
 * — is re-sampled from that same truncated instant, so its dot sits within
 * 8.7e-5 of a unit of its line (measured over a swept month and window in
 * `solar/orbits.test.ts`), which is under a ten-thousandth of its drawn radius.
 */
const ORBIT_REFRESH_MS = 600_000;

export default function AstronomyPage({ profileId }: ModulePageProps) {
  const [tab, setTab] = useState<TabId>("solar");
  const [clock, setClock] = useState<SkyClock>(() => nowClock(Date.now()));
  const [prefs, setPrefs] = useState<AstronomyPrefs>(() => readAstronomyPrefs(profileId));
  const [packs, setPacks] = useState<AstronomyPacksView | null>(null);
  const [scale, setScale] = useState<SolarScale>("readable");
  const [selected, setSelected] = useState<BodyId | null>(null);
  const [nightMode, setNightMode] = useState(false);

  /** The machine's zone: read once, because the default place and the panel's clock note both come from it. */
  const zone = useMemo(() => computerZone(), []);
  const observer = resolveObserver(prefs.place, zone);

  /**
   * The one tick, and it runs whether or not the clock is following the
   * machine: `tickClock` answers the SAME object for a pinned clock, so React
   * bails out of that update and the interval costs a comparison. Guarding the
   * effect on the mode instead would tear the interval down and rebuild it on
   * every tick, which is how a one-second clock quietly becomes a slower one.
   */
  useEffect(() => {
    const handle = setInterval(() => {
      setClock((current) => tickClock(current, Date.now()));
    }, 1000);
    return () => {
      clearInterval(handle);
    };
  }, []);

  /**
   * The installed pack's layout, read once per open.
   *
   * A failed read is not a screen: the corner works without the pack, so the
   * error is logged and the view stays the textureless one rather than the page
   * refusing to draw. The read is repeated when the tab changes to a view that
   * uses the pack, which is what lets a user install it in another window and
   * see it here without restarting the app.
   */
  const readPacks = useCallback(async (): Promise<void> => {
    try {
      setPacks(await window.nexus.modules.astronomy.packs({}));
    } catch (failure) {
      console.error("Nexus: the planet textures pack could not be read:", failure);
    }
  }, []);

  useEffect(() => {
    void readPacks();
  }, [readPacks]);

  // A read that failed is retried when a view that uses the pack comes back on
  // screen; a read that answered is not repeated, because the answer is a file
  // on disk rather than something that changes under the page.
  useEffect(() => {
    if (tab !== "solar" && tab !== "earth") return;
    if (packs !== null) return;
    void readPacks();
  }, [readPacks, tab, packs]);

  const snapshot = useMemo(() => solarSystemAt(clock.instantMs), [clock.instantMs]);
  const dayNight = useMemo(() => dayNightAt(clock.instantMs), [clock.instantMs]);
  const orbitEpoch = Math.floor(clock.instantMs / ORBIT_REFRESH_MS);
  const orbits = useMemo(
    () => orbitPaths(orbitEpoch * ORBIT_REFRESH_MS),
    [orbitEpoch],
  );
  const textures = packs?.textures ?? null;
  const earthTextures = textures?.bodies.earth ?? null;

  function changePlace(point: LatLon | null): void {
    const next: AstronomyPrefs = { ...ASTRONOMY_DEFAULTS, place: point };
    setPrefs(next);
    persistAstronomyPrefs(profileId, next);
  }

  return (
    <div className="astronomy">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, so the rail and this header cannot disagree. */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="planet"
      />
      <ClockBar clock={clock} onChange={setClock} />
      {/* The app's own segmented recipe: buttons whose state is `aria-pressed`,
          so what is announced and what is painted cannot drift. */}
      <div
        className="astronomy__tabs"
        role="group"
        aria-label={declaredText(manifest.copy?.name)}
      >
        {TABS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "primary" : "ghost"}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
            }}
          >
            {copy.tabs[id]}
          </Button>
        ))}
      </div>

      {tab !== "solar" && (
        <PlacePicker observer={observer} zone={zone} onChange={changePlace} />
      )}

      {tab === "solar" && (
        <SolarSection
          snapshot={snapshot}
          orbits={orbits}
          textures={textures}
          packsRead={packs !== null}
          scale={scale}
          onScale={setScale}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      {tab === "earth" && (
        <EarthDayNightMap
          dayNight={dayNight}
          observer={observer}
          textures={
            earthTextures === null
              ? null
              : { day: earthTextures.day, night: earthTextures.night }
          }
        />
      )}
      {tab === "stars" &&
        (observer === null ? (
          <Card className="astronomy__card">
            <p className="nx-hint">{copy.stars.needPlace}</p>
          </Card>
        ) : (
          <StarsSection
            instantMs={clock.instantMs}
            observer={observer}
            nightMode={nightMode}
            onNightMode={setNightMode}
          />
        ))}
      {tab === "sunmoon" && (
        <SunMoonPanel observer={observer} day={new Date(clock.instantMs)} />
      )}
    </div>
  );
}

/**
 * The shared clock: what instant the four views are about, one click back to
 * the machine's own, and a field for pinning another.
 *
 * The field is a `datetime-local`, held as TEXT while it is being typed and
 * committed only when it parses (`FocusSettingsPanel`'s recipe): a controlled
 * field whose value came straight from the clock would snap back under a
 * half-typed date, and the one value a `datetime-local` field genuinely holds
 * mid-edit is the empty string, which must not move the whole corner to 1969.
 */
function ClockBar({
  clock,
  onChange,
}: {
  readonly clock: SkyClock;
  readonly onChange: (clock: SkyClock) => void;
}) {
  const [draft, setDraft] = useState(() => datetimeLocalValue(clock.instantMs));
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState(false);

  // While nobody is typing, the field follows the clock — which is what makes
  // the Now button visibly work and what a running clock needs.
  useEffect(() => {
    if (editing) return;
    setDraft(datetimeLocalValue(clock.instantMs));
  }, [clock.instantMs, editing]);

  return (
    <Card className="astronomy__clock">
      <div className="astronomy__clock-row">
        <span className="astronomy__instant">
          {dateTimeFormat({ dateStyle: "medium", timeStyle: "short" }).format(
            new Date(clock.instantMs),
          )}
        </span>
        <Button
          size="sm"
          variant={isFollowing(clock) ? "primary" : "ghost"}
          aria-pressed={isFollowing(clock)}
          onClick={() => {
            setEditing(false);
            setProblem(false);
            onChange(nowClock(Date.now()));
          }}
        >
          {copy.clock.now}
        </Button>
        <TextField
          className="astronomy__moment"
          label={copy.clock.label}
          type="datetime-local"
          value={draft}
          onFocus={() => {
            setEditing(true);
          }}
          onBlur={() => {
            setEditing(false);
            setProblem(false);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (next === "") return;
            const atMs = parseDatetimeLocal(next);
            if (atMs === null) {
              setProblem(true);
              return;
            }
            setProblem(false);
            onChange(fixedClock(atMs));
          }}
        />
      </div>
      <p className="nx-hint">{copy.clock.hint}</p>
      {problem && (
        <p className="astronomy__error" role="alert">
          {copy.clock.bad}
        </p>
      )}
    </Card>
  );
}

/**
 * The 3D solar system, its two scales, the selected body's own reading, and —
 * when the pack is installed — the attribution its licence asks for.
 *
 * The scale switch is a segmented row rather than a checkbox because there are
 * two layouts and each says something different; the hint under it changes with
 * the choice, so the layout's own two lies (`scale.ts`) are stated where the
 * choice is made rather than in a manual.
 */
function SolarSection({
  snapshot,
  orbits,
  textures,
  packsRead,
  scale,
  onScale,
  selected,
  onSelect,
}: {
  readonly snapshot: SolarSystemSnapshot;
  readonly orbits: readonly OrbitPath[];
  readonly textures: PlanetTextures | null;
  /** Whether the pack read has answered: false only while the first read is in flight. */
  readonly packsRead: boolean;
  readonly scale: SolarScale;
  readonly onScale: (scale: SolarScale) => void;
  readonly selected: BodyId | null;
  readonly onSelect: (id: BodyId) => void;
}) {
  const credits = textureCredits(textures);
  const chosen =
    selected === null ? null : (snapshot.bodies.find((b) => b.id === selected) ?? null);
  const numbers = numberFormat({ maximumFractionDigits: 3 });

  return (
    <>
      <div className="astronomy__scales" role="group" aria-label={copy.solar.scaleLabel}>
        {(["readable", "true"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={scale === option ? "primary" : "ghost"}
            aria-pressed={scale === option}
            onClick={() => {
              onScale(option);
            }}
          >
            {option === "true" ? copy.solar.scaleTrue : copy.solar.scaleReadable}
          </Button>
        ))}
      </div>

      <SolarSystemView
        snapshot={snapshot}
        orbits={orbits}
        selected={selected}
        onSelect={onSelect}
        scale={scale}
        textures={textures}
      />

      <p className="nx-hint">
        {scale === "true" ? copy.solar.scaleTrueHint : copy.solar.scaleReadableHint}
      </p>
      <p className="nx-hint">{copy.solar.selectHint}</p>
      {chosen !== null && (
        <p className="astronomy__choice">
          {fill(copy.solar.selected, {
            body: bodyLabel(chosen.id),
            distance: numbers.format(chosen.distanceFromEarthAu),
          })}
        </p>
      )}

      {/* ADR-103's attribution, where the textures are used: the pack's own
          per-body credit lines, drawn on the surface that shows the maps. */}
      {credits.length > 0 && (
        <p className="nx-hint">
          <span className="nx-eyebrow">{copy.textures.credits}</span>{" "}
          {credits.join(" · ")}
        </p>
      )}
      {/* `packsRead` is the difference between „no pack" and „the answer has
          not arrived yet": drawing „install the pack" for one frame would tell
          the user something false on every open. */}
      {packsRead && textures === null && (
        <p className="nx-hint">{copy.textures.missing}</p>
      )}
    </>
  );
}

/** The sky tonight: the star chart, plus the one switch that makes it usable with dark-adapted eyes. */
function StarsSection({
  instantMs,
  observer,
  nightMode,
  onNightMode,
}: {
  readonly instantMs: number;
  readonly observer: LatLon;
  readonly nightMode: boolean;
  readonly onNightMode: (on: boolean) => void;
}) {
  return (
    <>
      <div className="astronomy__scales" role="group" aria-label={copy.stars.nightLabel}>
        {[false, true].map((option) => (
          <Button
            key={String(option)}
            size="sm"
            variant={nightMode === option ? "primary" : "ghost"}
            aria-pressed={nightMode === option}
            onClick={() => {
              onNightMode(option);
            }}
          >
            {option ? copy.stars.nightLabel : copy.stars.normal}
          </Button>
        ))}
      </div>
      <StarMap instantMs={instantMs} observer={observer} nightMode={nightMode} />
      <p className="nx-hint">{copy.stars.nightHint}</p>
    </>
  );
}
