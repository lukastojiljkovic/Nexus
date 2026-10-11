/**
 * „Krojenje" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id. `fabric-yardage-repeat` is `zanat`'s and reads
 * `zanat`'s copy; everything else here is the geometry a cutter marks out with
 * a ruler. **Nothing in this pack is a trade rule**: a radius and an allowance
 * are divisions, a bias length is an area, and the gathering ratio is a
 * property of the cloth that the user's own two lengths measure.
 */
export const PRO_KROJENJE_SR = {
  "circle-skirt": {
    waist: "Obim struka",
    waistHint: "Mera tela, u centimetrima, pre ikakvog dodatka.",
    circle: "Deo kruga",
    circleFull: "pun krug",
    circleHalf: "polukrug",
    circleQuarter: "četvrt kruga",
    length: "Dužina suknje",
    lengthHint: "Od struka do poruba, u centimetrima.",
    results: "Rezultat",
    waistRadius: "Poluprečnik struka",
    hemRadius: "Poluprečnik poruba",
    waistArc: "Dužina luka struka",
    hemCircumference: "Obim poruba",
    fabricSquare: "Stranica kvadrata za kroj",
    formula:
      "r = C / (2π·k)     porub = 2π·k·(r + L)     kvadrat = 2·(r + L)     k: 1, ½ ili ¼",
    inputs: "Uneseno",
    errorWaist: "Obim struka je broj od 30 do 200 cm.",
    errorLength: "Dužina suknje je broj od 5 do 200 cm.",
    errorCircle: "Izaberi pun krug, polukrug ili četvrtinu.",
    unitCm: "cm",
  },

  "seam-allowance": {
    mode: "Smer računa",
    modeToCut: "iz gotove mere u krojnju",
    modeToFinished: "iz krojne mere u gotovu",
    dimension: "Mera",
    dimensionHint: "U centimetrima — gotova ili krojna, zavisno od smera.",
    seams: "Broj šavova",
    seamsHint:
      "Koliko šavova mera prelazi: dužina rukava jedan, obim struka dva, srednji panel nijedan.",
    allowance: "Dodatak po šavu",
    allowanceHint: "U centimetrima, na svakom šavu.",
    results: "Rezultat",
    cut: "Krojna mera",
    finished: "Gotova mera",
    added: "Ukupno dodato",
    formula: "krojna = gotova + n·dodatak",
    inputs: "Uneseno",
    errorMode: "Izaberi smer računa.",
    errorDimension: "Mera je broj veći od nule.",
    errorSeams: "Broj šavova je ceo broj od 0 do 20.",
    errorAllowance: "Dodatak po šavu je broj od 0 do 10 cm.",
    unitCm: "cm",
  },

  "bias-binding": {
    square: "Stranica kvadrata",
    squareHint: "Stranica kvadrata tkanine, u centimetrima.",
    width: "Širina trake",
    widthHint: "Širina gotove trake, u centimetrima.",
    results: "Rezultat",
    length: "Dužina trake",
    lengthM: "Dužina trake, metri",
    strips: "Broj paralelnih traka",
    diagonal: "Dijagonala kvadrata",
    formula: "L = s² / w — površina kvadrata podeljena širinom trake",
    note:
      "Račun je čista površina: šav koji spaja dva trougla uzima jednu širinu trake i nije " +
      "oduzet.",
    inputs: "Uneseno",
    errorSquare: "Stranica kvadrata je broj od 5 do 500 cm.",
    errorWidth: "Širina trake je broj od 0,5 do 50 cm.",
    unitCm: "cm",
    unitM: "m",
  },

  "gather-ratio": {
    flat: "Dužina pre nabiranja",
    flatHint: "Dužina krojenog komada, u centimetrima.",
    set: "Dužina posle nabiranja",
    setHint: "Dužina šava u koji se komad ugrađuje, u centimetrima.",
    results: "Rezultat",
    ratio: "Odnos nabiranja",
    ease: "Višak tkanine po centimetru",
    formula: "odnos = L_krojena / L_šava",
    inputs: "Uneseno",
    errorFlat: "Dužina pre nabiranja je broj od 1 do 1000 cm.",
    errorSet: "Dužina posle nabiranja je broj od 1 do 1000 cm.",
    errorFlatTooShort:
      "Komad pre nabiranja mora biti duži od šava u koji se ugrađuje — inače to nije nabiranje.",
    unitCm: "cm",
  },

  "button-spacing": {
    length: "Rastojanje između krajnjih dugmadi",
    lengthHint: "Od centra prvog do centra poslednjeg dugmeta, u centimetrima.",
    buttons: "Broj dugmadi",
    buttonsHint: "Uključujući oba krajnja.",
    results: "Rezultat",
    spacing: "Rastojanje između centara",
    positions: "Položaji od prvog dugmeta",
    colButton: "Dugme",
    colPosition: "Rastojanje od prvog",
    formula: "rastojanje = L / (n − 1)",
    inputs: "Uneseno",
    errorLength: "Rastojanje je broj od 1 do 200 cm.",
    errorButtons: "Broj dugmadi je ceo broj od 2 do 60.",
    unitCm: "cm",
  },
} as const;
