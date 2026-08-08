import { useEffect, useRef } from "react";
import { SKY_WORLD, starField, type Star } from "../material.js";

/**
 * Noć's ground: a fixed sky, cropped to whatever box it is given.
 *
 * WHERE THIS MAY BE USED, and why the rule is not negotiable. The app's
 * scrolling panes paint their own opaque background — that is a deliberate fix
 * for a Chromium repaint problem, and it means any texture placed on a scroller
 * scrolls WITH the content. For paper that is physically right: the page is
 * printed on it. For sky it is wrong — sky sits behind, and the one CSS
 * property that would pin it (`background-attachment: fixed`) forces a
 * main-thread repaint on every scroll frame, which is exactly the cost this
 * whole material layer is designed to avoid.
 *
 * So the sky belongs only on surfaces that do not scroll: the sidebar, the lock
 * screen, empty states. Never behind a list.
 *
 * The stars themselves never move — no twinkle, no parallax, no pointer
 * response. That is what keeps this a substrate rather than a screensaver, and
 * it is why `prefers-reduced-motion` needs no exception here.
 */
export interface StarFieldProps {
  /** Painting is skipped entirely when false — Dan has a paper ground instead. */
  enabled?: boolean;
  className?: string;
  /** Stars across the full 3840×2160 world box, not across this element. */
  density?: number;
}

const FIELD: Star[] = starField();

export function StarField({ enabled = true, className, density }: StarFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !enabled) return;
    const parent = canvas.parentElement;
    if (parent === null) return;

    const stars = density === undefined ? FIELD : starField(density);

    const paint = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width === 0 || height === 0) return;
      // Bake at device resolution so a 1px star is a crisp point rather than a
      // grey smudge, then let CSS scale it back down to layout pixels.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Colour is read out of the live cascade rather than stated here: no hex
      // may exist outside the token package, and reading it this way means the
      // sky follows whichever of the eight accents the user picked.
      const styles = getComputedStyle(parent);
      const faint = styles.getPropertyValue("--nx-text").trim();
      const bright = styles.getPropertyValue("--nx-accent").trim();
      if (faint === "" || bright === "") return;

      // The world is FITTED to the element's height and then cropped
      // horizontally about its centre — it is not cropped on both axes at 1:1.
      //
      // That distinction is the whole difference between a sky and a scatter of
      // dust. A 1:1 crop hands a 220×600 sidebar 1.6% of a 3840×2160 world,
      // which at the field's density is about fourteen points: too few to read
      // as anything, and individually conspicuous enough to look like dead
      // pixels — which is exactly how it was rendering. Fitting the height
      // instead shows roughly a fifth of the world in the same rail, and keeps
      // the apparent density constant at every window height, which a 1:1 crop
      // also failed to do.
      //
      // The radius is deliberately NOT scaled. A star is a point of light; at
      // this scale factor scaling it would render sub-pixel and grey out.
      const scale = height / SKY_WORLD.height;
      const offsetX = (SKY_WORLD.width * scale - width) / 2;

      for (const star of stars) {
        const x = star.x * scale - offsetX;
        const y = star.y * scale;
        if (x < -2 || y < -2 || x > width + 2 || y > height + 2) continue;
        ctx.globalAlpha = 0.12 + star.brightness * 0.65;
        ctx.fillStyle = star.brightness > 0.62 ? bright : faint;
        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    paint();

    const observer = new ResizeObserver(paint);
    observer.observe(parent);
    // Theme and accent both live as attributes on <html>; either one changes
    // what the sky should be painted in.
    const themeWatcher = new MutationObserver(paint);
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => {
      observer.disconnect();
      themeWatcher.disconnect();
    };
  }, [enabled, density]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      className={className === undefined ? "nx-starfield" : `nx-starfield ${className}`}
      aria-hidden="true"
    />
  );
}
