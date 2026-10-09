/**
 * „Auto" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **Two tools print a number beside a limit the user typed and say nothing about
 * the pair.** Mean piston speed and compression ratio are quantities; whether a
 * build's limit or a fuel's tolerance applies is the person at the engine's call.
 *
 * **A unit is copy, not a constant.** „mm", „cm³", „cc/min" and „lb/h" are
 * written here rather than concatenated in the surface.
 */
export const PRO_AUTO_SR = {
  "engine-displacement": {
    bore: "Prečnik cilindra",
    stroke: "Hod klipa",
    cylinders: "Broj cilindara",
    results: "Rezultat",
    perCylinder: "Zapremina jednog cilindra",
    total: "Ukupna radna zapremina",
    totalLitres: "Radna zapremina u litrima",
    boreStrokeRatio: "Odnos prečnika i hoda",
    formulaLine: "V_h = π/4·b²·s     V = V_h·n",
    inputs: "Uneseno",
    unitMm: "mm",
    unitCc: "cm³",
    unitL: "l",
    errorBore: "Prečnik cilindra je između 10 i 400 mm.",
    errorStroke: "Hod klipa je između 10 i 400 mm.",
    errorCylinders: "Broj cilindara je ceo broj od 1 do 16.",
  },

  "compression-ratio": {
    bore: "Prečnik cilindra",
    stroke: "Hod klipa",
    chamberVolume: "Zapremina komore sagorevanja",
    gasketVolume: "Zapremina dihtunga glave",
    gasketHint: "Pri sabijenoj debljini. Prazno polje znači nula.",
    deckVolume: "Zapremina nivoa klipa",
    deckHint: "Prostor između čela klipa i glave u gornjoj mrtvoj tački. Prazno polje znači nula.",
    pistonVolume: "Zapremina čela klipa",
    pistonHint:
      "Pozitivno za udubljenje, negativno za ispupčenje. Prazno polje znači nula.",
    results: "Rezultat",
    compressionRatio: "Stepen kompresije",
    sweptVolume: "Radna zapremina cilindra",
    clearanceVolume: "Zapremina komore sabijanja",
    formulaLine: "ε = (V_h + V_c)/V_c     V_c = komora + dihtung + nivo + čelo",
    inputs: "Uneseno",
    unitCc: "cm³",
    errorBore: "Prečnik cilindra je između 10 i 400 mm.",
    errorStroke: "Hod klipa je između 10 i 400 mm.",
    errorChamber: "Zapremina komore je između 0,5 i 1000 cm³.",
    errorGasket: "Zapremina dihtunga je između −500 i 500 cm³.",
    errorDeck: "Zapremina nivoa klipa je između −500 i 500 cm³.",
    errorPiston: "Zapremina čela klipa je između −500 i 500 cm³.",
    errorClearance: "Ukupna zapremina komore sabijanja mora biti veća od nule.",
  },

  "mean-piston-speed": {
    stroke: "Hod klipa",
    rpm: "Broj obrtaja",
    limit: "Granica za ovu izradu",
    limitHint:
      "Iz podataka o motoru ili izrade. Nexus je ne zna i ne nudi vrednost; prazno polje je " +
      "izostavlja.",
    results: "Rezultat",
    speed: "Srednja brzina klipa",
    speedRatio: "Odnos prema granici",
    speedPer1000Rpm: "Brzina na 1000 obrtaja",
    speedFpm: "Srednja brzina u stopama u minuti",
    formulaLine: "v̄ = 2·s·n/60",
    inputs: "Uneseno",
    unitMm: "mm",
    unitMs: "m/s",
    unitRpm: "o/min",
    unitFpm: "ft/min",
    errorStroke: "Hod klipa je između 10 i 400 mm.",
    errorRpm: "Broj obrtaja je između 100 i 30 000 u minuti.",
    errorLimit: "Granica je između 1 i 60 m/s.",
  },

  "injector-flow": {
    targetPower: "Ciljna snaga motora",
    bsfc: "Specifična potrošnja",
    bsfcHint:
      "U gramima po kilovat-času, iz podataka o motoru. Benzin i dizel imaju različite vrednosti.",
    cylinders: "Broj cilindara",
    duty: "Najveći radni ciklus dizne",
    dutyHint: "U procentima vremena ciklusa. 80 % je uobičajena vrednost i tvoja je.",
    fuelDensity: "Gustina goriva",
    fuelDensityHint: "U kilogramima po litru, na radnoj temperaturi. Nije unapred postavljena.",
    results: "Rezultat",
    fuelMassFlow: "Potrošnja goriva",
    fuelVolumeFlow: "Zapreminska potrošnja",
    injectorFlow: "Potreban protok jedne dizne",
    injectorFlowCcPerMin: "Protok dizne u cm³/min",
    injectorFlowLbPerH: "Protok dizne u lb/h",
    dutyUsed: "Uračunat radni ciklus",
    sizingNote:
      "Ovo je veličina dizne. Da li pumpa, vodovi i mapa mogu da je isprate nije u ovom računu.",
    formulaLine: "ṁ = P·BSFC     po dizni = ṁ/n ÷ (ciklus/100)     1 lb = 0,45359237 kg",
    inputs: "Uneseno",
    unitKgPerH: "kg/h",
    unitLPerH: "l/h",
    unitCcPerMin: "cm³/min",
    unitLbPerH: "lb/h",
    unitGKwh: "g/kWh",
    unitKgPerL: "kg/l",
    errorPower: "Ciljna snaga je između 0,1 i 5000 kW.",
    errorBsfc: "Specifična potrošnja je između 50 i 1000 g/kWh.",
    errorCylinders: "Broj cilindara je ceo broj od 1 do 16.",
    errorDuty: "Radni ciklus je između 10 i 100 procenata.",
    errorDensity: "Gustina goriva je između 0,5 i 1,5 kg/l.",
  },

  "air-fuel-ratio": {
    mode: "Režim",
    modeFromMasses: "Odnos iz izmerenih masa",
    modeForTarget: "Gorivo za ciljni odnos",
    airMass: "Masa vazduha",
    fuelMass: "Masa goriva",
    targetAfr: "Ciljni odnos vazduh-gorivo",
    stoichiometricAfr: "Stehiometrijski odnos goriva",
    stoichiometricHint:
      "Odnos za gorivo koje koristiš — benzin oko 14,7, E85 oko 9,8, dizel oko 14,5. Lambda se " +
      "računa samo kad je ovaj broj unet.",
    results: "Rezultat",
    airFuelRatio: "Odnos vazduh-gorivo",
    lambda: "Lambda",
    formulaLine: "AFR = m_vazduha/m_goriva     λ = AFR/AFR_steh",
    inputs: "Uneseno",
    notGiven: "nije uneto",
    unitG: "g",
    errorAir: "Masa vazduha mora biti veća od nule.",
    errorFuel: "Masa goriva mora biti veća od nule.",
    errorTarget: "Ciljni odnos je između 1 i 40.",
    errorStoich: "Stehiometrijski odnos je između 1 i 40.",
  },

  "wheel-offset": {
    rimWidth: "Širina felne",
    offset: "ET (offset)",
    offsetHint:
      "U milimetrima. Pozitivno znači da je naleganje prema spolja, pa felna ide dublje u auto.",
    referenceWidth: "Širina druge felne",
    referenceHint: "Za poređenje. Ostavi prazno ako ne porediš dve felne.",
    referenceOffset: "ET druge felne",
    results: "Rezultat",
    rimWidthMm: "Širina felne u milimetrima",
    backspace: "Backspace",
    backspaceIn: "Backspace u inčima",
    frontSpace: "Spoljna mera",
    outerFaceShift: "Pomeranje spoljne ivice",
    innerFaceShift: "Pomeranje unutrašnje ivice",
    shiftNote:
      "Oba pomeranja su u smeru ka spolja — pozitivno znači dalje od auta. Da li ivica kači " +
      "oprugu ili blatobran nije u ovom računu.",
    formulaLine: "backspace = W/2 + ET     spoljna mera = W/2 − ET",
    inputs: "Uneseno",
    unitMm: "mm",
    unitIn: "in",
    errorWidth: "Širina felne je između 3 i 20 inča.",
    errorOffset: "ET je između −120 i 150 mm.",
    errorReference: "Za poređenje unesi i širinu i ET druge felne, ili nijedno.",
  },
} as const;
