import { useState } from "react";
import { Button } from "@nexus/ui";
import { copy } from "../copy.js";

/**
 * The screen light (mini-apps): the window as a light, with three casts, three
 * brightnesses, and Escape to leave.
 *
 * **The colours are the theme's own, and that is a decision rather than a
 * compromise.** The design rules allow no colour outside `packages/tokens`, and
 * the token set has no light-source family - so the light is drawn from the
 * tokens the two themes already carry: the theme's paper for white (in the night
 * own pale ink, because the night theme's paper IS dark), the theme's warm
 * accent for warm, and the danger role for red, which is the one hue a night
 * light should be. Brightness is a `filter`, not a colour, so dimming the light
 * needs no new value at all. A truly theme-independent light source would need a
 * new token family, and that is a decision about the design system rather than
 * one a module may make by itself.
 *
 * **Escape leaves, and the panel's own button does too.** The KEY is handled by
 * `Page.tsx`, one listener for every tool, so this component needs no listener
 * of its own and cannot be the one tool whose Escape reaches nothing - and the
 * panel carries a visible Leave button besides, because the light covers the
 * whole window and a control a pointer cannot reach is not a way out.
 *
 * **The panel is a normal card on purpose.** Its own tokens stay readable
 * whatever is behind it - paper on paper in Dan, ink on a bright light in Noc -
 * so the controls never need a colour invented for them.
 */
type Cast = "white" | "warm" | "red";
type Level = "low" | "medium" | "high";

const CASTS: readonly Cast[] = ["white", "warm", "red"];
const LEVELS: readonly Level[] = ["low", "medium", "high"];

function castName(cast: Cast): string {
  if (cast === "white") return copy.screenlight.castWhite;
  if (cast === "warm") return copy.screenlight.castWarm;
  return copy.screenlight.castRed;
}

function levelName(level: Level): string {
  if (level === "low") return copy.screenlight.levelLow;
  if (level === "medium") return copy.screenlight.levelMedium;
  return copy.screenlight.levelHigh;
}

export function ScreenLightApp({ onLeave }: { readonly onLeave: () => void }) {
  const [cast, setCast] = useState<Cast>("white");
  const [level, setLevel] = useState<Level>("high");

  return (
    <div className="miniapps__light" data-cast={cast} data-level={level}>
      <div className="miniapps__light-fill" aria-hidden="true" />
      <div className="miniapps__light-panel">
        <p className="miniapps__light-title">{copy.apps.screenlight.name}</p>
        <div className="miniapps__row">
          <span className="miniapps__row-label">{copy.screenlight.cast}</span>
          {CASTS.map((option) => (
            <Button
              key={option}
              size="sm"
              aria-pressed={cast === option}
              onClick={() => setCast(option)}
            >
              {castName(option)}
            </Button>
          ))}
        </div>
        <div className="miniapps__row">
          <span className="miniapps__row-label">{copy.screenlight.brightness}</span>
          {LEVELS.map((option) => (
            <Button
              key={option}
              size="sm"
              aria-pressed={level === option}
              onClick={() => setLevel(option)}
            >
              {levelName(option)}
            </Button>
          ))}
        </div>
        {cast === "red" && <p className="nx-hint">{copy.screenlight.redHint}</p>}
        <p className="nx-hint">{copy.screenlight.hint}</p>
        <div className="miniapps__row">
          <Button size="sm" onClick={onLeave}>
            {copy.screenlight.leave}
          </Button>
        </div>
      </div>
    </div>
  );
}
