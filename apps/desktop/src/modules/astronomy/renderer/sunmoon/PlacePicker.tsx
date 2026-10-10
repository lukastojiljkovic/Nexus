import { useMemo, useState } from "react";
import { searchCities, zonePoint, type City, type LatLon } from "@nexus/core";
import { Button, Card, TextField } from "@nexus/ui";
import { decimalSeparators, numberFormat } from "../../../../renderer/src/intl.js";
import { copy } from "./copy.js";
import { latitudeText, longitudeText, parseCoordinate } from "./panel.js";
import "./sunmoon.css";

/**
 * Choosing the place the panel and the map are about.
 *
 * **Why this exists at all.** The default observer is the reader's own zone
 * (`zoneLocation.ts`), and that is already a guess twice over: a zone names a
 * timekeeping area rather than a position, and 121 of the zones a machine can
 * report have no principal city in the shipped table at all. So the reader needs
 * a way to say where they are, and it has to work with the network off: the
 * shipped city table (`cities.ts`, GeoNames, 6 280 rows) is the picker, and a
 * typed coordinate pair is the other way in — both offline, both local.
 *
 * **Controlled, and it hands over coordinates.** The chosen place is the
 * caller's state, not this component's: `onChange` gives a latitude and a
 * longitude, or `null`, and what the page does with them — remember them, store
 * them in the profile's settings, pass them to the map — is the page's business.
 * A city NAME is not handed over, because a name is not what the observer is: it
 * names a search result, and the same coordinates can be the centroid of a city,
 * a typed GPS reading or a zone's principal city.
 *
 * **Both ways in are always visible**, rather than one folded behind a
 * disclosure: a reader who has never seen the panel will not guess that a list
 * of eight thousand cities is two clicks away, and the coordinate fields are
 * also what a reader with a GPS readout or a paper map actually has.
 */

export interface PlacePickerProps {
  /** The place the rest of the surface is using, or `null` for none. */
  readonly observer: LatLon | null;
  /** The computer's zone, as `computerZone()` named it: the reset's own place, and the default. */
  readonly zone: string | null;
  readonly onChange: (point: LatLon | null) => void;
}

/** How many search results the picker shows at once. Fewer than eight and a common name hides the one being looked for. */
const RESULT_LIMIT = 8;

export function PlacePicker({ observer, zone, onChange }: PlacePickerProps) {
  const [query, setQuery] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [problem, setProblem] = useState<"latitude" | "longitude" | null>(null);

  const matches = useMemo(() => searchCities(query, RESULT_LIMIT), [query]);
  const numbers = numberFormat({ maximumFractionDigits: 3 });
  const separators = decimalSeparators();
  const defaultPoint = zone === null ? null : zonePoint(zone);

  const coordinateText = (point: LatLon): string =>
    `${latitudeText(point.latDeg, copy.panel.coordinates, (value) => numbers.format(value))}, ` +
    `${longitudeText(point.lonDeg, copy.panel.coordinates, (value) => numbers.format(value))}`;

  function apply(): void {
    const latDeg = parseCoordinate(latitude, 90, separators);
    const lonDeg = parseCoordinate(longitude, 180, separators);
    if (latDeg === null) {
      setProblem("latitude");
      return;
    }
    if (lonDeg === null) {
      setProblem("longitude");
      return;
    }
    setProblem(null);
    onChange({ latDeg, lonDeg });
  }

  return (
    <Card className="ast-place__card" title={copy.panel.placeTitle}>
      <p className="nx-hint">
        {observer === null ? copy.place.none : `${copy.place.current} ${coordinateText(observer)}`}
      </p>
      <TextField
        label={copy.place.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim().length > 0 &&
        (matches.length === 0 ? (
          <p className="nx-hint">{copy.place.noResults}</p>
        ) : (
          <ul className="ast-place__results">
            {matches.map((city) => (
              <li key={`${city.name}|${city.countryCode}|${city.latDeg}|${city.lonDeg}`}>
                <button
                  type="button"
                  className="ast-place__result"
                  onClick={() => {
                    onChange({ latDeg: city.latDeg, lonDeg: city.lonDeg });
                    setQuery("");
                    setProblem(null);
                  }}
                >
                  <span className="ast-place__result-name">{city.name}</span>
                  <span className="ast-place__result-place">
                    {countryAndPoint(city, numbers)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <p className="nx-hint">{copy.place.searchHint}</p>
      <div className="ast-place__fields">
        <TextField
          label={copy.place.latitude}
          value={latitude}
          inputMode="decimal"
          onChange={(event) => setLatitude(event.target.value)}
        />
        <TextField
          label={copy.place.longitude}
          value={longitude}
          inputMode="decimal"
          onChange={(event) => setLongitude(event.target.value)}
        />
      </div>
      <div className="ast-place__actions">
        <Button size="sm" variant="primary" onClick={apply}>
          {copy.place.apply}
        </Button>
        {defaultPoint !== null && (
          <Button
            size="sm"
            onClick={() => {
              onChange(defaultPoint);
              setProblem(null);
            }}
          >
            {copy.place.reset}
          </Button>
        )}
      </div>
      {problem !== null && (
        <p className="ast-place__error" role="alert">
          {problem === "latitude" ? copy.place.badLatitude : copy.place.badLongitude}
        </p>
      )}
      {zone !== null && <p className="nx-hint">{`${copy.place.defaultPlace} (${zone})`}</p>}
    </Card>
  );
}

/** A city's row, written as the country and the position: `RS · 44.8° N, 20.47° E`. */
function countryAndPoint(city: City, numbers: Intl.NumberFormat): string {
  const latitude = latitudeText(city.latDeg, copy.panel.coordinates, (value) => numbers.format(value));
  const longitude = longitudeText(city.lonDeg, copy.panel.coordinates, (value) => numbers.format(value));
  return `${city.countryCode} · ${latitude}, ${longitude}`;
}

export default PlacePicker;
