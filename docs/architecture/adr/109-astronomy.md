# ADR-109 — The astronomy corner, assembled

**Status:** Accepted (2026-10-10). **Owner:** the 2.0 wave (module `astronomy`,
group `knowledge`, order 400, no migration — the module stores nothing in the
profile).

Wave 1 built the astronomy corner as four components with no module around them:
a 3D solar system (`solar/`, three.js), a day-and-night map on the Earth
(`earth/`), a star map (`stars/`), and a Sun-and-Moon panel with a place picker
(`sunmoon/`), over the engine in `packages/core/src/sky/` (positions, phases, the
horizon, stars, cities and zones). This ADR is the decision that joins them: one
module, one page, one clock, one place — and it records where every number the
corner prints comes from, how accurate each view is, and what it deliberately
does not do.

## 1. Four views, one instant, one place

The four components are one subject read four ways, and the two facts they share
are what make them a corner rather than four tools:

- **The instant is the page's.** `renderer/clock.ts` holds it as
  `{ mode: "now" | "fixed", instantMs }`; the page re-reads `Date.now()` once a
  second while the clock follows the machine and stops when the user pins a
  moment, and the Now button is one press away from either state. A pinned clock
  is a lens, never a place the page silently stays.
- **The place is the module's one preference.** It is a DEVICE value in
  `localStorage` (`renderer/prefs.ts`), declared on the settings card as
  `storage: "device"`, and it defaults to the principal city of the computer's
  time zone. A picked place overrides it; with neither, the three views that need
  a place say so rather than drawing a sky for nowhere.

The module has **no store, no migration and no profile row**: everything it
draws is computed from `@nexus/core` or read from an installed pack, so it writes
nothing to the encrypted database and nothing of it rides in a profile archive.

## 2. Where every number comes from

| Quantity | Source |
| --- | --- |
| Planet and Pluto positions, and their orbit paths | JPL/Standish, "Approximate Positions of the Planets" (`ssd.jpl.nasa.gov/planets/approx_pos.html`), transcribed in `sky/planets.ts`; Table 1 inside 1800–2050, Table 2a outside it, both in the ecliptic and equinox of J2000 |
| The Moon's position, phase and distance | Meeus ch. 47 (`sky/moon.ts`), carried outward from the Earth–Moon barycentre so the Earth and the Moon close on it by construction |
| Radii, poles and prime meridians | IAU WGCCRE 2015 (Archinal et al. 2018), `sky/planets.ts`'s `PHYSICAL` table |
| The Sun's place, rise and set, and the twilight bands | Meeus ch. 25 and ch. 15–16 through `sky/sun.ts` and `sky/horizon.ts` |
| The sub-solar and sub-lunar points and the four circles | `sky/earthView.ts`, geometric, compared against JPL Horizons' `SunSub-LON`/`SunSub-LAT` |
| The star catalogue and the constellations | Bright Star Catalogue V/50 to magnitude 6.0, with the IAU's 88 constellations and names, `sky/starCatalogue.ts` |
| Precession, nutation, aberration, the horizon | Meeus ch. 21–23 and ch. 13, `sky/precession.ts` and `sky/stars.ts` |
| The city a place is chosen by | GeoNames, 6 280 rows in `sky/cities.ts` |
| A time zone's principal city | the tz database's `zone1970.tab`, `sky/tzTable.ts` |
| The planet photographs | the `planet-textures` pack (`scripts/packs/planet-textures/`), ten maps CC BY 4.0 from Solar System Scope and two public-domain NASA maps, each with its credit line in the pack's own `textures.json` |

The Saturn ring extents and the Moon's mean distance are quoted with their
sources beside them in `solar/scene.ts` and `solar/scale.ts`.

## 3. What each view claims, and what it does not

- **The Sun-and-Moon panel** claims the engine's accuracy, which is what its own
  tests measure against USNO and JPL fixtures: rise and set inside the minute the
  engine publishes, the Sun's declination inside a hundredth of a degree. It does
  NOT claim a *local* horizon: the engine is at sea level with standard
  refraction, so a mountain, a building or a valley is not in the number.
- **The day-and-night map** claims the sub-solar point to the fifth of a degree
  `earthView.test.ts` measures against Horizons, and the terminator as the Sun's
  CENTRE on the geometric horizon — which is not a sunset (that is the upper limb
  34′ of refraction up), and the legend says which line is which.
- **The star chart** claims the catalogue's own limit (magnitude 6, no proper
  motion) and the geometry of precession, nutation, aberration and refraction. It
  does NOT claim to draw the sky a camera would see: no light pollution, no
  seeing, no Milky Way, and no planet magnitudes (the engine carries none, and
  inventing them is not a thing this module does).
- **The 3D solar system** claims the order and the DIRECTION of every body, in
  both layouts: `readable` compresses distance and enlarges radii through two
  strictly increasing maps, so a body farther from the Sun is still farther and
  nothing is ever turned away from where it really is (`scale.ts`). It does NOT
  claim a true picture in that mode — the scale switch says so on screen — and it
  does not draw shadows, eclipses or non-spherical shapes.

**The Moon is the one body whose drawn orbit is not heliocentric.** The engine
has no orbital elements for a satellite, and a heliocentric Moon path over one
sidereal month is an arc of the Earth's orbit rather than a loop, so the module
samples the Moon's GEOCENTRIC offsets (`moon − earth`, both from the engine) and
marks the path with its parent; `contract.ts` gained that optional field for it.
The dot and the line then go through one transform, which is what the wave-1 gap
was.

## 4. Why there is no geolocation

The place comes from `Intl.DateTimeFormat().resolvedOptions().timeZone` and the tz
database's coordinates for that zone's principal city. No permission prompt, no
`navigator.geolocation`, no network request.

- **A zone is a timekeeping label rather than a position**, and this module treats
  it as one: the default is offered as a default, named on screen with the zone it
  came from, and the reader refines it with the shipped city table or a typed
  coordinate pair.
- **The permission would be a bigger promise than the feature needs.** A prompt
  that must be refused to keep the app offline-first is a prompt that makes the
  offline promise look optional.
- **A zone the table does not carry answers no place, not a neighbour's.** 121 of
  the 418 zone names this runtime reports have no row in `zone1970.tab` because
  their civil clocks have agreed with another zone's since 1970; pinning Oslo at
  Berlin would be a thousand kilometres of fabricated precision.

The module therefore makes **no network request at all**. Its one interaction with
main is reading the installed planet-textures pack (`main/packData.ts`) and
resolving each declared image into an `nx-pack://` address that the shell's own
protocol serves; no path and no byte crosses the IPC bridge in either direction.

## 5. The corners wave 1 left, and how they are closed

- **Earth's night side was not drawn.** The pack ships a night-lights map and the
  layout declared it, but nothing consumed it. `solar/night.ts` injects a
  terminator into the Earth's own standard material: the city lights of the night
  map are added to the emissive term, weighted by the cosine between the fragment's
  world normal and the direction to the scene's single light at the origin, with a
  ±0.08 soft edge. `textures.ts` loads the map for Earth like any other. A body
  with no day map keeps the neutral tone and the lighting's own terminator, so a
  missing pack is not a special case.
- **The Moon's dot stood off its drawn orbit in readable mode.** Both now use
  `satelliteOffsetUnits` with the same clearance: the dot is placed from the raw
  geocentric offset and the line is drawn around its parent's own position.
  `orbits.test.ts` asserts the dot is exactly on the line in both layouts.
- **Pluto has no texture.** It is drawn in the palette's neutral `body` tone and
  nothing anywhere says otherwise: no missing-image message, no placeholder, no
  manifest note. The pack builder's own comment records why there is no Pluto map
  (no source with a stable URL and a stated licence inside the budget).
- **The textures' licence was shown nowhere.** The solar view draws the pack's own
  credit lines (`solar/credit.ts`, distinct credits in contract body order) under
  the canvas, and ADR-103's credits screen already draws the pack's manifest
  licence. Both surfaces now state the attribution where the images are used.
- **Without the pack** the corner still works: plain coloured bodies, the map's
  shipped Natural Earth coastline, and one line naming the `planet-textures` pack
  and where it is installed (Settings → Packs). The line appears only after the
  pack read has ANSWERED, so an in-flight read cannot claim the pack is missing.
- **The 3D view draws only while it is seen.** The renderer already painted on
  change rather than in a loop; it now also stops for a hidden window and for a
  canvas that has scrolled off screen (`IntersectionObserver` plus
  `visibilitychange`), which matters because the shared clock advances behind
  three views the user is not looking at.

## 6. Alternatives rejected

- **Four rail rows, one per part.** Four toggles and four settings cards for one
  sky, and — the reason that decides it — four views that could disagree about
  what "now" and "here" mean.
- **A profile row for the place.** It would need a migration, and the value is a
  fact about this machine before it is a fact about the person: the default comes
  from the machine's own zone.
- **Skyfield, or the `astronomy-engine` package.** A runtime dependency with its
  own data files, against an engine the repository already ships, tests against
  USNO and JPL fixtures, and can read.
- **Planet magnitudes on the star chart.** The engine carries none, and a table of
  the Astronomical Almanac's coefficients transcribed from memory would be an
  invented number in a scientific view.

## 7. What this ADR does not do

- It adds no migration, no interchange version and no profile table; the module's
  entire persistent state is one device key.
- It does not download the texture pack. That is the Packs card (ADR-091) and the
  catalogue (ADR-103); the module reads what is installed.
- It does not add an observable-sky model (light pollution, weather, an eclipse
  list), a variable-star or deep-sky catalogue, or a proper-motion solution.
