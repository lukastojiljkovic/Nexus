/**
 * „Energija — solarni i vanmrežni sistemi" — the Serbian copy of this toolkit's
 * surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/energija.ts` spell it. The tool's NAME and its one-line
 * blurb are not here — those live in `./pro.ts`.
 *
 * **The peak sun hours are the user's figure, and the copy says so in as many
 * words.** Nexus carries no irradiance table: a monthly average for a place the
 * app has never seen is exactly the fabricated source the whole drawer is built
 * to refuse, and a hint that names where the number comes from is the honest
 * alternative to shipping one.
 *
 * **Nothing here is a limit.** The depth of discharge belongs to the battery,
 * the derate to the array, and the margin on the controller to whoever is
 * designing the installation — every one of them is a field with no default.
 */
export const PRO_ENERGIJA_SR = {
  "device-daily-energy": {
    devices: "Uređaji",
    devicesHint:
      "Jedan red po uređaju: „naziv; vati; sati dnevno“ — na primer „Frižider; 150; 24“.",

    results: "Rezultat",
    tableName: "Uređaj",
    tableWatts: "Snaga",
    tableHours: "Sati dnevno",
    tableWattHours: "Dnevno",
    outTotal: "Ukupno dnevno",
    outTotalKwh: "Ukupno u kWh dnevno",
    outConnected: "Zbirna snaga uređaja",
    note:
      "Ovo je dnevna potrošnja, ne istovremeno opterećenje — zbirna snaga uređaja ne znači da " +
      "svi rade u istom trenutku.",

    formula:
      "E = Σ Pᵢ·tᵢ — snaga puta vreme, sabrano po uređajima. Ovo je dnevna energija u vat-satima.",

    errorDevices: "Upiši bar jedan uređaj u obliku „naziv; vati; sati dnevno“.",
    errorRow:
      "Svaki red mora imati snagu veću od nule i sate dnevno između 0 i 24, a oblik „naziv; vati; " +
      "sati dnevno“.",

    unitW: "W",
    unitWh: "Wh",
    unitKwh: "kWh",
    unitH: "h",
  },

  "battery-bank-sizing": {
    dailyEnergy: "Dnevna potrošnja",
    dailyEnergyHint: "U vat-satima (Wh) dnevno.",
    autonomy: "Dani autonomije",
    autonomyHint: "Koliko dana bez sunca. Tvoja odluka — nema podrazumevane vrednosti.",
    depthOfDischarge: "Dubina pražnjenja",
    depthOfDischargeHint:
      "U procentima — podatak baterije i njene garancije, na primer 50 za olovnu ili 80 za " +
      "litijumsku.",
    voltage: "Napon sistema",
    voltageHint: "U voltima.",

    results: "Rezultat",
    outLoad: "Potrošnja za taj period",
    outRequiredWh: "Potrebna nominalna energija banke",
    outRequiredAh: "Potreban kapacitet banke",
    note:
      "Gubici invertora i samog punjenja nisu uračunati — oni povećavaju potrebnu banku, pa ih " +
      "dodaj sam ako ih znaš.",

    formula:
      "E = E_dnevno · N; nominalna energija = E/DoD; kapacitet = nominalna energija/U, gde je U " +
      "napon sistema.",

    errorDailyEnergy: "Dnevna potrošnja je pozitivan broj vat-sati.",
    errorAutonomy: "Autonomija je između 0,5 i 365 dana.",
    errorDepthOfDischarge: "Dubina pražnjenja je između 5 i 100 %.",
    errorVoltage: "Napon sistema je pozitivan broj volti.",

    unitWh: "Wh",
    unitAh: "Ah",
    unitV: "V",
    unitDays: "dana",
    unitPercent: "%",
  },

  "array-sizing": {
    dailyEnergy: "Dnevna potrošnja",
    dailyEnergyHint: "U vat-satima (Wh) dnevno.",
    peakSunHours: "Vršni sunčani sati",
    peakSunHoursHint:
      "Ekvivalent punih sati na 1 000 W/m² za tvoju lokaciju, nagib i mesec — iz lokalne karte " +
      "sunčanja. Nexus ne nosi podatke o sunčanju.",
    derate: "Sistemski gubici",
    derateHint:
      "U procentima: kabliranje, prljavština, temperatura i regulator. Tipično 75–85 %, ali to je " +
      "tvoja procena za tvoj sistem.",
    panelWp: "Snaga panela",
    panelWpHint: "U Wp. Prazno znači da se prikazuje samo veličina polja.",

    results: "Rezultat",
    outArray: "Potrebno polje",
    outDerate: "Uračunati gubici",
    outPanels: "Broj panela",
    outInstalled: "Ugrađena snaga",

    formula:
      "P = E_dnevno/(PSH · η), gde su PSH vršni sunčani sati koje uneseš, a η udeo koji ostaje " +
      "posle gubitaka. Broj panela se zaokružuje naviše.",

    errorDailyEnergy: "Dnevna potrošnja je pozitivan broj vat-sati.",
    errorPeakSunHours: "Vršni sunčani sati su između 0,5 i 12.",
    errorDerate: "Sistemski gubici su između 20 i 100 %.",
    errorPanel: "Snaga panela je pozitivan broj do 2000 Wp.",

    unitWh: "Wh",
    unitWp: "Wp",
    unitPercent: "%",
    unitH: "h",
  },

  "inverter-sizing": {
    continuous: "Trajno opterećenje",
    continuousHint: "Snaga koja radi stalno, u vatima.",
    surge: "Udarno opterećenje",
    surgeHint:
      "Najveća snaga koja se uključuje odjednom, u vatima — podatak sa pločice tog uređaja.",
    powerFactor: "Faktor snage",
    powerFactorHint: "Između 0,5 i 1; podatak opterećenja, ne invertora.",

    results: "Rezultat",
    outContinuousVa: "Trajno",
    outSurgeVa: "Udarno",
    outRatio: "Odnos udara prema trajnom",
    note:
      "Nijedna granica se ne ocenjuje: trajna i udarna snaga su podaci konkretnog invertora, a " +
      "koji invertor je dovoljan je tvoja odluka.",

    formula: "S = P/pf, gde je pf faktor snage opterećenja; odnos udara = udarno/trajno.",

    errorContinuous: "Trajno opterećenje je pozitivan broj vati.",
    errorSurge: "Udarno opterećenje je pozitivno i nije manje od trajnog.",
    errorPowerFactor: "Faktor snage je između 0,5 i 1.",

    unitVa: "VA",
    unitW: "W",
  },

  "charge-controller-current": {
    arrayWp: "Snaga polja",
    arrayWpHint: "Ukupno u Wp.",
    voltage: "Napon sistema",
    voltageHint: "U voltima.",
    margin: "Rezerva",
    marginHint:
      "U procentima — koliko dodaješ na izračunatu struju. Tvoja konvencija, nema podrazumevane " +
      "vrednosti.",

    results: "Rezultat",
    outCurrent: "Struja punjača",
    outWithMargin: "Struja sa rezervom",
    note:
      "Ovo je MPPT slučaj, gde je izlaz regulatora na naponu baterije. PWM regulator radi po " +
      "struji polja, što je drugi račun.",

    formula: "I = P/U — snaga polja podeljena naponom sistema.",

    errorArray: "Snaga polja je pozitivan broj Wp.",
    errorVoltage: "Napon sistema je pozitivan broj volti.",
    errorMargin: "Rezerva je između 0 i 100 %.",

    unitWp: "Wp",
    unitV: "V",
    unitA: "A",
    unitPercent: "%",
  },

  "autonomy-days": {
    capacity: "Kapacitet banke",
    capacityHint: "Nominalni kapacitet u amper-satima (Ah).",
    voltage: "Napon sistema",
    voltageHint: "U voltima.",
    depthOfDischarge: "Dubina pražnjenja",
    depthOfDischargeHint: "U procentima — iskoristivi deo kapaciteta.",
    dailyEnergy: "Dnevna potrošnja",
    dailyEnergyHint: "U vat-satima (Wh) dnevno.",

    results: "Rezultat",
    outUsable: "Iskoristiva energija banke",
    outDays: "Dani autonomije",
    outWholeDays: "Punih dana",
    note: "Ovo je obratan račun od veličine banke: ista relacija, rešena po broju dana.",

    formula: "N = Ah · U · DoD/E_dnevno.",

    errorCapacity: "Kapacitet banke je pozitivan broj amper-sati.",
    errorVoltage: "Napon sistema je pozitivan broj volti.",
    errorDepthOfDischarge: "Dubina pražnjenja je između 5 i 100 %.",
    errorDailyEnergy: "Dnevna potrošnja je pozitivan broj vat-sati.",

    unitWh: "Wh",
    unitAh: "Ah",
    unitV: "V",
    unitDays: "dana",
    unitPercent: "%",
  },
} as const;
