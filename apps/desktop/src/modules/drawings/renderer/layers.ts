/**
 * DRAWINGS' layer state and its colour rule.
 *
 * **A layer is one boolean and one colour.** The drawing's own layers arrive
 * from the library in file order with the colour each declares; the only thing
 * this module changes is which of them are drawn. So the state is a plain
 * `name -> visible` record, the reducer below is the only thing that writes it,
 * and the page never keeps a second copy that could disagree.
 *
 * **The colour is the DRAWING'S, and the token rule does not reach it.** Every
 * colour this app draws its own chrome with comes from `@nexus/tokens`; a layer's
 * colour is not chrome, it is DATA the user authored in another program and
 * expects to see unchanged, exactly as a photograph's pixels are data. So this
 * is the one place in the renderer that builds a CSS colour at runtime, and it
 * builds it from a number the file carried - never from a value somebody chose
 * here. `check:colours` and ESLint both exempt this file for it, with the same
 * reason in `scripts/check-colours.mjs`.
 */

/** Which layers are drawn, by the name the drawing gives them. A name that is absent is drawn. */
export type LayerState = Readonly<Record<string, boolean>>;

/** What the panel can ask of the layer state. */
export type LayerAction =
  | { readonly type: "toggle"; readonly name: string }
  | { readonly type: "showAll" }
  /** Hiding everything needs the drawing's names, which only the reader of the file has. */
  | { readonly type: "hideAll"; readonly names: readonly string[] };

/**
 * The layer state's one writer.
 *
 * The state starts EMPTY rather than fully populated: the drawing's layers are
 * known only after it has been parsed, so `visible(name)` reading `state[name]
 * !== false` is what makes "everything shows until you hide something" true
 * without a fill-in pass whose failure mode is a drawing that renders nothing.
 * `showAll` writes the EMPTY record rather than a true per layer, and that is
 * deliberate: `hideAll` then `showAll` must return to the drawing as it arrived,
 * which an accumulating record of explicit `true`s would not do.
 */
export function layerReducer(state: LayerState, action: LayerAction): LayerState {
  switch (action.type) {
    case "toggle": {
      const next = { ...state };
      if (state[action.name] === false) delete next[action.name];
      else next[action.name] = false;
      return next;
    }
    case "showAll":
      return {};
    case "hideAll": {
      const next: Record<string, boolean> = {};
      for (const name of action.names) next[name] = false;
      return next;
    }
  }
}

/** Whether one layer draws, given the state. Absent means drawn. */
export function isLayerVisible(state: LayerState, name: string): boolean {
  return state[name] !== false;
}

/**
 * The drawing's own colour, as a CSS value.
 *
 * `rgb` is the 24-bit value the library reports (`0xRRGGBB`). Three digits are
 * printed space-separated, which is the modern CSS syntax and needs no commas
 * to be escaped.
 */
export function layerColourCss(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `rgb(${r} ${g} ${b})`;
}
