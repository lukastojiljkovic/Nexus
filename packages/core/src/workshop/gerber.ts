/**
 * What a board's files ARE, and how big the board is - the pure half of the
 * Gerber viewer.
 *
 * **Why the role comes from the file's own header first.** RS-274X has an X2
 * attribute that states the layer's function in the file itself
 * (`%TF.FileFunction,Copper,L1,Top*%`), and a file that carries one has already
 * answered this question: reading it is a fact, where reading the name is a
 * convention. So the header wins, and the file name - the suffix table below,
 * which is what the common exporters write - is the fallback for the X1 files
 * (and the hand-renamed ones) that carry no attribute.
 *
 * **Why this is separate from the conversion.** Turning Gerber into SVG is the
 * `gerber-to-svg` library's job and runs in the main process, which is the only
 * place in this app where Node's stream builtins exist; deciding what a layer IS
 * and how big the board is needs no library at all and is arithmetic that can be
 * tested on its own. `main/gerber.ts` in the module calls both halves.
 *
 * **The board's size is the OUTLINE's when the board has one.** A copper layer's
 * box is where its tracks and pads are, which is smaller than the board; the
 * profile layer is the board. When no outline was opened the union of what was
 * opened is the honest answer, and `from` says which of the two the page is
 * showing so it can say it too.
 */

/** Largest single Gerber or Excellon file this module reads, in bytes (8 MiB: a dense board is far under it). */
export const GERBER_MAX_BYTES = 8 * 1024 * 1024;

/** Most files one board may be opened from - the number of layers a maker's board realistically has. */
export const GERBER_MAX_FILES = 16;

/**
 * What a file is on the board.
 *
 * The ids are the keys the page's Serbian and English layer names are looked up
 * by, so a role added here is a compile error in both copy tables rather than a
 * raw id on screen.
 */
export type GerberRole =
  | "copper-top"
  | "copper-bottom"
  | "copper-inner"
  | "mask-top"
  | "mask-bottom"
  | "silk-top"
  | "silk-bottom"
  | "paste-top"
  | "paste-bottom"
  | "outline"
  | "drill"
  | "other";

/** Every role, in the order the page lists layers when their roles are otherwise equal. */
export const GERBER_ROLES: readonly GerberRole[] = [
  "copper-top",
  "copper-bottom",
  "copper-inner",
  "mask-top",
  "mask-bottom",
  "silk-top",
  "silk-bottom",
  "paste-top",
  "paste-bottom",
  "outline",
  "drill",
  "other",
];

/** One layer's box on the board, in millimetres, as the library reported it. */
export interface GerberLayerBox {
  readonly role: GerberRole;
  readonly originXmm: number;
  readonly originYmm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** The board's size, and which half of the rule answered it. */
export interface GerberBoardSize {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly from: "outline" | "layers";
}

/**
 * What one file is, from its header if it declares a function and from its name
 * otherwise.
 *
 * `header` is the file's first few kilobytes - enough for the `%TF` attributes,
 * which the format puts at the top - and is passed in rather than read here so
 * this stays a pure function.
 */
export function gerberRoleOf(fileName: string, header = ""): GerberRole {
  const declared = roleFromFileFunction(header);
  if (declared !== null) return declared;
  return roleFromFileName(fileName);
}

/**
 * The X2 `FileFunction` attribute, or `null` when the file declares none.
 *
 * The value is a comma-separated list after the attribute's name, and only its
 * first and last fields carry what this needs: `Copper,L1,Top`,
 * `Soldermask,Bot`, `Legend,Top`, `Profile,NP`, `Drill`. A value this function
 * does not recognise answers `null` rather than `other`, so the name still gets
 * its chance at a file that declares something new.
 */
function roleFromFileFunction(header: string): GerberRole | null {
  const match = /%TF\.FileFunction,([^*%]*)[*%]/.exec(header);
  const value = match?.[1]?.trim().toLowerCase();
  if (value === undefined || value === "") return null;
  const parts = value.split(",").map((part) => part.trim());
  const kind = parts[0] ?? "";
  const side = parts[parts.length - 1] ?? "";
  const isBottom = side === "bot" || side === "bottom" || side === "b";
  if (kind === "copper") {
    if (side === "top" || side === "t") return "copper-top";
    if (isBottom) return "copper-bottom";
    // `Copper,L2,Inr` and friends: an inner layer names neither side.
    if (parts.some((part) => part === "inr" || part.startsWith("in"))) return "copper-inner";
    return "copper-top";
  }
  if (kind === "soldermask" || kind === "solder-mask" || kind === "mask") {
    return isBottom ? "mask-bottom" : "mask-top";
  }
  if (kind === "legend" || kind === "silkscreen" || kind === "silk") {
    return isBottom ? "silk-bottom" : "silk-top";
  }
  if (kind === "paste" || kind === "solderpaste") {
    return isBottom ? "paste-bottom" : "paste-top";
  }
  if (kind === "profile") return "outline";
  if (kind === "drill" || kind === "drillmap") return "drill";
  return null;
}

/**
 * The name's own answer: the two naming conventions the common exporters write,
 * which is the X2 suffix (a `-F_Cu` tail, in files KiCad plots) and the older
 * extension family (`.gtl`, `.gbl`, and the rest).
 *
 * `.gbr` alone is deliberately `other`: every X2 file is `.gbr`, so the
 * extension there says only "this is Gerber", and guessing which layer it is
 * would put a track layer under the name "silk".
 */
function roleFromFileName(fileName: string): GerberRole {
  const name = fileName.toLowerCase();
  const stem = name.replace(/\.[a-z0-9]+$/, "");
  for (const [pattern, role] of NAME_RULES) {
    if (pattern.test(name) || pattern.test(stem)) return role;
  }
  return "other";
}

/** The suffix table, in the order it is tried: the more specific a suffix, the earlier it is. */
const NAME_RULES: readonly (readonly [RegExp, GerberRole])[] = [
  // X2 suffixes: `board-F_Cu.gbr`, `board-B_SilkS.gbr`, `board-In1_Cu.gbr`.
  [/(^|[-_.])f_cu$/, "copper-top"],
  [/(^|[-_.])b_cu$/, "copper-bottom"],
  [/(^|[-_.])in[0-9]+_cu$/, "copper-inner"],
  [/(^|[-_.])f_mask$/, "mask-top"],
  [/(^|[-_.])b_mask$/, "mask-bottom"],
  [/(^|[-_.])f_silks$/, "silk-top"],
  [/(^|[-_.])b_silks$/, "silk-bottom"],
  [/(^|[-_.])f_paste$/, "paste-top"],
  [/(^|[-_.])b_paste$/, "paste-bottom"],
  [/(^|[-_.])edge_cuts$/, "outline"],
  // The extension family.
  [/\.gtl$/, "copper-top"],
  [/\.gbl$/, "copper-bottom"],
  [/\.g[0-9]+$/, "copper-inner"],
  [/\.gts$/, "mask-top"],
  [/\.gbs$/, "mask-bottom"],
  [/\.gto$/, "silk-top"],
  [/\.gbo$/, "silk-bottom"],
  [/\.gtp$/, "paste-top"],
  [/\.gbp$/, "paste-bottom"],
  [/\.gko$/, "outline"],
  [/\.gm[0-9]+$/, "outline"],
  [/\.drl$/, "drill"],
  [/\.xln$/, "drill"],
  [/\.nc$/, "drill"],
  // A plain `-PTH.drl`/`-NPTH.drl` pair is already `.drl`; a drill file that was
  // renamed to `.txt` is the last convention worth recognising.
  [/(^|[-_.])(pth|npth|drill|drills)\.txt$/, "drill"],
];

/**
 * One layer's box, in millimetres, from what the library reported.
 *
 * `gerber-to-svg` answers a `viewBox` in the file's own coordinate units plus
 * the width and height in millimetres, so the scale between the two is derived
 * here rather than assumed: `viewBox[2] / widthMm` is the file's units per
 * millimetre, and the origin follows from it. Deriving it is what makes this
 * correct for an inch-unit file as well as a metric one.
 */
export function gerberBoxMm(
  role: GerberRole,
  viewBox: readonly number[],
  widthMm: number,
  heightMm: number,
): GerberLayerBox {
  const [x = 0, y = 0, viewWidth = 0, viewHeight = 0] = viewBox;
  const unitsPerMmX = widthMm > 0 ? viewWidth / widthMm : 0;
  const unitsPerMmY = heightMm > 0 ? viewHeight / heightMm : 0;
  return {
    role,
    originXmm: unitsPerMmX > 0 ? x / unitsPerMmX : 0,
    originYmm: unitsPerMmY > 0 ? y / unitsPerMmY : 0,
    widthMm,
    heightMm,
  };
}

/**
 * The board's size, from the layers that were opened.
 *
 * The outline layer wins when one is there, because that layer IS the board:
 * its box is the cut line, where a copper layer's box is where its geometry
 * happens to reach. Otherwise the union of every opened layer is the answer,
 * and `from` records which one was used so the page can say "the opened layers"
 * rather than implying it knows the outline.
 *
 * The union is inclusive of each box's far edge, so two boxes that abut produce
 * the size their contents actually span.
 */
export function boardSizeMm(layers: readonly GerberLayerBox[]): GerberBoardSize {
  const outline = layers.filter((layer) => layer.role === "outline");
  const measured = outline.length > 0 ? outline : layers;
  if (measured.length === 0) return { widthMm: 0, heightMm: 0, from: "layers" };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layer of measured) {
    minX = Math.min(minX, layer.originXmm);
    minY = Math.min(minY, layer.originYmm);
    maxX = Math.max(maxX, layer.originXmm + layer.widthMm);
    maxY = Math.max(maxY, layer.originYmm + layer.heightMm);
  }
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    from: outline.length > 0 ? "outline" : "layers",
  };
}
