/**
 * "Woodworking" - the English copy of this toolkit's surfaces.
 *
 * One entry per tool id — and only ONE, because the pack's other six tools are
 * `zanat`'s and read `zanat`'s copy: `timber-volume`, `stair-geometry`,
 * `mitre-angles`, `shelf-deflection`, `shelf-spacing` and
 * `wood-moisture-movement` all name this pack.
 */
export const PRO_STOLARIJA_EN = {
  "board-foot": {
    mode: "What is given",
    modePieces: "piece dimensions",
    modeVolume: "a volume",
    modeBoardFeet: "board feet",
    thickness: "Thickness",
    thicknessHint: "Nominal (rough) thickness, in millimetres.",
    width: "Width",
    widthHint: "In millimetres.",
    length: "Length",
    lengthHint: "In millimetres.",
    pieces: "Number of pieces",
    volume: "Volume",
    volumeHint: "In cubic metres.",
    boardFeet: "Board feet",
    boardFeetHint: "In board feet.",
    results: "Result",
    resultBoardFeet: "Board feet",
    resultM3: "Cubic metres",
    resultFt3: "Cubic feet",
    resultPerPiece: "Board feet per piece",
    formula: "1 bd ft = 144 in³ = 144 · 25,4³ mm³ = 2 359 737,216 mm³     bd ft = V / 2 359 737,216",
    inputs: "Entered",
    errorMode: "Choose what is given.",
    errorThickness: "The thickness is a number from 1 to 1000 mm.",
    errorWidth: "The width is a number from 1 to 2000 mm.",
    errorLength: "The length is a number from 10 to 20 000 mm.",
    errorPieces: "The number of pieces is a whole number above zero.",
    errorVolume: "The volume is a number above zero.",
    errorBoardFeet: "The board feet figure is a number above zero.",
    unitMm: "mm",
    unitM3: "m³",
    unitFt3: "ft³",
    unitBdFt: "bd ft",
  },
} as const;
