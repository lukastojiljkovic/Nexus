/**
 * „Stolarija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id — and only ONE, because the pack's other six tools are
 * `zanat`'s and read `zanat`'s copy: `timber-volume`, `stair-geometry`,
 * `mitre-angles`, `shelf-deflection`, `shelf-spacing` and
 * `wood-moisture-movement` all name this pack. What is here is the board foot,
 * the one unit the trade prices in that nothing else in the drawer spoke.
 */
export const PRO_STOLARIJA_SR = {
  "board-foot": {
    mode: "Šta je zadato",
    modePieces: "mere komada",
    modeVolume: "zapremina",
    modeBoardFeet: "bord stope",
    thickness: "Debljina",
    thicknessHint: "Nominalna (gruba) debljina, u milimetrima.",
    width: "Širina",
    widthHint: "U milimetrima.",
    length: "Dužina",
    lengthHint: "U milimetrima.",
    pieces: "Broj komada",
    volume: "Zapremina",
    volumeHint: "U kubnim metrima.",
    boardFeet: "Bord stope",
    boardFeetHint: "U bord stopama.",
    results: "Rezultat",
    resultBoardFeet: "Bord stope",
    resultM3: "Kubni metri",
    resultFt3: "Kubne stope",
    resultPerPiece: "Bord stope po komadu",
    formula: "1 bd ft = 144 in³ = 144 · 25,4³ mm³ = 2 359 737,216 mm³     bd ft = V / 2 359 737,216",
    inputs: "Uneseno",
    errorMode: "Izaberi šta je zadato.",
    errorThickness: "Debljina je broj od 1 do 1000 mm.",
    errorWidth: "Širina je broj od 1 do 2000 mm.",
    errorLength: "Dužina je broj od 10 do 20 000 mm.",
    errorPieces: "Broj komada je ceo broj veći od nule.",
    errorVolume: "Zapremina je broj veći od nule.",
    errorBoardFeet: "Bord stope su broj veći od nule.",
    unitMm: "mm",
    unitM3: "m³",
    unitFt3: "ft³",
    unitBdFt: "bd ft",
  },
} as const;
