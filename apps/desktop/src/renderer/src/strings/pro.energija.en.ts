/**
 * „Energija — solarni i vanmrežni sistemi" — the English copy of this toolkit's
 * surfaces.
 *
 * The mirror of `pro.energija.ts`, key for key. The same rules hold: the peak
 * sun hours are the user's figure and the copy says where it comes from, and
 * nothing here is a limit — the depth of discharge, the derate and the margin
 * are all fields with no default.
 */
export const PRO_ENERGIJA_EN = {
  "device-daily-energy": {
    devices: "Devices",
    devicesHint:
      "One line per device: name; watts; hours per day — for example “Fridge; 150; 24”.",

    results: "Result",
    tableName: "Device",
    tableWatts: "Power",
    tableHours: "Hours a day",
    tableWattHours: "Per day",
    outTotal: "Total per day",
    outTotalKwh: "Total in kWh per day",
    outConnected: "Connected power of the devices",
    note:
      "This is a daily consumption, not a simultaneous load — the connected power does not mean " +
      "everything runs at the same moment.",

    formula:
      "E = Σ Pᵢ·tᵢ — power times time, summed over the devices. That is the daily energy in " +
      "watt-hours.",

    errorDevices: "Enter at least one device as “name; watts; hours per day”.",
    errorRow:
      "Every line needs a power above zero and hours per day between 0 and 24, in the form " +
      "“name; watts; hours per day”.",

    unitW: "W",
    unitWh: "Wh",
    unitKwh: "kWh",
    unitH: "h",
  },

  "battery-bank-sizing": {
    dailyEnergy: "Daily consumption",
    dailyEnergyHint: "In watt-hours (Wh) per day.",
    autonomy: "Days of autonomy",
    autonomyHint: "How many days with no sun. Your decision — there is no default.",
    depthOfDischarge: "Depth of discharge",
    depthOfDischargeHint:
      "In percent — a property of the battery and its warranty, 50 for a lead-acid bank or 80 for " +
      "a lithium one, for example.",
    voltage: "System voltage",
    voltageHint: "In volts.",

    results: "Result",
    outLoad: "Consumption over that period",
    outRequiredWh: "Nominal energy the bank must hold",
    outRequiredAh: "Capacity the bank needs",
    note:
      "The inverter's and the battery's own losses are not included — they grow the bank, so add " +
      "them yourself if you know them.",

    formula:
      "E = E_daily · N; nominal energy = E/DoD; capacity = nominal energy/U, where U is the " +
      "system voltage.",

    errorDailyEnergy: "The daily consumption is a positive number of watt-hours.",
    errorAutonomy: "The autonomy is between 0.5 and 365 days.",
    errorDepthOfDischarge: "The depth of discharge is between 5 and 100 %.",
    errorVoltage: "The system voltage is a positive number of volts.",

    unitWh: "Wh",
    unitAh: "Ah",
    unitV: "V",
    unitDays: "days",
    unitPercent: "%",
  },

  "array-sizing": {
    dailyEnergy: "Daily consumption",
    dailyEnergyHint: "In watt-hours (Wh) per day.",
    peakSunHours: "Peak sun hours",
    peakSunHoursHint:
      "The equivalent full hours at 1 000 W/m² for your location, tilt and month — from a local " +
      "solar resource map. Nexus carries no irradiance data.",
    derate: "System losses",
    derateHint:
      "In percent: wiring, soiling, temperature and the controller. Typically 75–85 %, but it is " +
      "your own estimate of your own system.",
    panelWp: "Panel rating",
    panelWpHint: "In Wp. Empty means the array size alone is reported.",

    results: "Result",
    outArray: "Array needed",
    outDerate: "Losses used",
    outPanels: "Number of panels",
    outInstalled: "Installed power",

    formula:
      "P = E_daily/(PSH · η), where PSH are the peak sun hours you entered and η is the share " +
      "left after the losses. The panel count rounds up.",

    errorDailyEnergy: "The daily consumption is a positive number of watt-hours.",
    errorPeakSunHours: "The peak sun hours are between 0.5 and 12.",
    errorDerate: "The system losses are between 20 and 100 %.",
    errorPanel: "The panel rating is a positive number up to 2000 Wp.",

    unitWh: "Wh",
    unitWp: "Wp",
    unitPercent: "%",
    unitH: "h",
  },

  "inverter-sizing": {
    continuous: "Continuous load",
    continuousHint: "The power that runs all the time, in watts.",
    surge: "Surge load",
    surgeHint:
      "The largest power that starts at once, in watts — the figure from that appliance's own " +
      "plate.",
    powerFactor: "Power factor",
    powerFactorHint: "Between 0.5 and 1; a property of the load, not of the inverter.",

    results: "Result",
    outContinuousVa: "Continuous",
    outSurgeVa: "Surge",
    outRatio: "Surge against continuous",
    note:
      "No limit is judged: continuous and surge ratings belong to one specific inverter, and which " +
      "inverter is enough is your decision.",

    formula: "S = P/pf, where pf is the load's power factor; surge ratio = surge/continuous.",

    errorContinuous: "The continuous load is a positive number of watts.",
    errorSurge: "The surge is positive and is not below the continuous load.",
    errorPowerFactor: "The power factor is between 0.5 and 1.",

    unitVa: "VA",
    unitW: "W",
  },

  "charge-controller-current": {
    arrayWp: "Array rating",
    arrayWpHint: "In total Wp.",
    voltage: "System voltage",
    voltageHint: "In volts.",
    margin: "Margin",
    marginHint:
      "In percent — how much you add to the computed current. Your own convention, with no " +
      "default.",

    results: "Result",
    outCurrent: "Controller current",
    outWithMargin: "Current with the margin",
    note:
      "This is the MPPT case, where the controller's output sits at the battery voltage. A PWM " +
      "controller works on the array's own current, which is a different calculation.",

    formula: "I = P/U — the array's rated power over the system voltage.",

    errorArray: "The array rating is a positive number of Wp.",
    errorVoltage: "The system voltage is a positive number of volts.",
    errorMargin: "The margin is between 0 and 100 %.",

    unitWp: "Wp",
    unitV: "V",
    unitA: "A",
    unitPercent: "%",
  },

  "autonomy-days": {
    capacity: "Bank capacity",
    capacityHint: "Nominal capacity in ampere-hours (Ah).",
    voltage: "System voltage",
    voltageHint: "In volts.",
    depthOfDischarge: "Depth of discharge",
    depthOfDischargeHint: "In percent — the usable part of the capacity.",
    dailyEnergy: "Daily consumption",
    dailyEnergyHint: "In watt-hours (Wh) per day.",

    results: "Result",
    outUsable: "Usable energy in the bank",
    outDays: "Days of autonomy",
    outWholeDays: "Whole days",
    note:
      "This is the bank-sizing calculation the other way round: the same relation, solved for the " +
      "number of days.",

    formula: "N = Ah · U · DoD/E_daily.",

    errorCapacity: "The bank capacity is a positive number of ampere-hours.",
    errorVoltage: "The system voltage is a positive number of volts.",
    errorDepthOfDischarge: "The depth of discharge is between 5 and 100 %.",
    errorDailyEnergy: "The daily consumption is a positive number of watt-hours.",

    unitWh: "Wh",
    unitAh: "Ah",
    unitV: "V",
    unitDays: "days",
    unitPercent: "%",
  },
} as const;
