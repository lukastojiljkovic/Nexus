/**
 * The canvas behind the day-and-night map: three decisions, each of which a
 * reader of the picture would otherwise have to take on trust.
 *
 * **The two layers are the Earth's, not the app's.** The day image and the night
 * image are painted from the token package's own Dan and Noc values, and the
 * same two layers are drawn whether the app is light or dark: this is a picture
 * of the planet at an instant, and a picture that changed tone with the
 * interface would be a picture of the interface. The lines and markers above the
 * layers are the other way round, and they are read from the live cascade
 * (`--nx-*`), because they have to stay legible on top of whatever the two
 * layers have just produced.
 *
 * **Every line is a halo pair.** One pass in the near-white surface colour and a
 * narrower one in the ink, which is how a cartographer draws a line over
 * terrain whose tone is not known in advance: over the night half the halo is
 * what the eye sees, over the day half the ink is. The three twilight edges are
 * told apart by their DASH pattern rather than by a colour of their own, so the
 * legend names them and no hue carries a state alone.
 *
 * **The antimeridian is drawn by repetition.** A path is drawn three times, a
 * whole world apart (`-width, 0, +width`), and the canvas clips each copy: what
 * ran off one edge comes back on the other, and a ring that crosses the seam
 * fills as one shape. The blend is the same idea one layer down: the day image
 * is drawn once, the night image is masked by the twilight weight, and the
 * masked night is drawn over the day, so the crossfade costs one alpha channel
 * per pixel rather than three colour channels per layer per pixel.
 */
import type { DayNight, LatLon } from "@nexus/core";
import { global, themes } from "@nexus/tokens";
import { dayNightWeights, solarAltitudeDegrees } from "./blend.js";
import { landRings } from "./land.js";
import { mapX, mapY, pointAt, unwrapLongitudes, type MapRect } from "./projection.js";

/**
 * The map's own palette.
 *
 * The day side is an atlas: pale sand water and an olive-brown land. The night
 * side is the same planet with the lights out: near-black water and land a
 * shade above it, which is the tone a city-lights image is drawn on when there
 * is no image. The gold is the Sun's own, the ink and halo are the line pair,
 * and the jade dot is the reader's place.
 */
const DAY = { sea: themes.dan.surfaceAlt, land: global.color.maslina["400"] } as const;
const NIGHT = { sea: themes.noc.bg, land: themes.noc.border } as const;
const SUN_INK = global.color.gold["700"];
const OBSERVER_INK = global.color.jade["600"];

/** The two colours a canvas pass is drawn in: one tone and what it has to read on. */
interface HaloPair {
  readonly halo: string;
  readonly ink: string;
}

/** The line pair and the marker inks, read out of the live cascade so both themes are legible. */
function inks(canvas: HTMLCanvasElement): {
  readonly line: HaloPair;
  readonly moon: string;
} {
  const styles = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    line: { halo: read("--nx-surface", themes.dan.surface), ink: read("--nx-text", themes.dan.text) },
    moon: read("--nx-text-muted", themes.dan.textMuted),
  };
}

/** One ring, or one polyline, as a canvas path in device pixels. */
function tracePath(context: CanvasRenderingContext2D, points: readonly LatLon[], rect: MapRect): void {
  points.forEach((point, index) => {
    const x = mapX(point.lonDeg, rect.width);
    const y = mapY(point.latDeg, rect.height);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
}

/** How many copies of a path are drawn: the path itself, one a world west, one a world east. */
const WORLD_COPIES = [-1, 0, 1] as const;

/** A layer at the canvas's own size: the texture scaled to it, or the coastline in token tones. */
function paintLayer(
  image: HTMLImageElement | undefined,
  palette: { readonly sea: string; readonly land: string },
  rect: MapRect,
): HTMLCanvasElement | null {
  const layer = document.createElement("canvas");
  layer.width = rect.width;
  layer.height = rect.height;
  const context = layer.getContext("2d");
  if (context === null) return null;
  if (image !== undefined && image.naturalWidth > 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return layer;
  }
  context.fillStyle = palette.sea;
  context.fillRect(0, 0, rect.width, rect.height);
  context.fillStyle = palette.land;
  context.beginPath();
  for (const ring of landRings()) tracePath(context, unwrapLongitudes(ring), rect);
  // Three copies of one path, so the rings that straddle the seam fill across it
  // instead of closing with a chord down the edge of the map.
  for (const copy of WORLD_COPIES) {
    context.save();
    context.translate(copy * rect.width, 0);
    context.fill("evenodd");
    context.restore();
  }
  return layer;
}

/** The night layer with its own twilight weight in the alpha channel. */
function maskNight(
  night: HTMLCanvasElement,
  subsolar: LatLon,
  rect: MapRect,
): HTMLCanvasElement | null {
  const mask = document.createElement("canvas");
  mask.width = rect.width;
  mask.height = rect.height;
  const context = mask.getContext("2d");
  if (context === null) return null;
  const pixels = context.createImageData(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const point = pointAt(x + 0.5, y + 0.5, rect);
      const weights = dayNightWeights(solarAltitudeDegrees(point, subsolar));
      pixels.data[(y * rect.width + x) * 4 + 3] = Math.round(weights.night * 255);
    }
  }
  context.putImageData(pixels, 0, 0);

  const masked = document.createElement("canvas");
  masked.width = rect.width;
  masked.height = rect.height;
  const maskedContext = masked.getContext("2d");
  if (maskedContext === null) return null;
  maskedContext.drawImage(night, 0, 0);
  maskedContext.globalCompositeOperation = "destination-in";
  maskedContext.drawImage(mask, 0, 0);
  maskedContext.globalCompositeOperation = "source-over";
  return masked;
}

/** One dashed-twilight or solid-terminator path, drawn as the halo pair. */
function strokePath(
  context: CanvasRenderingContext2D,
  points: readonly LatLon[],
  rect: MapRect,
  pair: HaloPair,
  width: number,
  dash: readonly number[],
): void {
  if (points.length < 2) return;
  const unwrapped = unwrapLongitudes(points);
  context.setLineDash([...dash]);
  for (const pass of [
    { colour: pair.halo, lineWidth: width + 2 },
    { colour: pair.ink, lineWidth: width },
  ]) {
    context.strokeStyle = pass.colour;
    context.lineWidth = pass.lineWidth;
    for (const copy of WORLD_COPIES) {
      context.save();
      context.translate(copy * rect.width, 0);
      context.beginPath();
      tracePath(context, unwrapped, rect);
      context.stroke();
      context.restore();
    }
  }
  context.setLineDash([]);
}

/** Eight rays around a filled disc: the Sun, and never a dot that could be anything. */
function drawSun(context: CanvasRenderingContext2D, x: number, y: number, pair: HaloPair): void {
  context.save();
  context.strokeStyle = pair.halo;
  context.lineWidth = 4;
  context.beginPath();
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (ray * Math.PI) / 4;
    context.moveTo(x + Math.cos(angle) * 5.5, y + Math.sin(angle) * 5.5);
    context.lineTo(x + Math.cos(angle) * 8.5, y + Math.sin(angle) * 8.5);
  }
  context.stroke();
  context.strokeStyle = SUN_INK;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = pair.halo;
  context.beginPath();
  context.arc(x, y, 6.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = SUN_INK;
  context.beginPath();
  context.arc(x, y, 4.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** A crescent, so the Moon is never read as a second Sun. */
function drawMoon(context: CanvasRenderingContext2D, x: number, y: number, pair: HaloPair): void {
  context.save();
  context.beginPath();
  context.arc(x, y, 5.5, Math.PI * 0.25, Math.PI * 1.75);
  context.arc(x + 3, y, 4.5, Math.PI * 1.6, Math.PI * 0.4, true);
  context.closePath();
  for (const pass of [
    { colour: pair.halo, lineWidth: 4 },
    { colour: pair.ink, lineWidth: 2 },
  ]) {
    context.strokeStyle = pass.colour;
    context.lineWidth = pass.lineWidth;
    context.stroke();
  }
  context.restore();
}

/** A diamond: the reader's own place, and the one mark here that is not a body. */
function drawObserver(context: CanvasRenderingContext2D, x: number, y: number, pair: HaloPair): void {
  const half = 5;
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI / 4);
  context.fillStyle = pair.halo;
  context.beginPath();
  context.rect(-half - 2, -half - 2, 2 * half + 4, 2 * half + 4);
  context.fill();
  context.fillStyle = OBSERVER_INK;
  context.beginPath();
  context.rect(-half, -half, 2 * half, 2 * half);
  context.fill();
  context.restore();
}

/**
 * Paint the whole map onto a canvas whose backing store is already the size of
 * its box in device pixels.
 *
 * `dayImage` and `nightImage` are the profile's textures, or `undefined` for
 * either one that is absent or failed to load, which falls back to the shipped
 * coastline in that layer's own tones: the map is never blank, and it is never
 * half-blank either.
 */
export function drawEarthMap(
  canvas: HTMLCanvasElement,
  dayNight: DayNight,
  observer: LatLon | null,
  dayImage: HTMLImageElement | undefined,
  nightImage: HTMLImageElement | undefined,
  devicePixelRatio: number,
): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;
  const rect: MapRect = {
    width: Math.max(1, Math.round(width * devicePixelRatio)),
    height: Math.max(1, Math.round(height * devicePixelRatio)),
  };
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (context === null) return;

  const day = paintLayer(dayImage, DAY, rect);
  const night = paintLayer(nightImage, NIGHT, rect);
  if (day === null || night === null) return;
  const masked = maskNight(night, dayNight.subsolar, rect);
  if (masked === null) return;
  context.drawImage(day, 0, 0);
  context.drawImage(masked, 0, 0);

  // Everything above the layers is drawn in CSS pixels, so the widths below are
  // the ones a reader sees whatever the display's scale factor is.
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const css: MapRect = { width, height };
  const { line: pair, moon: moonInk } = inks(canvas);

  strokePath(context, dayNight.twilight.astronomical, css, pair, 1, [1, 3]);
  strokePath(context, dayNight.twilight.nautical, css, pair, 1, [3, 3]);
  strokePath(context, dayNight.twilight.civil, css, pair, 1, [6, 3]);
  strokePath(context, dayNight.terminator, css, pair, 1.5, []);

  drawMoon(context, mapX(dayNight.sublunar.lonDeg, width), mapY(dayNight.sublunar.latDeg, height), {
    halo: pair.halo,
    ink: moonInk,
  });
  drawSun(context, mapX(dayNight.subsolar.lonDeg, width), mapY(dayNight.subsolar.latDeg, height), pair);
  if (observer !== null) {
    drawObserver(context, mapX(observer.lonDeg, width), mapY(observer.latDeg, height), pair);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}
