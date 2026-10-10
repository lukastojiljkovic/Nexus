/**
 * „Vino i rakija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration.
 *
 * **Calculations only, and the copy says which ones are refused.** The Brix to
 * specific-gravity relation is a published TABLE and the OIML R 22
 * temperature correction is not in this repository, so neither is offered;
 * what is exact — Oechsle's own definition, Brix as a mass fraction, and
 * Gay-Lussac's stoichiometry — is what these tools compute. Nothing here says
 * how much to drink or what a wine should contain.
 */
export const PRO_VINO_SR = {
  "must-sugar": {
    brix: "Brix (refraktometar)",
    brixHint: "Očitavanje refraktometra, u °Bx.",
    sg: "Specifična težina (hidrometar)",
    sgHint: "Očitavanje hidrometra — npr. 1,090, a ne 90.",
    volume: "Zapremina mošta",
    volumeHint: "U litrima. Bez nje se daju samo koncentracije.",
    yieldFactor: "Prinos fermentacije",
    yieldFactorHint:
      "Grami etanola po gramu šećera. Teoretski maksimum je 0,511; u praksi 0,46 do 0,47. " +
      "Ostavi prazno za teoretski.",
    results: "Rezultat",
    oechsle: "Oechsle",
    sugarPer100g: "Šećer u moštu",
    sugarPerL: "Šećer po litru",
    sugarKg: "Ukupan šećer",
    potentialAbv: "Potencijalni alkohol",
    yieldUsed: "Upotrebljen prinos",
    yieldTheoretical: "teoretski",
    yieldGiven: "unet",
    perPercent: "Šećer za 1 % alkohola",
    formula:
      "°Oe = (SG − 1)·1000     c = Bx·10·SG     ABV = c·y / 7,893     y = prinos, g/g",
    note:
      "Za koncentraciju u g/L trebaju oba očitavanja: refraktometar daje maseni udeo, " +
      "hidrometar gustinu. Brix se ne preračunava u specifičnu težinu.",
    inputs: "Uneseno",
    errorBrix: "Brix je broj od 0 do 60.",
    errorSg: "Specifična težina je broj od 0,9 do 1,3.",
    errorVolume: "Zapremina je broj veći od nule.",
    errorYield: "Prinos je broj od 0,3 do 0,55 g/g.",
    errorEmpty: "Unesi bar jedno očitavanje — Brix ili specifičnu težinu.",
    unitBrix: "°Bx",
    unitOe: "°Oe",
    unitGPerL: "g/L",
    unitGPer100g: "g/100 g",
    unitKg: "kg",
    unitPercent: "% v/v",
  },

  "sugar-addition": {
    volume: "Zapremina mošta",
    volumeHint: "U litrima.",
    current: "Šećer već u moštu",
    currentHint: "U g/L. Za suv mošt ostavi 0, ili prazno.",
    target: "Ciljani alkohol",
    targetHint: "Potencijalni alkohol koji se želi, u % v/v.",
    yieldFactor: "Prinos fermentacije",
    yieldFactorHint:
      "Grami etanola po gramu šećera. Ostavi prazno za teoretski 0,511; u praksi 0,46 do 0,47.",
    results: "Rezultat",
    required: "Potreban šećer po litru",
    additionPerL: "Dodatak po litru",
    additionKg: "Ukupno dodati šećer",
    totalKg: "Ukupan šećer u moštu",
    negativeNote:
      "Negativna vrednost znači da mošt već nosi više šećera nego što cilj traži.",
    formula: "c_cilj = ABV·7,893 / y     dodatak = c_cilj − c_sadašnji     m = dodatak·V/1000",
    inputs: "Uneseno",
    errorVolume: "Zapremina je broj veći od nule.",
    errorCurrent: "Šećer u moštu je broj od 0 do 500 g/L.",
    errorTarget: "Ciljani alkohol je broj od 0,1 do 25 % v/v.",
    errorYield: "Prinos je broj od 0,3 do 0,55 g/g.",
    unitL: "l",
    unitGPerL: "g/L",
    unitKg: "kg",
    unitPercent: "% v/v",
  },

  "abv-gravity": {
    og: "Početna gustina (OG)",
    ogHint: "Specifična težina pre vrenja, npr. 1,050.",
    fg: "Krajnja gustina (FG)",
    fgHint: "Specifična težina po vrenju, npr. 1,010.",
    results: "Rezultat",
    drop: "Pad gustine",
    abv: "Alkohol po zapremini",
    abw: "Alkohol po masi",
    attenuation: "Naizgledna fermentacija",
    formula:
      "ABV = (OG − FG)·131,25     ABW = (OG − FG)·105     fermentacija = (OG − FG)/(OG − 1)·100",
    note:
      "Obe jednačine su linearna pravila sa Balling/Plato skale: tačna su u uobičajenim " +
      "pivskim granicama i odstupaju na krajevima.",
    inputs: "Uneseno",
    errorOg: "Početna gustina je broj od 1 do 1,3.",
    errorFg: "Krajnja gustina je broj od 0,98 do 1,3 i nije veća od početne.",
    unitPercent: "% v/v",
    unitPercentW: "% w/w",
    unitPercentAtten: "%",
  },

  "spirit-dilution": {
    direction: "Smer",
    directionDilute: "razblaživanje",
    directionFortify: "pojačavanje",
    current: "Sadašnja jačina",
    currentHint: "U % v/v.",
    target: "Ciljana jačina",
    targetHint: "U % v/v.",
    volume: "Zapremina u posudi",
    volumeHint: "U litrima.",
    addedStrength: "Jačina onoga što se dodaje",
    addedStrengthHint: "Za vodu ostavi 0. Za destilat unesi njegovu jačinu, u % v/v.",
    results: "Rezultat",
    addedVolume: "Treba dodati",
    finalVolume: "Zapremina posle dodavanja",
    alcohol: "Alkohol u posudi",
    formula: "V₁·C₁ + V_a·C_a = (V₁ + V_a)·C₂",
    note:
      "Ovo je prosta jednačina mešanja i skupljanje zapremine nije uračunato — etanol i " +
      "voda ne sabiraju zapremine linearno, a OIML tablice za to nisu u Nexusu.",
    inputs: "Uneseno",
    errorDirection: "Izaberi smer.",
    errorCurrent: "Sadašnja jačina je broj od 0 do 96 % v/v.",
    errorTarget: "Ciljana jačina je broj od 0 do 96 % v/v.",
    errorVolume: "Zapremina je broj veći od nule.",
    errorAdded: "Jačina dodatka je broj od 0 do 96 % v/v.",
    errorTargetDilute: "Za razblaživanje cilj mora biti niži od sadašnje jačine.",
    errorTargetFortify: "Za pojačavanje cilj mora biti viši od sadašnje jačine.",
    errorAddedBelowTarget: "Dodatak mora biti slabiji od cilja — inače cilj nije dostižan.",
    errorAddedAboveTarget: "Dodatak mora biti jači od cilja — inače cilj nije dostižan.",
    unitL: "l",
    unitPercent: "% v/v",
  },

  "sulfite": {
    mode: "Šta je zadato",
    modeFromMetabisulfite: "količina metabisulfita",
    modeFromSo2: "količina SO₂",
    metabisulfite: "Kalijum metabisulfit",
    metabisulfiteHint: "Masa, u gramima.",
    so2: "Sumpordioksid SO₂",
    so2Hint: "Masa, u gramima.",
    volume: "Zapremina",
    volumeHint: "U litrima. Bez nje se daju samo mase.",
    results: "Rezultat",
    so2Mass: "SO₂ iz ove količine",
    metabisulfiteMass: "Metabisulfit za ovu količinu",
    so2PerL: "SO₂ po litru",
    metabisulfitePerL: "Metabisulfit po litru",
    fraction: "Udeo SO₂ u metabisulfitu",
    formula: "K₂S₂O₅ → 2 SO₂     m(SO₂) = m(K₂S₂O₅) · 2·M(SO₂) / M(K₂S₂O₅)",
    note:
      "Ovo je masa dodatog SO₂, ne slobodni SO₂ u vinu: deo se veže, a koliko ostaje slobodno " +
      "zavisi od vina i njegove kiseline.",
    inputs: "Uneseno",
    errorMode: "Izaberi šta je zadato.",
    errorMetabisulfite: "Masa metabisulfita je broj od 0 g naviše.",
    errorSo2: "Masa SO₂ je broj od 0 g naviše.",
    errorVolume: "Zapremina je broj veći od nule.",
    errorKnown: "Zadaj ili metabisulfit ili SO₂ — ne oba.",
    unitG: "g",
    unitMgPerL: "mg/L",
    unitL: "l",
  },
} as const;
