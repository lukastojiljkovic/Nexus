import { useEffect, useRef, useState } from "react";
import type { DayNight, LatLon } from "@nexus/core";
import { dateTimeFormat } from "../../../../renderer/src/intl.js";
import { copy } from "./copy.js";
import { drawEarthMap } from "./draw.js";
import "./earth.css";

/**
 * The day-and-night map: where it is day and where it is night, at one instant,
 * on one world.
 *
 * **What the picture is.** Two equirectangular layers of the whole Earth — the
 * day side and the night side with its city lights — crossfaded across the
 * three twilight bands, with the terminator, the two overhead points and the
 * reader's own place drawn on top. Which of those is where comes in as
 * `dayNight`, computed by the engine (`packages/core/src/sky/earthView.ts`);
 * this component computes nothing astronomical and owns no clock. That is the
 * seam the contract fixes, and it is why this file has no `new Date()` in it.
 *
 * **The map is never blank.** `textures` is optional and either half of it may
 * be missing — a profile that has downloaded nothing, or a URL that failed to
 * load — and the missing layer falls back to the shipped 1:110m coastline in
 * that layer's own tones (Natural Earth, public domain; the statement is quoted
 * in `coastline.ts`). A partly textured map is the case worth naming: the day
 * image over the vector night side is still a correct map, so the fallback is
 * per layer and not all-or-nothing.
 *
 * **The times on this surface are the computer's.** The map is painted at
 * `dayNight.instantMs`, and the one date it prints is that instant read through
 * `Intl` in the machine's own zone, which is the zone every other clock the
 * reader owns is in.
 */

/** The two texture URLs a profile may have, either of which may be absent. */
export interface EarthTextureUrls {
  readonly day?: string | undefined;
  readonly night?: string | undefined;
}

export interface EarthDayNightMapProps {
  /** Where the Sun and the Moon are overhead, and the four lines, at one instant. */
  readonly dayNight: DayNight;
  /** The reader's place, or `null` when neither the zone nor the picker has named one. */
  readonly observer: LatLon | null;
  /** Downloaded world images, or `null` for a profile that has none. */
  readonly textures: EarthTextureUrls | null;
}

export function EarthDayNightMap({ dayNight, observer, textures }: EarthDayNightMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Loaded images by URL, so a repaint never re-downloads and a failure is remembered as absent. */
  const images = useRef(new Map<string, HTMLImageElement>());
  /** Bumped when a texture arrives or fails, which is the only thing that needs a repaint here. */
  const [textureTick, setTextureTick] = useState(0);

  const dayUrl = textures?.day;
  const nightUrl = textures?.night;

  useEffect(() => {
    const wanted = [dayUrl, nightUrl].filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );
    let cancelled = false;
    for (const url of wanted) {
      if (images.current.has(url)) continue;
      const image = new Image();
      images.current.set(url, image);
      const settle = (): void => {
        if (cancelled) return;
        if (image.naturalWidth === 0) images.current.delete(url);
        setTextureTick((tick) => tick + 1);
      };
      image.addEventListener("load", settle);
      image.addEventListener("error", settle);
      image.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [dayUrl, nightUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const paint = (): void => {
      drawEarthMap(
        canvas,
        dayNight,
        observer,
        dayUrl === undefined ? undefined : images.current.get(dayUrl),
        nightUrl === undefined ? undefined : images.current.get(nightUrl),
        window.devicePixelRatio || 1,
      );
    };
    paint();
    // The canvas is sized by CSS (`aspect-ratio: 2 / 1`) and by the box it is
    // given, so a layout change is a repaint and there is nothing else to
    // measure. One paint is a raster pass over the box's own pixels, so it is
    // done on resize rather than per frame; nothing here animates.
    const resize = new ResizeObserver(paint);
    resize.observe(canvas);
    return () => resize.disconnect();
  }, [dayNight, observer, dayUrl, nightUrl, textureTick]);

  return (
    <figure className="ast-earth">
      <canvas ref={canvasRef} className="ast-earth__canvas" aria-hidden="true" />
      <figcaption className="ast-earth__caption">
        <p className="nx-hint ast-earth__instant">
          {dateTimeFormat({ dateStyle: "medium", timeStyle: "short" }).format(
            new Date(dayNight.instantMs),
          )}
        </p>
        <p className="nx-hint">{copy.map.caption}</p>
      </figcaption>
      <dl className="ast-earth__legend">
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.terminator}</dt>
          <dd className="ast-earth__sample ast-earth__sample--terminator" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.civil}</dt>
          <dd className="ast-earth__sample ast-earth__sample--civil" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.nautical}</dt>
          <dd className="ast-earth__sample ast-earth__sample--nautical" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.astronomical}</dt>
          <dd className="ast-earth__sample ast-earth__sample--astronomical" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.sunOverhead}</dt>
          <dd className="ast-earth__sample ast-earth__sample--sun" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.moonOverhead}</dt>
          <dd className="ast-earth__sample ast-earth__sample--moon" aria-hidden="true" />
        </div>
        <div className="ast-earth__legend-item">
          <dt className="nx-eyebrow">{copy.map.observer}</dt>
          <dd className="ast-earth__sample ast-earth__sample--observer" aria-hidden="true" />
        </div>
      </dl>
      {observer === null && <p className="nx-hint">{copy.map.noObserver}</p>}
    </figure>
  );
}

export default EarthDayNightMap;
