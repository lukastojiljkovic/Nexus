/**
 * "Sewing & pattern cutting" - the English copy of this toolkit's surfaces.
 *
 * One entry per tool id. `fabric-yardage-repeat` is `zanat`'s and reads
 * `zanat`'s copy; everything else here is the geometry a cutter marks out with
 * a ruler.
 */
export const PRO_KROJENJE_EN = {
  "circle-skirt": {
    waist: "Waist circumference",
    waistHint: "The body measurement, in centimetres, before any allowance.",
    circle: "Fraction of the circle",
    circleFull: "full circle",
    circleHalf: "half circle",
    circleQuarter: "quarter circle",
    length: "Skirt length",
    lengthHint: "From waist to hem, in centimetres.",
    results: "Result",
    waistRadius: "Waist radius",
    hemRadius: "Hem radius",
    waistArc: "Waist arc length",
    hemCircumference: "Hem circumference",
    fabricSquare: "Side of the cutting square",
    formula:
      "r = C / (2π·k)     hem = 2π·k·(r + L)     square = 2·(r + L)     k: 1, ½ or ¼",
    inputs: "Entered",
    errorWaist: "The waist circumference is a number from 30 to 200 cm.",
    errorLength: "The skirt length is a number from 5 to 200 cm.",
    errorCircle: "Choose a full, half or quarter circle.",
    unitCm: "cm",
  },

  "seam-allowance": {
    mode: "Direction",
    modeToCut: "finished to cut",
    modeToFinished: "cut to finished",
    dimension: "Measurement",
    dimensionHint: "In centimetres - finished or cut, depending on the direction.",
    seams: "Number of seams",
    seamsHint:
      "How many seams the measurement crosses: a sleeve length one, a waist two, a middle panel none.",
    allowance: "Allowance per seam",
    allowanceHint: "In centimetres, at each seam.",
    results: "Result",
    cut: "Cut measurement",
    finished: "Finished measurement",
    added: "Total added",
    formula: "cut = finished + n·allowance",
    inputs: "Entered",
    errorMode: "Choose a direction.",
    errorDimension: "The measurement is a number above zero.",
    errorSeams: "The number of seams is a whole number from 0 to 20.",
    errorAllowance: "The allowance per seam is a number from 0 to 10 cm.",
    unitCm: "cm",
  },

  "bias-binding": {
    square: "Side of the square",
    squareHint: "The side of the fabric square, in centimetres.",
    width: "Strip width",
    widthHint: "The width of the finished strip, in centimetres.",
    results: "Result",
    length: "Strip length",
    lengthM: "Strip length, metres",
    strips: "Parallel strips",
    diagonal: "Diagonal of the square",
    formula: "L = s² / w - the square's area divided by the strip width",
    note:
      "The sum is pure area: the seam that joins the two triangles takes one strip width and " +
      "is not deducted.",
    inputs: "Entered",
    errorSquare: "The side of the square is a number from 5 to 500 cm.",
    errorWidth: "The strip width is a number from 0,5 to 50 cm.",
    unitCm: "cm",
    unitM: "m",
  },

  "gather-ratio": {
    flat: "Length before gathering",
    flatHint: "The length of the cut piece, in centimetres.",
    set: "Length after gathering",
    setHint: "The length of the seam it is set into, in centimetres.",
    results: "Result",
    ratio: "Gather ratio",
    ease: "Excess fabric per centimetre",
    formula: "ratio = L_cut / L_seam",
    inputs: "Entered",
    errorFlat: "The length before gathering is a number from 1 to 1000 cm.",
    errorSet: "The length after gathering is a number from 1 to 1000 cm.",
    errorFlatTooShort:
      "The piece before gathering has to be longer than the seam it joins - otherwise it is not a gather.",
    unitCm: "cm",
  },

  "button-spacing": {
    length: "Distance between the end buttons",
    lengthHint: "From the first button's centre to the last one's, in centimetres.",
    buttons: "Number of buttons",
    buttonsHint: "Including both ends.",
    results: "Result",
    spacing: "Centre-to-centre distance",
    positions: "Positions from the first button",
    colButton: "Button",
    colPosition: "Distance from the first",
    formula: "spacing = L / (n − 1)",
    inputs: "Entered",
    errorLength: "The distance is a number from 1 to 200 cm.",
    errorButtons: "The number of buttons is a whole number from 2 to 60.",
    unitCm: "cm",
  },
} as const;
