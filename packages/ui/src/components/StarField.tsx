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

      // Centre the crop, so the same region of sky shows regardless of which
      // edge the element grew from.
      const offsetX = (SKY_WORLD.width - width) / 2;
      const offsetY = (SKY_WORLD.height - height) / 2;

      for (const star of stars) {
        const x = star.x - offsetX;
        const y = star.y - offsetY;
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
