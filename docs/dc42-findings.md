# DC-42 — the verified derived-quantity findings

_Generated from the blast-radius audit of 2026-08-14: 18 reader agents over
`packages/core/src/pro/*.ts`, every claim then re-derived by a second agent
briefed to REFUTE it. 168 survived. This file is the full list, kept because
the audit cost 3.7M tokens and the findings outlive the run that produced them._

**Read the `reach` column first.** 163 of 168 need an input no
user can produce — 1e300 hectares, 1e308 kg, a subnormal override — and are
robustness, not defects. The handful marked `reachable` are the real ones.


## agro (16)

### `baleCountStorage` — countExact / countCeil / totalVolumeM3 / balesPerHa (and totalMassAfterLossT) → `Infinity`

- reach: extreme
- line: 188
- repro: `{ shape: "round", round: { diameterM: 1, widthM: 1 }, massMode: "measured", measuredMassKg: 1, quantityMode: "yieldPerArea", yieldTHa: 1e300, areaHa: 1e300, balingLossPercent: 0, roundOrientation: "onEnd" } — diameterM/widthM pass isInRange(0.5,2.5); measuredMassKg passes isPositive; balingLossPercent passes isInRange(0,30); yieldTHa and areaHa pass isPositive, which bands neither above. storage o`
- seam: baleCountStorage — the totalMassT/countExact construction (agro.ts:184–194): one finiteness guard where the total mass and the bale count are built (both quantityMode branches converge on those two lines), before countCeil, totalVolumeM3 and balesPerHa are derived from them. Banding areaHa alone is not enough here: yieldTHa is also only isPositive, and a tiny measuredMassKg overflows countExact fr

### `beeSyrupMix` — sugarKg (and syrupMassKg, densityKgL, concentrationPercent, bagsExact, bagsCeil) → `NaN`

- reach: extreme
- line: 334
- repro: `{ ratioA: 1e300, ratioB: 1e-300, given: "targetVolume", value: 10, bagMassKg: 1 } — ratioA and ratioB both pass isPositive (finite, >0); value and bagMassKg pass isPositive; hiveCount/literPerHive omitted.`
- seam: beeSyrupMix — the ratio construction at agro.ts:323: guard the constructed r = ratioA/ratioB (finite and positive) where it is built, before fromVolume and the targetMass/availableSugar paths consume it. A finite-but-huge r (1e300/1) is harmless; only the overflowed ratio produces the 0 that turns into NaN.

### `cadastralAreaUnits` — jutro → `Infinity`

- reach: extreme
- line: 466
- repro: `{ value: 1, fromUnit: "m2", jutroM2Override: 1e-320 } — value passes Number.isFinite && >= 0; jutroM2Override passes isPositive, since Number.isFinite(1e-320) is true for a subnormal; m2 = 1 is far under the 1e12 ceiling.`
- seam: cadastralAreaUnits — the jutroM2 resolution at agro.ts:435: band the resolved jutro (override or default) at the one place it is chosen, so no column of the five-unit table can divide by a value whose reciprocal overflows. Guarding at the division site would be four patches for one wrong value.

### `fertiliserNutrientBlend` — lines[0].doseKgHa / totalKg / bagsExact / bagsCeil / actualDoseKgHa / deliveredNKgHa / tot → `Infinity`

- reach: extreme
- line: 631
- repro: `{ direction: "nutrientsToFertiliser", targetForm: "oxide", targetN: 500, targetP: 0, targetK: 0, primary: { nPercent: 1e-305, p2o5Percent: 0, k2oPercent: 0 }, primaryLead: "N", areaHa: 1, bagMassKg: 1 } — areaHa/bagMassKg pass isPositive; targetN=500 passes isInRange(0,500); validComposition passes (1e-305 is in 0..100 and the sum is under 100); primaryPct = 1e-305 > 0, so the primaryLead refusal `
- seam: fertiliserNutrientBlend — the dose construction at agro.ts:631 and 647: build dose1/dose2 through quotient(100 * target, leadPercent) and turn undefined into fail("primaryLead")/fail("secondaryLead"), so no non-finite dose can reach doseLine. quotient already checks its own result, which is exactly the overflow case here.

### `grainMoistureShrink` — driedMassKg / waterOutKg / shrinkPercent (and impuritiesFirst.finalMassKg, impuritiesFirst → `driedMassKg = Infinity (1e308*100 overflows before the /100), waterOutKg = 1e308 - Infinity = -Infinity, shrinkPercent = -Infinity`

- reach: extreme
- line: 775
- repro: `{ grossMassKg: 1e308, measuredMoisturePercent: 0, targetMoisturePercent: 0, impuritiesPercent: 0, impuritiesFreeLimitPercent: 0, order: "impuritiesFirst", deductionMode: "excessOnly" } — grossMassKg passes isPositive with no upper band; all four percentages pass their isInRange bands; pricePerKg/dryerEfficiencyPercent omitted. moistureAdjust returns Infinity, not undefined, so the fail("targetMois`
- seam: agro.ts:49–52 — moistureAdjust itself: return undefined when the adjusted value is not finite, at the one place every moisture-basis conversion in this pack is constructed. All three callers (grainMoistureShrink, honeyMassMoisture, yieldEstimateSamples) already turn undefined into a refusal, so the class becomes unrepresentable at every call site with one edit.

### `honeyMassMoisture` — dryMatterMassKg (netMassKg and waterMassKg come back as Infinity alongside it) → `NaN`

- reach: extreme
- line: 1073
- repro: `{ quantityMode: "volume", containerVolumeL: 1.3e308, densityKgL: 1.5, moisturePercent: 20 } — densityKgL = 1.5 is the top of isInRange(1.35,1.5); moisturePercent = 20 is inside isInRange(12,25); containerVolumeL passes isPositive with no upper band; sample/jar/price fields omitted.`
- seam: honeyMassMoisture — the netMassKg construction at agro.ts:1053–1062: one finiteness guard on the constructed net mass covering both quantityMode branches (the grossTare branch already has a netMassKg <= 0 refusal on exactly that line — this is the same check's missing half), before the water/dry-matter split and every jar, volume and value figure derived from it.

### `irrigationDepthVolume` — netVolumeM3 / netVolumeL / grossVolumeM3 / timeHours / daysNeeded (timeMinutesPart is NaN) → `Infinity`

- reach: extreme
- line: 1213
- repro: `{ normMm: 200, areaHa: 1e306, efficiencyPercent: 100, flowUnit: "m3h", flowValue: 1, method: "sprinkler", hoursPerDay: 24 } — normMm = 200 is the top of isInRange(0.5,200); efficiencyPercent and hoursPerDay are at the top of their bands; flowValue passes isPositive; areaHa passes isPositive, which bands it only below. All sprinkler optionals omitted, so that block is skipped.`
- seam: agro.ts — the areaHa guard itself: one shared banded-area guard in packages/core/src/pro/result.ts (finite AND under a real-world hectare ceiling), adopted at every `isPositive(input.areaHa)` site — irrigationDepthVolume:1193, machineFieldCapacity:1454, seedingRate:2010, tankMixDose:2237. In all four the other operand is already tightly banded, so banding the area is the single edit that makes the

### `livestockRationDm` — feeds[0].dmKgPerDay / freshEatenKgPerDay / freshIssuedKgPerDay / periodIssuedKg (and total → `NaN`

- reach: extreme
- line: 1365
- repro: `{ headCount: 1, avgBodyMassKg: 1e308, intakeMode: "percentOfBody", intakeValue: 6, feeds: [{ name: "hay", dmPercent: 50, shareOfDmPercent: 0 }], days: 1, wastePercent: 0 } — headCount/feeds.length/days pass isIntegerIn; avgBodyMassKg passes isPositive with no upper band; intakeValue = 6 is the top of isInRange(0.5,6); dmPercent = 50 and shareOfDmPercent = 0 are both inside their bands.`
- seam: livestockRationDm — the dmPerHeadKgDay/dmHerdKgDay construction at agro.ts:1353–1355: one finiteness guard on the constructed herd dry-matter demand, before the per-feed loop multiplies it by a share. A guard inside the loop would be per-feed and would still leave dmPerHeadKgDay/dmHerdKgDay returned as Infinity in their own right.

### `machineFieldCapacity` — timeHours / daysNeeded (timeMinutesPart is NaN, lastDayHours is NaN) → `Infinity`

- reach: extreme
- line: 1464
- repro: `{ nominalWidthM: 0.5, overlapPercent: 0, speedKmh: 0.5, utilizationPercent: 30, areaHa: 1e308, hoursPerDay: 24 } — nominalWidthM and speedKmh sit at the bottom of their bands (0.5), utilizationPercent at the bottom of isInRange(30,100), hoursPerDay inside isInRange(0.5,24); areaHa passes isPositive with no upper band. Fuel and turn optionals omitted.`
- seam: agro.ts — the areaHa guard itself: one shared banded-area guard in packages/core/src/pro/result.ts (finite AND under a real-world hectare ceiling), adopted at every `isPositive(input.areaHa)` site — irrigationDepthVolume:1193, machineFieldCapacity:1454, seedingRate:2010, tankMixDose:2237. In all four the other operand is already tightly banded, so banding the area is the single edit that makes the

### `orchardTrellisLayout` — anchors (rowsCount, totalRowLengthM, totalPosts return Infinity; densityPerHa returns NaN) → `NaN`

- reach: extreme
- line: 1627
- repro: `{ lengthM: 10, widthM: 1e308, rowSpacingM: 0.5, headlandM: 0, boundaryOffsetM: 0, postSpacingM: 2, wireRows: 1, wireSlackPercent: 0, plantSpacingM: 1, anchorsPerEnd: 0, plantAtBothEnds: false } — widthM passes isPositive with no upper band; every other input sits inside its isInRange/isIntegerIn band (anchorsPerEnd = 0 is legal per isIntegerIn(0,2)). widthAvailable = 1e308 >= 0 and rowLengthM = 10`
- seam: agro.ts — the parcel-dimension guards shared by the two rowsAcrossWidth callers: replace `isPositive(input.lengthM)`/`isPositive(input.widthM)` with one shared banded parcel-dimension guard at orchardTrellisLayout:1570–1571 and plantSpacingDensity:1725–1726. Guarding inside rowsAcrossWidth alone is not enough — plotAreaHa = (lengthM*widthM)/10000 overflows independently of the row count, and would

### `plantSpacingDensity` — actualDensityPerHa (rowsCount, totalPlants, plotAreaHa, usedAreaHa all Infinity) → `NaN`

- reach: extreme
- line: 1755
- repro: `{ pattern: "rectangular", rowSpacingM: 0.05, spacingM: 1, lengthM: 10, widthM: 1e308, headlandM: 0, boundaryOffsetM: 0 } — rowSpacingM = 0.05 is the bottom of isInRange(0.05,50); spacingM, headlandM, boundaryOffsetM are inside their bands; lengthM and widthM pass isPositive with no upper band; desiredDensityPerHa omitted, so the rounded-spacing refusal never runs.`
- seam: agro.ts — the parcel-dimension guards shared by the two rowsAcrossWidth callers: replace `isPositive(input.lengthM)`/`isPositive(input.widthM)` with one shared banded parcel-dimension guard at orchardTrellisLayout:1570–1571 and plantSpacingDensity:1725–1726. Guarding inside rowsAcrossWidth alone is not enough — plotAreaHa = (lengthM*widthM)/10000 overflows independently of the row count, and would

### `polygonArea` — areaM2 / areaAr / areaHa (centroid comes back as { a: NaN, b: NaN }) → `Infinity`

- reach: extreme
- line: 1932
- repro: `{ vertices: [{ a: 0, b: 0 }, { a: 1e307, b: 0 }, { a: 1e307, b: 1e307 }], columnOrder: "YX" } — length 3 passes isIntegerIn(3,512); every coordinate passes Number.isFinite, which is the only check on magnitude. Translation to the first vertex does not help (it is the origin). With n = 3 the self-intersection double loop skips every pair (each candidate shares an index with the current edge), so no`
- seam: polygonArea — the translated-point magnitude at agro.ts:1898–1900: refuse when maxAbs is large enough that a cross product overflows (maxAbs is already computed there, one line before the products), so no non-finite term can enter signedArea2/cxSum/cySum. That one place also protects the centroid and the winding sign, which a guard on areaM2 alone would not.

### `seedingRate` — totalSeedKg / bagsExact / bagsCeil / totalSeeds (and totalCost when priced per kg) → `Infinity`

- reach: extreme
- line: 2024
- repro: `{ standMode: "perHa", standValue: 1e7, tkwGrams: 2000, germinationPercent: 1, purityPercent: 1, fieldLossPercent: 60, areaHa: 1e300, bagMassKg: 1 } — standValue = 1e7 is exactly the perHa ceiling (1000*HECTARE_M2); tkwGrams = 2000, germination/purity = 1 and fieldLoss = 60 all sit at the extreme ends of their own bands; areaHa passes isPositive with no upper band. f = 4e-5 > 0, so the fieldLossPer`
- seam: agro.ts — the areaHa guard itself: one shared banded-area guard in packages/core/src/pro/result.ts (finite AND under a real-world hectare ceiling), adopted at every `isPositive(input.areaHa)` site — irrigationDepthVolume:1193, machineFieldCapacity:1454, seedingRate:2010, tankMixDose:2237. In all four the other operand is already tightly banded, so banding the area is the single edit that makes the

### `sprayerCalibration` — nozzleFlowLMin / rateFromSpacingLHa (and totalFlowLMin, rateFromCountWidthLHa, coverageHaP → `Infinity`

- reach: extreme
- line: 2125
- repro: `{ nozzleFlow: { mode: "catch", volumeMl: 1 }, nozzleSpacingM: 0.1, speedKmh: 30, catchTimeS: 1e-320 } — nozzleSpacingM = 0.1 is the bottom of isInRange(0.1,2), speedKmh = 30 the top of isInRange(0.5,30); catchTimeS passes isPositive because Number.isFinite(1e-320) is true for a subnormal, and it has no lower band; volumeMl passes isPositive. Note the direct mode IS banded (0.05..20) — only the cat`
- seam: sprayerCalibration — the nozzleFlowLMin construction at agro.ts:2119–2126: one guard on the constructed flow covering both nozzleFlow modes (the direct mode is already banded 0.05–20 on exactly that branch; the catch mode is the missing half), before rateFromSpacingLHa and every rate, coverage and distance derived from it. ratioAgainst already withholds ratioPercent here, which is precisely why th

### `tankMixDose` — remainderVolumeL (and remainderAreaHa, products[0].remainderAmount; totalSprayVolumeL/fill → `NaN`

- reach: extreme
- line: 2248
- repro: `{ products: [{ name: "p1", unit: "l", dose: { mode: "perHectare", value: 1 } }], sprayRateLHa: 2000, tankVolumeL: 1000, areaHa: 1e306 } — products.length passes isIntegerIn(1,10); sprayRateLHa = 2000 is the top of isInRange(20,2000); tankVolumeL and areaHa pass isPositive, the latter with no upper band; dose.value passes isPositive.`
- seam: agro.ts — the areaHa guard itself: one shared banded-area guard in packages/core/src/pro/result.ts (finite AND under a real-world hectare ceiling), adopted at every `isPositive(input.areaHa)` site — irrigationDepthVolume:1193, machineFieldCapacity:1454, seedingRate:2010, tankMixDose:2237. In all four the other operand is already tightly banded, so banding the area is the single edit that makes the

### `yieldEstimateSamples` — sampleYieldsTHa[0] / meanTHa / minTHa / maxTHa / meanAfterLossTHa / totalYieldT → `Infinity`

- reach: extreme
- line: 2381
- repro: `{ samples: [{ method: "rowCrop", plantsPerHa: 1e200, earsPerPlant: 1e200, grainsPerEar: 1 }], tkwGrams: 1000, plotAreaHa: 1 } — samples.length passes isIntegerIn(1,50); tkwGrams = 1000 is inside isInRange(0.05,2000); plotAreaHa passes isPositive. The rowCrop branch guards plantsPerHa/earsPerPlant/grainsPerEar with isPositive only — no upper band, unlike the smallGrain branch which bands both count`
- seam: yieldEstimateSamples — the per-sample yield construction at agro.ts:2370–2387: one finiteness guard on each yield as it is pushed into `yields`, at the single point all three sample methods converge on (the measuredArea branch overflows the same way from sampleMassKg 1e308 / sampleAreaM2 1e-308), before the mean, min/max, standard deviation and total are formed from the series.


## biznis (11)

### `breakEven` — exactUnits (line 569), units (Math.ceil(Infinity) = Infinity), breakEvenRevenue, revenueAt → `Infinity`

- reach: extreme
- line: 553
- repro: `{ fixedCosts: 1e300, price: 1e-300, variableCost: 0 } — fixedCosts passes isNonNegative, price passes isPositive, variableCost passes isNonNegative; contributionMargin = 1e-300 is neither 0 nor negative, so both refusals at 550/551 are cleared. exactUnits = 1e300 / 1e-300 overflows.`
- seam: breakEven:553 — the construction of exactUnits (and exactUnitsForProfit at 562): build the unit count through quotient() from ./result.js and fail("fixedCosts") when it withholds, so units, breakEvenRevenue, revenueAtUnits, surplusAtUnits and the three margin-of-safety fields cannot inherit a non-finite count.

### `hourlyRateTarget` — hourlyRate (line 1083) and dayRate (line 1084) → `Infinity`

- reach: extreme
- line: 1078
- repro: `{ targetEarnings: 1000, businessCosts: 0, workWeeks: 1, hoursPerWeek: 1e-300, billablePercent: 1e-10, hoursPerDay: 1 } — workWeeks is inside isInRange(1,53), hoursPerWeek and hoursPerDay pass isPositive, billablePercent is positive and <= 100. billableHoursPerYear = 1e-312: subnormal but finite and > 0, so the line-1075 guard passes. 1000 / 1e-312 overflows.`
- seam: hourlyRateTarget:1078 — extend the derived-quantity guard already at 1075 (which only proves the DIVISOR is non-zero) to the rate itself: build hourlyRate through quotient() and fail when it withholds, before dayRate multiplies it and before the return.

### `maxDiscountForMargin` — exactDiscountPercent (line 1376) = -Infinity, and marginAfterDiscountPercent (1378-1380) = → `-Infinity`

- reach: extreme
- line: 1370
- repro: `{ cost: 1, price: 1e-320, minMarginPercent: 0 } — cost and price both pass isPositive (1e-320 is subnormal but finite and > 0), minMarginPercent is finite and < 100. NOTE the claimed mechanism is wrong: price*(1-minMargin) = 1e-320 does NOT underflow to 0. What overflows is the quotient — 1 / 1e-320 = Infinity — so exact = 1 - Infinity = -Infinity. Verdict unchanged.`
- seam: maxDiscountForMargin:1370 — the construction of `exact`: build cost/(price*(1-minMargin)) through quotient() and refuse when it withholds, before exact, exactDiscountPercent, maxDiscountPercent and marginAfterDiscountPercent are all derived from it.

### `marginMarkup` — price (returned by derivePricing) and profit = price - cost → `Infinity`

- reach: extreme
- line: 1270
- repro: `{ mode: "costMarkup", cost: 1e300, markupPercent: 1e300 } — cost passes isPositive, markupPercent is finite and > -100 (the only bounds at 1266). markup = 1e298; price = 1e300 * (1 + 1e298) = 1e598 overflows.`
- seam: marginMarkup:1236 — derivePricing, the single seam every branch's constructed cost/price passes through: refuse a non-finite cost or price there once, rather than adding five per-branch checks.

### `marginMarkup` — cost (returned by derivePricing) and profit = price - cost = -Infinity → `Infinity`

- reach: extreme
- line: 1292
- repro: `{ mode: "priceMargin", price: 1e10, marginPercent: -1e302 } — price passes isPositive; marginPercent is finite and the only other bound is '>= 100', which a large NEGATIVE percent clears. margin = -1e300; cost = 1e10 * (1 + 1e300) = 1e310 overflows.`
- seam: marginMarkup:1236 — derivePricing, the single seam every branch's constructed cost/price passes through: refuse a non-finite cost or price there once, rather than adding five per-branch checks.

### `marginMarkup` — price (returned by derivePricing) and profit = price - cost → `Infinity`

- reach: extreme
- line: 1278
- repro: `{ mode: "costMargin", cost: 1e300, marginPercent: 99.99999999999999 } — cost passes isPositive; marginPercent is finite and strictly < 100, so the 1274 guard passes. 1 - margin = 1.1102230246251565e-16 (non-zero, so a divisor guard would not catch it); 1e300 / 1.11e-16 = 9e315 overflows.`
- seam: marginMarkup:1236 — derivePricing, the single seam every branch's constructed cost/price passes through: refuse a non-finite cost or price there once, rather than adding five per-branch checks.

### `simpleInterestDays` — interest (line 1807), total (1811) = NaN; dailyInterest (1810) = Infinity → `NaN`

- reach: extreme
- line: 1801
- repro: `{ principal: 1e200, annualRatePercent: 1e200, from: {year:2026,month:1,day:1}, to: {year:2026,month:1,day:1}, basis: "act365", countBothEnds: false } — principal and annualRatePercent both pass isNonNegative (finite, >= 0), both dates are valid, toJdn === fromJdn so the 1782 refusal does not fire. yearly = 1e200 * 1e198 = Infinity; days = 0; interest = (Infinity * 0)/365 = NaN.`
- seam: simpleInterestDays:1800 — the construction of `yearly` (principal × annualRatePercent/100): refuse a non-finite yearly where it is built, before interest, dailyInterest and total derive from it. simpleInterestSegments inherits the refusal through its existing `if (!result.ok) return fail("segments")` path.

### `simpleInterestSegments` — totalInterest (line 1883) and total (1884); segments[0].interest is NaN too → `NaN`

- reach: extreme
- line: 1877
- repro: `{ principal: 1e200, segments: [{ annualRatePercent: 1e200, from: {year:2026,month:1,day:1}, to: {year:2026,month:1,day:1} }], basis: "act365", countBothEnds: false } — principal passes isNonNegative, segments is non-empty, and the inner simpleInterestDays returns ok:true with interest NaN, so the !result.ok guard at 1874 never fires.`
- seam: simpleInterestDays:1800 — the construction of `yearly` (principal × annualRatePercent/100): refuse a non-finite yearly where it is built, before interest, dailyInterest and total derive from it. simpleInterestSegments inherits the refusal through its existing `if (!result.ok) return fail("segments")` path.

### `tieredCommission` — slices[0].commission, commissionBeforeLimits, commission, effectiveRatePercent (Infinity), → `Infinity`

- reach: extreme
- line: 2063
- repro: `{ base: 1e200, tiers: [{ from: 0, ratePercent: 1e200 }], mode: "marginal" } — base passes isNonNegative, tiers is non-empty, tier.from and tier.ratePercent both pass isNonNegative (the only bound on a rate), sorted[0].from === 0. amount = 1e200; commission = (1e200 * 1e200)/100 = Infinity/100.`
- seam: tieredCommission:2063 — the slice-commission construction: one guarded helper for (amount × ratePercent)/100 used by both the marginal map (2063) and the flat branch (2081), refusing before `before`, commission, effectiveRatePercent and remainder are derived from it.

### `chainedDiscount` — finalPrice, stepPrices[1], stepDeltas[1] (-Infinity), factor, totalDiscount (-Infinity), e → `Infinity`

- reach: extreme
- line: 664
- repro: `{ basePrice: 1, steps: [-1e300, -1e300] } — basePrice passes isNonNegative; each step is finite and the only other bound is '> 100', which a large NEGATIVE surcharge clears. factor after step 1 is 1e298, after step 2 is 1e596 → Infinity; finalPrice = 1 * Infinity.`
- seam: chainedDiscount:663 — the factor accumulation inside the step loop: check the running factor (and the price it produces) is finite as each step is applied, before stepPrices, stepDeltas, finalPrice, totalDiscount and equivalentDiscountPercent are built from it.

### `billableHours` — deltaAmount (line 465) = NaN; actualAmount (462) and amount (463) are both Infinity → `NaN`

- reach: extreme
- line: 465
- repro: `{ entries: ["9".repeat(300)], rule: "nearest", place: "total", rate: 1e300 } — intervalMinutes absent so interval = 0 and the 432 check is skipped; rate passes isNonNegative. NOTE the claim's own reasoning understates the guard: parseDurationMinutes DOES check isFinite (line 361), but Number("9".repeat(300)) is ~1e300 — finite — so it passes, and Math.round(1e300*60) = 6e301 minutes is produced AF`
- seam: billableHours:450 — the construction of actualAmount and amount ((minutes/60) × rate): guard both products where they are built, before deltaAmount subtracts one from the other. The upstream half of the same seam is parseDurationMinutes:362, where the isFinite check is applied to `hours` but not to the minutes produced from it.


## dizajn (16)

### `aspectRatioFit` — visibleSourceWidth → `Infinity`

- reach: extreme
- line: 263
- repro: `{ sourceWidth: 1e300, sourceHeight: 1e300, targetWidth: 1e-300, targetHeight: 1e-300, mode: "cover", roundTo: "none" }`
- seam: aspectRatioFit — the scaleX/scaleY assignment in the `switch (mode)` block (lines 190-226): check the constructed uniform/per-axis factor is finite and non-zero there, before outputWidth/distortion/crop/visible are derived from it.

### `aspectRatioFit` — distortion → `NaN`

- reach: extreme
- line: 247
- repro: `{ sourceWidth: 1e300, sourceHeight: 1e300, targetWidth: 1e-300, targetHeight: 1e-300, mode: "cover", roundTo: "none" }`
- seam: aspectRatioFit — the scaleX/scaleY assignment in the `switch (mode)` block (lines 190-226): check the constructed uniform/per-axis factor is finite and non-zero there, before outputWidth/distortion/crop/visible are derived from it.

### `baselineRhythm` — column.lines → `Infinity`

- reach: extreme
- line: 371
- repro: `{ fontSize: 1, lineHeight: 0.001, lineHeightUnit: "multiplier", gridUnit: 1, columnHeight: 1e308, snapMode: "nearest" }`
- seam: baselineRhythm — the `fit()` helper where `lines` is built (line 371): derive the line count through a checked quotient and withhold the whole RhythmColumn when it is not finite, so `column` and `snappedColumn` both inherit the guard.

### `bookSpine` — spine → `Infinity`

- reach: extreme
- line: 493
- repro: `{ pageCount: 2, grammage: 1e300, bulk: 1e300, coverCaliper: 1, extraAllowance: 1, edgeWrap: 0, bindingStyle: "soft", hingeGroove: 0 }`
- seam: bookSpine — the caliper-selection block (lines 484-501): one finiteness check on the chosen `caliper` and on `leaves * caliper` before `block`/`spine`/`flatCoverWidth` are built.

### `columnGrid` — maxColumns → `Infinity`

- reach: extreme
- line: 596
- repro: `{ containerWidth: 1.5e308, columns: 1, gutter: 1.5e308, outerMargin: 0, minColumnWidth: 1 }`
- seam: packCount (dizajn.ts lines 78-80) — the shared `(usable + gutter) / (piece + gutter)` rearrangement: guard the numerator/quotient there once, so columnGrid.maxColumns, rollYield.across and sheetImposition.across/down cannot be non-finite at any call site.

### `typographicUnits` — px → `Infinity`

- reach: extreme
- line: 858
- repro: `{ value: 1e300, fromUnit: "rem", rootFontSize: 1e300, parentFontSize: 16, assetScale: 1 }`
- seam: typographicUnits — immediately after the `switch (fromUnit)` that constructs `px` (line 886): one finiteness check on `px`, since every other returned column (rem, em, pt, mm, dp, devicePx, assetPx*) is derived from it.

### `colourDifference` — deltaE76 → `Infinity`

- reach: extreme
- line: 1038
- repro: `{ colour1: { l: 50, a: -1e300, b: 0 }, colour2: { l: 50, a: 1e300, b: 0 }, de94Application: "graphicArts" }`
- seam: colourDifference — the colour1/colour2 validation (lines 1007-1012): band `a` and `b` with isInRange the way `l` already is, instead of bare Number.isFinite; that makes the overflow unrepresentable for deltaE76, deltaE94 and deltaE00 at once.

### `eanBarcode` — symbolWidth → `Infinity`

- reach: extreme
- line: 1386
- repro: `{ digits: "036000291452", symbology: "ean13", xDimension: 1e308 }`
- seam: eanBarcode — the resolved `xDimension` block (lines 1343-1355): bound the resolved module width there, so symbolWidth, encodedWidth and both quiet zones are finite by construction.

### `fontMetricsTrim` — trimTop → `NaN`

- reach: extreme
- line: 1505
- repro: `{ unitsPerEm: 1, ascender: 1e300, descender: -1, lineGap: 0, capHeight: 1, fontSize: 1e300, lineHeight: 100, metricSource: "hhea" }`
- seam: fontMetricsTrim — the px-metric construction block (lines 1495-1502): check `unitScale`, ascenderPx/descenderPx/lineGapPx/capHeightPx and `contentArea` are finite there, before halfLeading and the two trims are formed.

### `modularTypeScale` — steps[12].px → `Infinity`

- reach: extreme
- line: 1836
- repro: `{ baseSize: 1, baseUnit: "px", ratio: 1e30, stepsUp: 12, stepsDown: 0, rootFontSize: 16, rounding: "none" }`
- seam: modularTypeScale — the per-step `factor`/`px` construction inside the loop (lines 1835-1836): check the constructed step size is finite and above zero there, before the row (px, roundedPx, rem, pt) is pushed.

### `modularTypeScale` — steps[-12].px → `zero`

- reach: extreme
- line: 1835
- repro: `{ baseSize: 1, baseUnit: "px", ratio: 1e30, stepsUp: 0, stepsDown: 12, rootFontSize: 16, rounding: "none" }`
- seam: modularTypeScale — the per-step `factor`/`px` construction inside the loop (lines 1835-1836): check the constructed step size is finite and above zero there, before the row (px, roundedPx, rem, pt) is pushed.

### `paperWeight` — areaM2 → `Infinity`

- reach: extreme
- line: 1896
- repro: `{ grammage: 80, sheetWidth: 1e300, sheetHeight: 1e300, sheetCount: 1 }`
- seam: paperWeight — the `areaM2` construction (line 1896): guard the sheet area where it is built, since sheetMass, totalMass, totalMassKg and measuredGrammage all hang off it.

### `printResolution` — widthPx → `Infinity`

- reach: extreme
- line: 2063
- repro: `{ direction: "sizeToPx", physicalWidth: 1e300, physicalHeight: 1, resolution: 1e300, physicalUnit: "mm", bleed: 0, scaleDenominator: 1, channels: 1, bitsPerChannel: 8 }`
- seam: printResolution — the single exit of the direction if/else chain (after line 2082): one finiteness check over the six quantities the branches assign (widthPx, heightPx, widthMm, heightMm, ppiWidth, ppiHeight) before the artboard/final/megapixel/bytes figures are derived.

### `printResolution` — ppiWidth → `Infinity`

- reach: extreme
- line: 2078
- repro: `{ direction: "effectivePpi", widthPx: 1000000000, heightPx: 1, physicalWidth: 1e-300, physicalHeight: 1, bleed: 0, scaleDenominator: 1, channels: 1, bitsPerChannel: 8 }`
- seam: printResolution — the single exit of the direction if/else chain (after line 2082): one finiteness check over the six quantities the branches assign (widthPx, heightPx, widthMm, heightMm, ppiWidth, ppiHeight) before the artboard/final/megapixel/bytes figures are derived.

### `rollYield` — upright.across → `Infinity`

- reach: extreme
- line: 2201
- repro: `{ rollWidth: 1.5e308, pieceWidth: 1, pieceHeight: 1, sideMargin: 0, gutter: 1.5e308, leadTrailMargin: 0, quantity: 1, allowRotation: false }`
- seam: packCount (dizajn.ts lines 78-80) — the shared `(usable + gutter) / (piece + gutter)` rearrangement: guard the numerator/quotient there once, so columnGrid.maxColumns, rollYield.across and sheetImposition.across/down cannot be non-finite at any call site.

### `sheetImposition` — usedPercent → `Infinity`

- reach: extreme
- line: 2459
- repro: `{ sheetWidth: 1.5e308, sheetHeight: 1, pieceWidth: 1, pieceHeight: 1, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, gutter: 1.5e308, allowRotation: false }`
- seam: packCount (dizajn.ts lines 78-80) — the shared `(usable + gutter) / (piece + gutter)` rearrangement: guard the numerator/quotient there once, so columnGrid.maxColumns, rollYield.across and sheetImposition.across/down cannot be non-finite at any call site.


## event (13)

### `eventBudget` — costPerGuestWithTax → `Infinity`

- reach: extreme
- line: 316
- repro: `{ guests: 100000, tables: 0, lines: [{ type: "perGuest", amount: 1e304 }], reservePct: 10, taxRatePct: 20, taxBaseMode: "total" }`
- seam: event.ts:314-334 — the money roll-up, where `base` and `lineAmounts` are constructed from `amount × guests|tables`: one finiteness guard on the constructed line total there (or a banded `amount` at line 301), before subtotal/reserve/tax/grandTotal derive from it.

### `cateringPerGuest` — lines[0].surplus → `NaN (purchased Infinity − grossQuantity Infinity)`

- reach: extreme
- line: 499
- repro: `{ guests: 5000, lines: [{ unit: "g", quantityPerGuest: 1e305, uptakePct: 100, reservePct: 0, packSize: 1, packUnit: "g" }], packRounding: "up" }`
- seam: event.ts:499-505 — where the line's `netNeed` / `grossQuantity` / `purchased` are constructed from guests × quantityPerGuest × uptake × reserve: guard the constructed quantity once there, before packs, surplus, pours and actualReservePct consume it.

### `generatorSizing` — runningPowerFactor → `exactly 0 (1e308 / Infinity); runningReactiveKvar and runningApparentKva are Infinity on the same ok:true result`

- reach: extreme
- line: 651
- repro: `{ consumers: [{ kw: 1e308, cosPhi: 0.1 }], reservePct: 0, deratePct: 0, ratedPowerFactor: 0.8 }`
- seam: the per-consumer power decomposition — event.ts:649-651 (`p`, `tanPhi`, `q`) and event.ts:2325-2333 (`s` and its phasor components): one shared guard refusing a consumer whose derived apparent/reactive power is not finite, at the point it is built from `kw` and `cosPhi`, before any phase sum.

### `iceChilling` — iceToDrinkRatio → `NaN (Infinity / Infinity)`

- reach: extreme
- line: 812
- repro: `{ drinkVolumeL: 1e200, drinkDensityKgPerL: 1e200, startTempC: 25, targetTempC: 4 }`
- seam: event.ts:805-817 — where `drinkMass` and the heat load `q` built from it are constructed: guard the constructed mass/heat there, before icePulldownKg, totalIceKg, dilutionPct and iceToDrinkRatio read it.

### `projectorThrowScreen` — widthM → `exactly 0 (aspectRatio**2 underflows to 0 → 1/0 = Infinity → sqrt = Infinity → 10/Infinity = 0)`

- reach: extreme
- line: 1319
- repro: `{ throwRatio: 1.5, known: "diagonal", knownValueM: 10, aspectRatio: 1e-200 }`
- seam: event.ts:1313-1328 — where the screen geometry (`width`, `height`) is constructed from `knownValueM` and `aspectRatio`: band `aspectRatio` / guard the constructed width-height pair at that seam, before diagonal, area, distance and illuminance are derived.

### `parkingCloakroom` — railDiff → `-Infinity (items 50 − railCapacityItems Infinity)`

- reach: extreme
- line: 1167
- repro: `{ guests: 100, carSharePct: 50, occupancyPerCar: 2, areaPerStallM2: 20, coatSharePct: 50, itemsPerGuest: 1, hangerPitchM: 0.03, availableRailSegmentsM: [1e308], checkInWindowMinutes: 30, checkInRatePiecesPerMinute: 5 }`
- seam: event.ts:1166-1169 — where `railCapacityItems` is accumulated from `floorSnapped(seg / hangerPitchM)`: band the segment length / guard the constructed per-segment capacity there, before railRatio and railDiff are taken from it.

### `stageDeckLayout` — udlKgM2 → `Infinity (1e308 / 0.25)`

- reach: extreme
- line: 2068
- repro: `{ widthM: 0.5, depthM: 0.5, moduleLengthM: 0.5, moduleWidthM: 0.5, stageHeightM: 1, skirtSides: "none", totalMassKg: 1e308 }`
- seam: event.ts:2065-2068 — where `udlKgM2` is constructed: build it through `quotient()` (which refuses a non-finite RESULT, not only a bad divisor) and band `totalMassKg` at its guard, line 2029, instead of the bare `isNonNegative`.

### `tentBayLayout` — roofAreaM2 → `Infinity (areaM2 1.5e308 ÷ cos45° ≈ 0.707)`

- reach: extreme
- line: 2184
- repro: `{ requiredAreaM2: 1.5e308, widthM: 3, bayLengthM: 1, eaveHeightM: 2, roofPitchDeg: 45, marginM: 0, sides: "none" }`
- seam: event.ts:2164-2170 — where `bays`, `lengthM` and `areaM2` are constructed from the sizing input: band `requiredAreaM2` / guard the constructed tent extent at that seam, before roof, side-wall, gable and sheeting areas derive from it.

### `threePhaseLoadBalance` — phases[0].activeKw → `NaN (re = Infinity, im = -Infinity; im × sin(0) = NaN, so Infinity + NaN = NaN)`

- reach: extreme
- line: 2328
- repro: `{ consumers: [{ kw: 1e305, cosPhi: 0.1, connection: "L1" }] }`
- seam: the per-consumer power decomposition — event.ts:649-651 (`p`, `tanPhi`, `q`) and event.ts:2325-2333 (`s` and its phasor components): one shared guard refusing a consumer whose derived apparent/reactive power is not finite, at the point it is built from `kw` and `cosPhi`, before any phase sum.

### `trussHoistReactions` — reactionAKg → `NaN (totalMassKg Infinity − reactionBKg Infinity)`

- reach: extreme
- line: 2495
- repro: `{ lengthM: 1e200, selfWeightKgPerM: 1e200, pointAM: 0, pointBM: 1e200, loads: [] }`
- seam: event.ts:2493-2496 — where `distributedMassKg` and `totalMassKg` are constructed from `(selfWeight + extra) × L`: guard the constructed mass there, beside the existing `totalMassKg <= 0` refusal, before momentAboutA and the reactions are computed.

### `venueOccupancyArea` — layouts[0].requiredAreaDiffM2 → `-Infinity (100000 − Infinity)`

- reach: extreme
- line: 2665
- repro: `{ grossAreaM2: 100000, layouts: [{ densityM2PerPerson: 1e155, basis: "gross" }], guests: 1e155 }`
- seam: event.ts:2664-2665 — where the layout's required area (`guests × densityM2PerPerson`) is constructed: guard that product at the seam, and band `guests` (line 2636) and `densityM2PerPerson` (line 2654), which today are `isPositive` only.

### `voltageDrop` — resistanceOhm → `Infinity (1e308/1000 × 5000 = 5e308)`

- reach: extreme
- line: 2810
- repro: `{ system: "dc", material: "copper", lengthM: 5000, currentA: 1, customResistanceOhmPerKm: 1e308 }`
- seam: event.ts:2756-2759 and 2810 — where the per-run resistance `r1 = resistancePerMetreOf(section) × lengthM` is constructed: guard the constructed resistance inside that seam (and band `customResistanceOhmPerKm`), before drop, per-phase drop, loss and dropRatio read it.

### `ledWallLayout` — panelPixelsWide → `exactly 0 (pxWExact = 5e-298 clears the ABSOLUTE 1e-6 tolerance at line 948, Math.round → 0; resolutionWide/resolutionHigh/totalPixels are 0 as well)`

- reach: extreme
- line: 950
- repro: `{ pitchMm: 1e300, acuityArcmin: 1, panelsWide: 1, panelsHigh: 1 }`
- seam: event.ts:945-951 — where `pxW`/`pxH` are constructed from `panelW / pitchMm`: make the divisibility test relative and require the rounded pixel count to be ≥ 1 at that seam, instead of an absolute 1e-6 test that any underflowing ratio passes.


## foto (1)

### `ndFilterExposure` — factor (and `shutter`, which is `baseShutter * factor`) → `Infinity`

- reach: extreme
- line: 1137
- repro: `{ baseShutter: 0.01, filters: new Array(45).fill({ stops: 24 }) } — baseShutter 0.01 clears isInRange(1e-6, 3600); filters.length 45 clears the only length guard ('=== 0'); each { stops: 24 } gives definedCount === 1 and clears isInRange(stops, 0, 24). Running the body by hand: stops = 45*24 = 1080, factor = Math.pow(2, 1080) = Infinity, shutter = 0.01 * Infinity = Infinity, density = 1080*log10(2`
- seam: packages/core/src/pro/foto.ts — ndFilterExposure, the seam at line 1137 where the accumulated stack total becomes a factor: guard the summed `stops` / the constructed `factor` for finiteness there (before `shutter` multiplies through it), not at any consumer and not per-filter.


## gradnja (17)

### `stairFlight` — blondel → `Infinity`

- reach: extreme
- line: 187
- repro: `{ rise: 1e308, risers: 1, going: 1, top: "flush" } — isPositive(rise) ✓, isIntegerIn(risers,1,60) ✓ (1 is the minimum, not an evasion), isPositive(going) ✓, step defaults to 1 ✓. riser = 1e308/1 = 1e308; 2*1e308 overflows before the addition.`
- seam: gradnja.ts:168-174 — guard the constructed flight quantities (`riser`, and with it `run`, `blondel`, `achieved`) immediately after `const riser = rise / risers`, before the result literal is built.

### `beamCheck` — deflection → `NaN`

- reach: extreme
- line: 720
- repro: `{ scheme: "simple-udl", span: 1e100, load: 0, modulus: 200, inertia: 100 } — span isPositive ✓, load isNonNegative(0) ✓, force undefined so the spare-field refusal does not fire ✓, modulus/inertia isPositive ✓, and the three EXISTING DC-42 guards pass (inertiaM4 = 1e-6, stiffness = 2e5). span ** 4 = Infinity; (5 * 0) * Infinity = NaN, so the division never gets a chance. The true deflection of an `
- seam: gradnja.ts:713-737 — guard the derived load effects (`reaction`, `momentNm`, `deflectionM`) as one group immediately after the scheme switch, beside the existing `inertiaM4`/`modulusM3`/`stiffness` guards, so the span powers cannot leave the switch non-finite.

### `concreteTakeoff` — netVolume → `Infinity`

- reach: extreme
- line: 864
- repro: `{ element: { kind: "slab", a: 1e300, b: 1e300, d: 1 }, pieces: 1, waste: 0 } — pieces isIntegerIn(1,100000) ✓, waste isInRange(0,100) ✓, a/b/d isPositive ✓, openings defaults to 0 and '0 >= Infinity' is false so the opening test does not catch it. plan = Infinity → netVolume, formwork and grossVolume all Infinity. Same shape via beam/strip-footing (b*h*length*pieces) and column/pad-footing (a*b*h*`
- seam: gradnja.ts:857-889 — guard the constructed `netVolume`/`formwork`/`grossVolume` ONCE after the element branch chain (they are the only three quantities every branch produces), never one patch per branch.

### `drawingScaleLength` — realLength → `Infinity`

- reach: extreme
- line: 961
- repro: `{ denominator: 1e300, direction: "paper-to-real", length: 1e300 } — both isPositive ✓. (1e300 * 1e300) overflows before the /1000. The 'real-to-paper' branch has the mirror shape: (length * 1000) / denominator with a sub-normal denominator.`
- seam: gradnja.ts:960-963 — guard the converted length where it is constructed, in both direction branches, before either result literal.

### `drawingScaleArea` — realArea → `Infinity`

- reach: extreme
- line: 980
- repro: `drawingScaleArea(1e200, 1) — arguments are (denominator, paperArea); isPositive(denominator) ✓, isPositive(paperArea) ✓. denominator ** 2 = Infinity on its own for anything past ~1.34e154, and 1 * 1e-4 * Infinity = Infinity.`
- seam: gradnja.ts:980 — guard the constructed `realArea` (the squared factor) before it is returned.

### `drawingScaleFit` — drawnWidth → `Infinity`

- reach: extreme
- line: 1035
- repro: `{ denominator: 5e-324, objectWidth: 1, objectHeight: 1, sheet: "A4", orientation: "portrait", margin: 0 } — isPositive(5e-324) is true (Number.MIN_VALUE is finite and above zero), objectWidth/objectHeight isPositive ✓, margin isNonNegative ✓, usableWidth 210 / usableHeight 297 both above zero so the margin refusal does not fire. (1 * 1000) / 5e-324 = Infinity → drawnWidth, drawnHeight, and require`
- seam: gradnja.ts:1034-1048 — guard the drawn size the `at()` helper constructs (and with it the `required` ratio built from it), inside `at`, so no caller — `drawn`, `fitsAt` or `required` — can obtain a non-finite pair.

### `earthworkVolumes` — totalCut → `Infinity`

- reach: extreme
- line: 1181
- repro: `{ profiles: [ { station: 0, cut: 1.7e308, fill: 0 }, { station: 1, cut: 1.7e308, fill: 0 } ] } — length 2 passes isIntegerIn(2,500) ✓, stations finite and strictly increasing ✓, cut/fill isNonNegative ✓, no midCut/midFill so the last-profile refusal does not fire. area1 + area2 = Infinity before the length multiplication; segments[0].cut, totalCut and balance are all Infinity.`
- seam: gradnja.ts:1180-1185 — guard the value the `volume(...)` helper constructs (and the running `totalCut`/`totalFill` accumulation) at the point of construction, covering both the average-end-area and the prismoidal branch.

### `rebarFromLength` — totalMass → `Infinity`

- reach: extreme
- line: 1468
- repro: `{ diameter: 60, barLength: 1.7e308, bars: 1 } — diameter isInRange(1,60) ✓ (60 inclusive), barLength isPositive ✓, bars isIntegerIn(1,1000000) ✓. massPerMetre = 22.1953…; 22.1953 * 1.7e308 = Infinity, and totalTonnes = Infinity/1000 is Infinity too. Weaker than the rest of the set — one unbounded input times a bounded constant, not a product of two guarded inputs — but it is still Infinity on an o`
- seam: gradnja.ts:1467-1468 — guard the constructed `totalLength`/`totalMass` pair where they are built, before the result literal.

### `rebarFromMass` — totalLength → `Infinity`

- reach: extreme
- line: 1490
- repro: `{ diameter: 1, mass: 1.7e308 } — diameter isInRange(1,60) ✓, mass isPositive ✓, barLength omitted so its guard does not fire. massPerMetre for a 1 mm bar is 0.0061653755826699685 kg/m; 1.7e308 / 0.00616… = Infinity. The divisor is sound (bounded and non-zero); the numerator is what is unbounded.`
- seam: gradnja.ts:1490 — guard the constructed `totalLength` where it is built, before `wholeBars`/`remainder` are derived from it.

### `roofPitch` — rafter → `Infinity`

- reach: extreme
- line: 1600
- repro: `{ pitch: 1e20, pitchUnit: "percent", base: 1e300 } — Number.isFinite(pitch) ✓, pitch is not below zero so the sign refusal does not fire, base isPositive ✓. angleFromSlopeNotation refuses a near-vertical angle only for "degrees" (|v| >= 90) and "ratio" (v === 0); for "percent" it returns Math.atan(1e18), which saturates to EXACTLY Math.PI/2 (verified: === Math.PI/2), so the 'angle === undefined' g`
- seam: gradnja.ts:1592 — guard the derived plane geometry where the cosine is constructed (`cosine`, and the `height`/`rafter`/`slopeArea` built from it); the near-vertical refusal must be stated about the resulting ANGLE, so it covers percent and permille and not only degrees and ratio.

### `roomSurfaces` — grossWall → `Infinity`

- reach: extreme
- line: 1732
- repro: `{ height: 1e300, perimeter: 1e300, openings: [], deductOpenings: false, includeWalls: true, includeReveals: false, includeCeiling: false } — height isPositive ✓, length/width omitted so 'derived' is undefined and the supplied perimeter is used, isPositive(perimeter) ✓, includeReveals false so the revealDepth pairing does not fire, includeCeiling false so the ceilingArea pairing does not fire. peri`
- seam: gradnja.ts:1732-1747 — guard the constructed room quantities (`grossWall`, `netWall`, `revealArea`, `totalArea`) at the point of construction, before `quantity` divides by the coverage.

### `slopeGrade` — run → `Infinity`

- reach: extreme
- line: 1889
- repro: `{ known: "slant-rise", slant: 1e300, rise: 0 } — needsAngle is false on this branch so no slope unit is involved, slant isPositive ✓, rise finite ✓, and |0| >= 1e300 is false so the triangle test passes. slant ** 2 = Infinity, sqrt(Infinity - 0) = Infinity. Unlike the 'rise-slope' and 'slant-slope' branches, this branch (and 'slant-run' beside it) never checks the RESULTING run.`
- seam: gradnja.ts:1855-1899 — one guard on the resolved `run`/`rise` pair after the whole branch chain, replacing the three per-branch `isPositive(run)` checks, so the two branches that have none cannot stay uncovered.

### `squareCheck` — angle → `NaN`

- reach: extreme
- line: 2016
- repro: `{ sideA: 1e200, sideB: 1e200, measuredDiagonal: 1e200 } — sideA/sideB isPositive ✓, measured isPositive ✓ and inside the triangle inequality (|a−b| = 0 < 1e200 < a+b = 2e200) ✓, secondDiagonal omitted. Each ** 2 is Infinity, so the numerator is Infinity + Infinity − Infinity = NaN and the denominator is Infinity: cosine = NaN, angle = NaN, angleError = NaN, offsetAlongA = NaN, expectedSecondDiagon`
- seam: gradnja.ts:2016-2023 — guard the derived `cosine` and the `expectedSecondDiagonal` radicand where they are constructed, before acos and sqrt consume them.

### `surveyInverse` — distance → `Infinity`

- reach: extreme
- line: 2103
- repro: `{ from: { y: -1.7e308, x: 0 }, to: { y: 1.7e308, x: 0 } } — the only guard is Number.isFinite on all four coordinates, which all four pass. deltaY = 3.4e308 overflows in the SUBTRACTION, so Math.hypot (which is itself overflow-safe) is handed an Infinity it cannot undo: deltaY and distance both Infinity on ok: true. (The claimant's rationale that hypot "loses a finite true distance" is imprecise —`
- seam: gradnja.ts:2103-2105 — guard the constructed `deltaY`/`deltaX`/`distance` triple immediately after the subtractions, before the coincident-point test and the bearing arithmetic read them.

### `tileCount` — pieces → `Infinity`

- reach: extreme
- line: 2248
- repro: `{ area: 1, tileWidth: 1e-200, tileHeight: 1e-200, joint: 0, waste: 0 } — area/tileWidth/tileHeight isPositive ✓, joint isNonNegative(0) ✓, waste isInRange(0,100) ✓, perBox/areaPerBox omitted. effective = 1e-400 = exactly 0, so both MM2_PER_M2 / effective and (areaWithWaste * MM2_PER_M2) / effective divide by zero: perSquareMetre = Infinity and pieces = ceilSnapped(Infinity) = Infinity (snap passes`
- seam: gradnja.ts:2248 — guard the constructed `effective` tile module (the (a+s)(b+s) product) where it is built, before either of the two divisions by it.

### `trenchVolume` — excavation → `Infinity`

- reach: extreme
- line: 2382
- repro: `{ length: 1, depth: 1e300, batter: 1e300, bottomWidth: 1, bulking: 0, returnsSpoil: false } — length/depth isPositive ✓, batter isNonNegative ✓, bulking isInRange(0,100) ✓, bottomWidth isPositive ✓, no pipeDiameter or beddingThickness so the pipe-wider-than-bottom and bedding+diameter <= depth refusals do not fire. batter * depth = Infinity → crossSection, excavation, topWidth, and (returnsSpoil f`
- seam: gradnja.ts:2382-2386 — guard the constructed section-and-volume group (`crossSection`, `topWidth`, `excavation`, `beddingVolume`, `pipeVolume`) where it is built, before `surplus`/`backfill` are derived from it.

### `wallAssembly` — uValue → `zero`

- reach: extreme
- line: 2478
- repro: `{ layers: [ { thickness: 1e300, conductivity: 1e-300 } ], rsi: 0.13, rse: 0.04 } — layers.length 1 passes isIntegerIn(1,20) ✓, rsi/rse isInRange(0,1) ✓, thickness/conductivity both isPositive ✓. 1e300 / 1e-300 = Infinity → totalResistance = Infinity, and 'totalResistance > 0' is TRUE of Infinity, so the existing zero-guard waves it through: uValue = 1/Infinity = exactly 0, layers[0].share = (Infin`
- seam: gradnja.ts:2478-2482 — guard each layer resistance as it is pushed into `resistances` and the summed `totalResistance`, so `totalResistance > 0` can never be satisfied by an Infinity.


## inzenjering (13)

### `metricToAwg` — resistanceOhmPerKm → `Infinity`

- reach: extreme
- line: 223
- repro: `{ diameterMm: 1e-200 }`
- seam: circleAreaMm2 (line 119) — the one place in this file a circular area is built from a diameter. Make it yield a checked area (refuse a non-finite or exactly-zero product) and route the three hand-written copies of the same expression through it: pipeFlow's inline areaM2 (line 1125), pistonForce's annulusAreaMm2 (line 1417) and metricThread's stressAreaMm2 (line 929, which is circleAreaMm2(meanDiam

### `batteryBankRuntime` — hours → `Infinity`

- reach: extreme
- line: 360
- repro: `{ cellCapacityAh: 100, cellVoltage: 12, depthOfDischargePct: 100, load: { kind: "current", amps: 1e-200 }, peukertExponent: 1.2, ratedDischargeHours: 1e-200 }`
- seam: The Peukert regime divisor at line 360 — guard the constructed product `ratedHours * packCurrentA` (and with it `peukertFullHours`) where the rate ratio is built, before Math.pow raises it; a quotient(packCapacityAh, ratedHours * packCurrentA) that fails to fail("ratedHours") is the shape. Note this also poisons splitHours: the same result carries wholeHours: Infinity and minutes: NaN.

### `cableCrossSection` — minimumAreaMm2 → `Infinity`

- reach: extreme
- line: 613
- repro: `{ system: "single", material: "copper", lengthM: 100, currentA: 10, voltageV: 1e-200, permittedDropPct: 1e-200 }`
- seam: maxDropV where it is constructed at line 601 — the permitted drop is built from two separately guarded inputs and is then the divisor for minimumAreaMm2; guard it there, not at the division, and maxDropV also stops being returned as a plain 0 V limit.

### `inductionMotorRating` — currentA → `Infinity`

- reach: extreme
- line: 692
- repro: `{ shaftPowerKw: 100, lineVoltageV: 1e-110, powerFactor: 1e-110, efficiencyPct: 1e-108, poles: 2, system: "single" }`
- seam: The four-factor denominator inline at line 692 — hoist `f3 * lineVoltageV * powerFactor * efficiency` into a named constant built once and guarded there, before currentA divides by it.

### `beltDrive` — drivenTorqueNm → `Infinity`

- reach: extreme
- line: 452
- repro: `{ drivingDiameterMm: 1e-300, drivenDiameterMm: 10000, drivingSpeedRpm: 100, centreDistanceMm: 100000, drivingTorqueNm: 1e9 }`
- seam: The transmitted-torque product at line 452 — guard the constructed `torque * ratio * efficiencyPct / 100` where the driven torque is built. The ratio itself is finite (1e304) and the /100 does not save it, so the guard belongs on the product, not on either diameter; gearPair's identical line 508 is sound only because integer tooth counts cap its ratio at 1e4.

### `metricThread` — stressAreaMm2 → `zero`

- reach: extreme
- line: 929
- repro: `{ nominalDiameterMm: 1e-200, pitchMm: 1e-201, strengthMpa: 400 }`
- seam: circleAreaMm2 (line 119) — the one place in this file a circular area is built from a diameter. Make it yield a checked area (refuse a non-finite or exactly-zero product) and route the three hand-written copies of the same expression through it: pipeFlow's inline areaM2 (line 1125), pistonForce's annulusAreaMm2 (line 1417) and metricThread's stressAreaMm2 (line 929, which is circleAreaMm2(meanDiam

### `pipeFlow` — velocityMs → `Infinity`

- reach: extreme
- line: 1131
- repro: `{ innerDiameterMm: 1e-200, flow: { value: 1, unit: "m3/s" } }`
- seam: circleAreaMm2 (line 119) — the one place in this file a circular area is built from a diameter. Make it yield a checked area (refuse a non-finite or exactly-zero product) and route the three hand-written copies of the same expression through it: pipeFlow's inline areaM2 (line 1125), pistonForce's annulusAreaMm2 (line 1417) and metricThread's stressAreaMm2 (line 929, which is circleAreaMm2(meanDiam

### `powerFactorCorrection` — capacitancePerPhaseF → `Infinity`

- reach: extreme
- line: 1235
- repro: `{ activePowerKw: 100, presentPowerFactor: 0.8, targetPowerFactor: 0.95, lineVoltageV: 1e-200 }`
- seam: The `denominator` constant at lines 1231-1234 — it is already hoisted and named, so the guard has exactly one home: check it there, before capacitancePerPhaseF (and the capacitancePerPhaseUf derived from it) divide by a squared voltage that underflowed. Both the delta and the star branch build it, and both underflow.

### `pistonForce` — extendForceN → `zero`

- reach: extreme
- line: 1423
- repro: `{ gaugePressurePa: 1e6, boreMm: 1e-200 }`
- seam: circleAreaMm2 (line 119) — the one place in this file a circular area is built from a diameter. Make it yield a checked area (refuse a non-finite or exactly-zero product) and route the three hand-written copies of the same expression through it: pipeFlow's inline areaM2 (line 1125), pistonForce's annulusAreaMm2 (line 1417) and metricThread's stressAreaMm2 (line 929, which is circleAreaMm2(meanDiam

### `rlcResponse` — resonanceHz → `Infinity`

- reach: extreme
- line: 1799
- repro: `{ frequencyHz: 50, resistanceOhm: 10, inductanceH: 1e-200, capacitanceF: 1e-200, connection: "series" }`
- seam: The LC product at line 1799 — build `inductance * capacitance` once, as a named quantity, and guard it there before Math.sqrt and the reciprocal consume it; hasL and hasC prove each factor is above zero and say nothing about the product. bandwidthHz (line 1806) is Infinity from the same underflow and is fixed by the same guard.

### `networkEquivalent` — equivalent → `zero`

- reach: extreme
- line: 2137
- repro: `{ element: "resistor", connection: "parallel", values: [1e-320, 100] }`
- seam: The `sumOfReciprocals` accumulator at line 2136 — guard the constructed sum before the reciprocal at 2137. The values are unbounded above and below, so 1/v overflows for anything under ~5.6e-309 and the answer collapses to exactly 0 — the value this function reserves, by its own documented contract, for the shorted network at line 2133, making a wrong reading indistinguishable from a meaningful on

### `voltageDivider` — outputVoltageV → `Infinity`

- reach: extreme
- line: 2189
- repro: `{ inputVoltageV: 1e6, upperOhm: 0, lowerOhm: 1e303 }`
- seam: The two raw multiply-then-divide products at lines 2189 and 2194 — neither leg has an upper bound, so both the divider numerator and the Thevenin numerator overflow while `total` stays finite. currentA on line 2185 is already correct because it was routed through quotient; these two were not. The correct output here is 1e6 V (upperOhm is zero), so the true value is not merely representable but exa

### `threePhasePower` — currentA → `Infinity`

- reach: extreme
- line: 2264
- repro: `{ system: "single", lineVoltageV: 1e-110, powerFactor: 1e-200, activePowerKw: 100 }`
- seam: The `current` composition at line 2264 — apparentVa (1e205, finite) and f3*lineVoltageV (1e-110, finite) are each sound and their quotient is not; guard the composed current where it is built, which quotient would do since it checks its own result. phaseCurrentA at line 2275 is the same Infinity carried forward.


## kuhinja (16)

### `bakersPercentage` — flourWeight (and doughMass) → `Infinity`

- reach: extreme
- line: 523
- repro: `{ mode: "percentToWeights", lines: [{ name: "Brašno", role: "flour", value: 100 }], pieces: 1000000, bakedPieceMass: 1.7e308, bakeLoss: 0 }`
- seam: packages/core/src/pro/kuhinja.ts — the dough-mass basis inside bakersPercentage: guard doughMass where it is constructed (line 523, `input.pieces * rawPieceMass`) and flourWeight where it is constructed (line 535), before the weights map and the largest-remainder column read them. Refusing at the basis makes every downstream row unrepresentable; a check at the division would not, because the piece

### `coffeeExtraction` — extractionYield (and dissolved) → `Infinity`

- reach: extreme
- line: 781
- repro: `{ dose: 1, beverageMass: 1.7e308, tds: 99.9999999999 }`
- seam: packages/core/src/pro/kuhinja.ts — `dissolved` at line 781 in coffeeExtraction: guard the constructed `(beverageMass * tds) / 100` before it is both returned and divided by `dose`.

### `laminationLayers` — fatLayerMicrons → `zero (true value 875 µm; doughLayerMicrons simultaneously reports the full 3.5 mm as if the fat had no share at all)`

- reach: extreme
- line: 1163
- repro: `{ folds: ["half"], fatMass: 1e308, doughMass: 1e308, finalThickness: 3.5 }`
- seam: packages/core/src/pro/kuhinja.ts — `fatShare` at line 1163 in laminationLayers: guard the constructed cross-section share (both the `fatMass + doughMass` sum and the resulting ratio) before either layer thickness is built from it.

### `levainHydration` — achievedHydration → `Infinity`

- reach: extreme
- line: 1305
- repro: `{ mode: "buildLevain", seedMass: 0, seedHydration: 50, targetLevainMass: 1e-18, targetLevainHydration: 1e308 }`
- seam: packages/core/src/pro/kuhinja.ts — `flour` at line 1231 inside the exported levainSplit: guard the constructed `mass / (1 + hydration/100)` before returning, so a split that underflowed to zero flour is a fail() rather than an ok:true both branches of levainHydration (and any surface caller) then divide by.

### `nutritionPerPortion` — energy.perPortionKJ → `Infinity`

- reach: extreme
- line: 1471
- repro: `{ direction: "per100ToPortion", energy: 1.7e308, energyUnit: "kJ", nutrients: [], portionMass: 1.7e308 }`
- seam: packages/core/src/pro/kuhinja.ts — the `scale` helper at line 1445 in nutritionPerPortion: it is the single construction point for every per-portion and per-package figure (energy in both units and every nutrient row), so guarding `(per100 * mass) / 100` there fixes all six call sites at once.

### `panArea` — area → `zero`

- reach: extreme
- line: 1511
- repro: `{ kind: "rect", a: 1e-200, b: 1e-200 }`
- seam: packages/core/src/pro/kuhinja.ts — the returned `area` of panArea (all four branches, lines 1504/1507/1511/1519): guard the constructed area once at the single exit rather than per shape, so no caller — panConversion included — can ever receive a zero or non-finite area on an ok:true result.

### `panConversion` — heightForVolume → `Infinity`

- reach: extreme
- line: 1601
- repro: `{ shapeA: { kind: "rect", a: 1e-200, b: 1e-200 }, targetVolume: 1 }`
- seam: packages/core/src/pro/kuhinja.ts — the returned `area` of panArea (all four branches, lines 1504/1507/1511/1519): guard the constructed area once at the single exit rather than per shape, so no caller — panConversion included — can ever receive a zero or non-finite area on an ok:true result.

### `frustumVolume` — volume → `zero`

- reach: extreme
- line: 1632
- repro: `{ topDiameter: 1e-200, bottomDiameter: 1e-200, height: 1 }`
- seam: packages/core/src/pro/kuhinja.ts — `volumeCm3` at line 1632 in frustumVolume: guard the constructed πh(R²+Rr+r²)/3 before the /PER_KILO conversion that returns it.

### `plateCost` — margin (total, costPerPortion, sellingPrice all Infinity; rows[0].share also NaN) → `NaN`

- reach: extreme
- line: 1734
- repro: `{ lines: [{ name: "X", quantity: 1.7e308, unit: "g", unitPrice: 1.7e308, yieldPercent: 100 }], portions: 1, targetFoodCost: 100 }`
- seam: packages/core/src/pro/kuhinja.ts — the per-line cost pushed at line 1732 in plateCost: guard each constructed line cost (and the `gross` beside it) inside the loop, before the reduce at 1734, so total/costPerPortion/sellingPrice/margin/share cannot inherit a non-finite term.

### `portionsFromPack` — leftover (portionsPerPack is simultaneously Infinity) → `NaN`

- reach: extreme
- line: 1846
- repro: `{ packQuantity: 1.7e308, packUnit: "kg", portionQuantity: 1, portionUnit: "g", lossPercent: 0 }`
- seam: packages/core/src/pro/kuhinja.ts — the base-unit quantities in portionsFromPack, lines 1846–1848: guard `packBase`, `portionBase` and `usable` where the unit factor is applied, before they reach the shared usablePortions engine — the existing `portionsPerPack < 1` refusal at 1850 is downstream and Infinity walks past it.

### `ratioSplit` — rows[0].exact (rows[0].amount likewise Infinity) → `Infinity`

- reach: extreme
- line: 1968
- repro: `{ total: 1.7e308, parts: [1.7e308, 1] }`
- seam: packages/core/src/pro/kuhinja.ts — the `exact` map at line 1968 in ratioSplit: guard the constructed `(total * part) / weight` shares before they are returned and before largestRemainderSteps consumes them.

### `recipeScale` — rows[0].quantity (rounded, totalMass Infinity; share NaN) → `Infinity`

- reach: extreme
- line: 2156
- repro: `{ mode: "factor", factor: 1.7e308, lines: [{ name: "X", quantity: 1.7e308, unit: "g" }] }`
- seam: packages/core/src/pro/kuhinja.ts — the `scaled` map at line 2156 in recipeScale: guard the constructed `line.quantity * factor` for every line, before the step rounding, the totalMass sum and the share apportionment read it.

### `solutionConcentration` — componentMass1 → `Infinity (the correct answer, 8.5e307, is representable`

- reach: extreme
- line: 2326
- repro: `{ mode: "blend", c1: 100, c2: 0, targetConcentration: 50, targetMass: 1.7e308 }`
- seam: packages/core/src/pro/kuhinja.ts — the blend branch's mass construction, lines 2326–2328 in solutionConcentration: guard componentMass1, componentMass2 and totalMass where they are built, before achievedConcentration and ratioAgainst read them. r2()/roundHalfUp passes non-finite values through by design and must not be mistaken for the guard.

### `solutionConcentration` — totalMass (achievedConcentration also NaN; concentrationRatio correctly withheld by ratioA → `NaN`

- reach: extreme
- line: 2328
- repro: `{ mode: "blend", c1: 100, c2: 0, targetConcentration: 50, targetMass: 1.7e308 }`
- seam: packages/core/src/pro/kuhinja.ts — the blend branch's mass construction, lines 2326–2328 in solutionConcentration: guard componentMass1, componentMass2 and totalMass where they are built, before achievedConcentration and ratioAgainst read them. r2()/roundHalfUp passes non-finite values through by design and must not be mistaken for the guard.

### `usCustomaryUnit` — value → `Infinity`

- reach: extreme
- line: 2553
- repro: `{ value: 1.7e308, from: "impGallon", to: "l" }`
- seam: packages/core/src/pro/kuhinja.ts — `base` at line 2553 in usCustomaryUnit: guard the constructed `input.value * factor` before the l/kg division that returns it.

### `yieldTrimCook` — pricePerKgCooked (pricePerPortion likewise Infinity; cookedMass separately underflows to 0 → `Infinity`

- reach: extreme
- line: 2625
- repro: `{ mode: "forward", cleaningYield: 1e-300, cookingYield: 1e-300, portionMass: 1, apMass: 1000, pricePerKgAp: 100 }`
- seam: packages/core/src/pro/kuhinja.ts — `combined` at line 2625 in yieldTrimCook: guard the constructed `(cleaningYield/100) * (cookingYield/100)` at the point of construction, before apNeeded, pricePerKgCooked and pricePerPortion divide by it; guard `cookedMass` at 2637 on the same pass, since it underflows independently.


## muzika (11)

### `audioLevel` — dbm → `Infinity`

- reach: extreme
- line: 339
- repro: `{ entry: { kind: "vrms", value: 1e200 }, impedance: 600 }`
- seam: audioLevel — the single seam where the voltage is adopted (`const { vrms } = source` after `levelEntryToVrms`, line 329): refuse a vrms whose SQUARE is not finite, once, before dbu/dbv/vpeak/vpp/dbm are built. Every entry kind funnels through that one point, so no branch can hand the dbm expression a voltage it cannot square.

### `centsRatio` — cents → `Infinity`

- reach: extreme
- line: 822
- repro: `{ entry: { kind: "frequencies", a: 1e-300, b: 1e300 } }`
- seam: centsRatio — the single point where the interval triple is settled, i.e. after the entry branch chain and after `const ratio = 2 ** (cents / CENTS_PER_OCTAVE)` (lines 831-833): guard `cents`, `ratio` and `base * ratio` finite there, before the return object is built, rather than per-branch or per-field.

### `centsRatio` — resultFrequency → `Infinity`

- reach: extreme
- line: 840
- repro: `{ entry: { kind: "cents", value: 12000 }, baseFrequency: 1.7e308 }`
- seam: centsRatio — the single point where the interval triple is settled, i.e. after the entry branch chain and after `const ratio = 2 ** (cents / CENTS_PER_OCTAVE)` (lines 831-833): guard `cents`, `ratio` and `base * ratio` finite there, before the return object is built, rather than per-branch or per-field.

### `delayTimesFromMeasuredMs` — rows[0].bpm.straightBpm → `Infinity`

- reach: extreme
- line: 1111
- repro: `{ measuredMs: 1e-304 }`
- seam: delayTimesFromMeasuredMs — the `bpmFor` closure (lines 1109-1112) is the one place every returned bpm is constructed: band the constructed bpm there (or, equivalently, band `measuredMs` at the top the way `delayTimes` bands `bpm` to 1..999), so no cell of the table can carry a non-finite tempo.

### `soundWavelength` — wavelength → `Infinity`

- reach: extreme
- line: 1185
- repro: `{ entry: { kind: "frequency", value: 1e-310 } }`
- seam: soundWavelength — the entry branch where the frequency/wavelength PAIR is constructed (lines 1182-1190): guard the derived member of the pair once at that seam, before halfWavelength / quarterWavelength / delayMs are taken from it. Both directions (speed/frequency and speed/wavelength) close together.

### `reverbTime` — bands[0].sabine → `Infinity`

- reach: extreme
- line: 1337
- repro: `{ volume: 1e307, surfaces: [{ area: 10, alpha125: 0.5, alpha250: 0.5, alpha500: 0.5, alpha1000: 0.5, alpha2000: 0.5, alpha4000: 0.5 }] }`
- seam: reverbTime — `const numerator = RT60_FACTOR * input.volume` (line 1337), the one place the RT60 numerator is constructed: guard it finite there, before the per-band map. That closes sabine, sabineWithAir and eyring in a single stroke instead of three.

### `speakerLoad` — totalImpedance → `zero`

- reach: extreme
- line: 1535
- repro: `{ cabinets: [{ impedance: 1e-310 }], wiring: "parallel" }`
- seam: speakerLoad — the admittance accumulation and `const totalImpedance = 1 / admittance` (lines 1534-1536): guard each `1 / impedance` term and the resulting `totalImpedance` finite and above zero at that one construction seam, before driveVoltage, sharePercent, per-cabinet power and loadRatio are derived from it.

### `splAtDistance` — level → `-Infinity`

- reach: extreme
- line: 1659
- repro: `{ sensitivity: 90, power: 1, distance: 1e300, referenceDistance: 1e-300 }`
- seam: splAtDistance — the distance-RATIO construction, the one place a pair of distances becomes a dB term (`distanceLossDb`, line 1659, and `secondDifferenceDb`, line 1663): route both quotients through `quotient(...)` and refuse a non-finite ratio there, before the logarithm and before `level` is assembled.

### `pcmSize` — bytes → `Infinity`

- reach: extreme
- line: 1770
- repro: `{ sampleRate: 768000, bitDepth: 32, channels: 256, tracks: 1000, seconds: 1e300 }`
- seam: pcmSize — `const bytes = rates.bytesPerSecond * input.seconds * rates.tracks + rates.headerBytes` (line 1770), the single place the byte total is constructed: guard it finite there, before megabytes/gigabytes/mebibytes/gibibytes/exceedsWav32BitRange are all derived from it.

### `sampleCount` — samples → `Infinity`

- reach: extreme
- line: 1897
- repro: `{ sampleRate: 768000, milliseconds: 1e307 }`
- seam: sampleCount — `const samples = (input.milliseconds / 1000) * input.sampleRate` (line 1897), the single place the count is constructed: guard the product finite there (or band `milliseconds` the way `sampleRate` is banded), before `samples` and `wholeSamples` are returned.

### `varispeed` — tempo → `Infinity`

- reach: extreme
- line: 1988
- repro: `{ entry: { kind: "ratio", value: 1e306 }, tempo: 999 }`
- seam: varispeed — the end of the entry branch chain where `ratio` is settled (after line 1977): band the constructed `ratio` there to what the other three entry kinds already imply (semitones ±48 → 2**±4, cents ±12000 → 1024, sampleRates → 768), instead of letting the `ratio` kind alone be unbounded. One guard closes `tempo * ratio` and `lengthSeconds / ratio` together.


## nekretnine (14)

### `cashflowNpvIrr` — discounted[t] for t>=35, and npv → `Infinity`

- reach: large
- line: 245
- repro: `{ cashflows: Array(41).fill(1000), discountRate: -99.9999999 }`
- seam: packages/core/src/pro/result.ts — a checked `compoundFactor(rate, periods)` beside `quotient` that refuses a factor which has overflowed to Infinity or underflowed to exactly 0; adopted at nekretnine.ts:245 where the discount factor `Math.pow(1 + rate, t)` is CONSTRUCTED (and at :1788, the identical construct in rentEscalation's presentValue), so the tool fails on the factor rather than at the div

### `latePaymentInterest` — interest, total, ratioToDebt, interestPerDay → `Infinity`

- reach: **reachable**
- line: 694
- repro: `{ debt: 1000, annualRate: 1000, days: 400000, basis: "d365", method: "conformal" }`
- seam: packages/core/src/pro/result.ts — a checked `compoundFactor(rate, periods)` beside `quotient` that refuses a factor which has overflowed to Infinity or underflowed to exactly 0; adopted at nekretnine.ts:694 where `Math.pow(1 + rate, yearFraction)` is CONSTRUCTED, before it is multiplied by the debt.

### `loanAmortization` — payment (and every row of schedule, which is built from it) → `Infinity`

- reach: extreme
- line: 1041
- repro: `{ principal: 100000, annualRate: 1e-20, months: 600 }`
- seam: packages/core/src/pro/result.ts — a checked `compoundFactor(rate, periods)` beside `quotient` that refuses a factor which has overflowed to Infinity or underflowed to exactly 0; adopted inside `annuity` at nekretnine.ts:1041 where `1 - Math.pow(1 + rate, -months)` is CONSTRUCTED — one guard there covers both call sites (:950 and :994).

### `rentEscalation` — rents[t] from t=77 onward, total, average, closedFormTotal → `Infinity`

- reach: **reachable**
- line: 1768
- repro: `{ baseRent: 1000, periods: 600, index: 1000000 }`
- seam: packages/core/src/pro/result.ts — a checked `compoundFactor(rate, periods)` beside `quotient` that refuses a factor which has overflowed to Infinity or underflowed to exactly 0; adopted at nekretnine.ts:1768 where the compounded rent is CONSTRUCTED (`rent *= 1 + percent / 100`), so the series refuses at the period it stops being a number instead of pushing Infinity into the array.

### `costAllocation` — rows[0].exact → `Infinity`

- reach: extreme
- line: 540
- repro: `{ total: 1e300, weights: [1e300, 1], step: 1e300 }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:540 where the row's exact quota `total * weight` is CONSTRUCTED.

### `ownershipShares` — rows[0].area, areaCheckSum, areaDifference → `Infinity`

- reach: extreme
- line: 1213
- repro: `{ rows: [{ numerator: 1e15, denominator: 1 }], totalArea: 1e300 }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:1213 where `totalArea * Number(reduced.numerator)` is CONSTRUCTED, before the division by the denominator.

### `parcelPolygonArea` — area, ares, hectares — NOT perimeter, which Math.hypot returns finite at ~3.41e200 → `Infinity`

- reach: extreme
- line: 1399
- repro: `[{ x: 0, y: 0 }, { x: 1e200, y: 0 }, { x: 0, y: 1e200 }]`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:1399 where the shoelace cross term `current.x * next.y - next.x * current.y` is CONSTRUCTED and accumulated, so the ring is refused rather than measured.

### `plotDensityIndex` — grossFloorAreaAtPlanRatio → `Infinity`

- reach: extreme
- line: 1563
- repro: `{ plotArea: 1e300, planRatio: 1e10 }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:1563 where `atPlanRatio = plotArea * planRatio` is CONSTRUCTED (the same guard covers `atPlanCoverage` on the line below).

### `proRataDays` — amountFirst (Infinity), amountSecond (−Infinity), checkSum (NaN) → `Infinity`

- reach: extreme
- line: 1675
- repro: `{ total: 1e303, periodStart: { year: 1, month: 1, day: 1 }, periodEnd: { year: 9999, month: 12, day: 31 }, handover: { year: 1000, month: 1, day: 1 }, basis: "act" }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:1675 where the numerator `total * daysFirst` is CONSTRUCTED, before the division by totalDays.

### `rentalYield` — grossPotentialIncome, effectiveGrossIncome, netOperatingIncome → `Infinity`

- reach: extreme
- line: 1956
- repro: `{ monthlyRent: 1e308 }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:1956 where `grossPotentialIncome = monthlyRent * MONTHS_PER_YEAR` is CONSTRUCTED — every other figure in this result is derived from it.

### `roomQuadArea` — triangleAbc, triangleAcd, area → `Infinity`

- reach: extreme
- line: 2083
- repro: `{ a: 1e150, b: 1e150, c: 1e150, d: 1e150, e: 1e150 }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted inside `heron` at nekretnine.ts:2083 where the four-factor radicand is CONSTRUCTED — `Math.max(0, radicand)` passes Infinity straight through, so the guard must sit on the radicand and not on the sqrt.

### `wallCeilingArea` — perimeter, wallsGross, wallsNet, ceiling, total (and wallsNetRoundingGap, which is NaN) → `Infinity`

- reach: extreme
- line: 2211
- repro: `{ length: 1e308, width: 1e308, height: 10, openings: [] }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:2211-2216 where the room's derived geometry (`perimeter`, `wallsGross`, `ceiling`) is CONSTRUCTED — the existing `openingsArea >= wallsGross` check cannot serve as the guard because a finite openings area is never

### `weightedArea` — rows[0].area, rows[0].contribution, netArea, weightedArea → `Infinity`

- reach: extreme
- line: 2314
- repro: `{ rows: [{ length: 1e308, width: 1e308, coefficient: 1 }] }`
- seam: packages/core/src/pro/result.ts — a checked `product(a, b)` beside `quotient`, refusing a non-finite product exactly as `quotient` refuses a non-finite quotient; adopted at nekretnine.ts:2314 where `area = length * width` is CONSTRUCTED, so a row that is not a number is refused before it enters either sum.

### `rentGrossNet` — gross, base, taxAmount (Infinity); exactNet (NaN) → `Infinity`

- reach: extreme
- line: 1873
- repro: `{ net: 1e300, costPercent: 1e-10, taxRate: 100 }`
- seam: packages/core/src/pro/result.ts — the existing `quotient` is the fix here and is simply not used: adopt it at nekretnine.ts:1873 where `gross` is CONSTRUCTED from `1 - effective`, turning its `undefined` into `fail("net")`. The `effective >= 1` guard on the line above bounds the wrong thing — it only excludes the exactly-degenerate case, while `costPercent = 1e-10` leaves `1 - effective` at 1e-12 


## prosveta (4)

### `gradeStatistics` — populationVariance, populationDeviation, sampleVariance, sampleDeviation → `Infinity`

- reach: extreme
- line: 1097
- repro: `{ values: [1e300, -1e300] } — both values pass the only guard on them ('Number.isFinite'); length 2 clears 'values.length < 1' and 'MAX_VALUES'. sum = 0, mean = 0, then squares += (1e300)^2 twice = Infinity. Verified: populationVariance = Infinity, populationDeviation = Infinity, sampleVariance = Infinity, sampleDeviation = Infinity, all four returned on ok:true. Overflow starts at any pair separa`
- seam: packages/core/src/pro/prosveta.ts:1091-1097 — the two-pass moment accumulator in `gradeStatistics`. One finiteness check on `sum`/`mean`/`squares` immediately after the second loop closes (fail("values")), before `populationVariance`, `sampleVariance` and the two `Math.sqrt` calls are formed. Not at the division, and not per output field — all four bad readings descend from the single `squares` ac

### `guessingCorrection` — points → `Infinity`

- reach: extreme
- line: 1211
- repro: `{ questions: 100000, right: 100000, wrong: 0, unanswered: 0, options: 2, pointsPerQuestion: 1e305 } — questions/right/wrong/unanswered/options all clear 'isIntegerIn(_, …, 100000)'; 'isPositive(1e305)' is true (finite and > 0), and nothing bands it above. corrected = 100000, so points = 100000 * 1e305 = 1e310 → Infinity. Verified. Returned on ok:true; 'percentOfMax' stays 100 and 'corrected' stays`
- seam: packages/core/src/pro/prosveta.ts:1207-1211 — the seam where the scaled score is constructed in `guessingCorrection`. Lift `corrected * pointsPerQuestion` out of the return literal into a named const and prove it finite there (fail("pointsPerQuestion")); `corrected` is already bounded by ±100000 by the integer guards, so this product is the only place the function can leave the representable range

### `standardScore` — z, tScore (and targetScore when `target` is given) → `Infinity`

- reach: extreme
- line: 1936
- repro: `{ raw: 1.7e308, mean: -1.7e308, deviation: 1, deviationKind: "population" } — 'Number.isFinite(raw)' and 'Number.isFinite(mean)' both pass (1.7e308 < 1.797e308), 'isPositive(1)' passes, deviationKind is valid, every optional input absent. The DERIVED difference raw - mean = 3.4e308 overflows to Infinity before the division, so z = Infinity/1 = Infinity and tScore = 50 + 10*Infinity = Infinity. Ver`
- seam: packages/core/src/pro/prosveta.ts:1936 — the construction of `z` in `standardScore`. Build the standardised score once, through a checked derivation that proves the deviation-from-mean and the resulting z are finite, and refuse otherwise; `tScore`, `targetScore`, `rawFromZ`, `rawFromTScore` and `rawFromTargetScore` are all defined off that one quantity, so guarding it there is the only place that 

### `weightedGrade` — requiredPoints (and rows[].normalizedWeight on the same input) → `Infinity`

- reach: extreme
- line: 2291
- repro: `{ components: [{ scored: 0, max: 1, weight: 1.7e308 }], pending: { max: 2, weight: 1 }, targetPercent: 100 } — isPositive(max=1) ✓, isNonNegative(scored=0) and 0 <= 1 ✓, isNonNegative(weight=1.7e308) ✓ (finite is all it asks), isPositive(pending.max=2) ✓, isPositive(pending.weight=1) ✓; weightSum = 1.7e308 + 1 = 1.7e308, finite, so 'isPositive(weightSum)' passes as the claimant noted; isInRange(ta`
- seam: packages/core/src/pro/prosveta.ts:2247-2291 — the weighted-aggregate seam in `weightedGrade`: the existing `isPositive(weightSum)` line (2266) is the place the accumulated aggregates are already being judged, so extend it to prove the scaled aggregates finite (`100 * component.weight`, `weightedRatio`) and guard the constructed `requiredPoints` where it is built at 2290-2291, before it is returned


## racunovodstvo (9)

### `breakevenPoint` — breakevenUnits, breakevenUnitsWhole, targetUnits, breakevenRevenueAtWholeUnits (and breake → `Infinity (Math.ceil(Infinity) is Infinity, and Infinity * price is Infinity, so all four propagate)`

- reach: extreme
- line: 1117
- repro: `{ fixedCost: 1, price: 5e-324, variableCost: 0, targetProfit: 0 } — every guard passes (isNonNegative(1), isPositive(5e-324), isNonNegative(0)), contribution = 5e-324 > 0 so the 'contribution <= 0' refusal does not fire, and breakevenUnits = 1/5e-324 = Infinity. Stronger, unambiguously-cancellation variant, same fields: { fixedCost: 1e300, price: 1, variableCost: 0.9999999999999999, targetProfit: `
- seam: racunovodstvo.ts:1117-1119, where `contribution` and `ratio` are constructed in breakevenPoint — the existing `if (contribution <= 0) return fail("contribution")` is the seam and must additionally refuse a margin whose derived unit count is not finite (guard the constructed pair `contribution`/`ratio` with the module-local finiteOrFail before line 1120), never at the four division sites.

### `depreciationSchedule` — rows[0].charge, and via `head` every later row's charge, accumulated, closingBookValue, pl → `NaN`

- reach: extreme
- line: 1374
- repro: `{ cost: 1e307, residual: 0, usefulLife: 100, method: "syd", proration: "none" } — isPositive(1e307) passes, residual 0 <= cost passes, isIntegerIn(100, 1, 100) passes. depreciable = 1e307; charge index 0 = (1e307 * 100) / 5050, and the numerator 1e307*100 = 1e309 overflows to Infinity BEFORE the division, so the charge is Infinity and roundTo(Infinity, 2) returns NaN.`
- seam: racunovodstvo.ts:1407, immediately after the method if/else chain has finished constructing `charges` in depreciationSchedule — one finiteness guard over the constructed charge array (before the proration overlap and before roundTo), which closes the syd numerator overflow and the units-method overflow with the same check.

### `depreciationSchedule` — rows[0].charge (and accumulated, closingBookValue, writtenOff) → `NaN`

- reach: extreme
- line: 1365
- repro: `{ cost: 1e300, residual: 0, usefulLife: 1, method: "units", proration: "none", usage: [1e10], capacity: 1e10 } — usage.length 1 passes isIntegerIn(1,100), every usage value passes isNonNegative, isPositive(1e10) passes for capacity, used (1e10) is not > capacity (1e10) so the typing-error refusal does not fire, proration is "none". depreciable = 1e300; (1e300 * 1e10) = 1e310 overflows to Infinity `
- seam: racunovodstvo.ts:1407, immediately after the method if/else chain has finished constructing `charges` in depreciationSchedule — one finiteness guard over the constructed charge array (before the proration overlap and before roundTo), which closes the syd numerator overflow and the units-method overflow with the same check.

### `fxDifference` — rateChangePercent → `Infinity`

- reach: extreme
- line: 1669
- repro: `{ amount: 100, rateOrigin: 1e-322, rateSettlement: 1, rateUnit: 1000, side: "receivable", amountDecimals: 2, dateOrigin: { year: 2024, month: 1, day: 1 }, dateSettlement: { year: 2024, month: 6, day: 1 } } — isPositive(1e-322) passes (finite and > 0), rateUnit 1000 is one of the three allowed, both dates are valid. unitRateOrigin = 1e-322/1000 underflows to EXACTLY 0 (verified: '1e-322/1000 === 0'`
- seam: racunovodstvo.ts:1669-1670, where `unitRateOrigin` and `unitRateSettlement` are constructed in fxDifference — the per-unit rates are the derived quantities and must be re-guarded as positive-and-finite there (the input rate passing isPositive says nothing about the rate after division by rateUnit), not at line 1686's division.

### `crossRate` — rate → `NaN`

- reach: extreme
- line: 1715
- repro: `{ rateAB: 1e200, rateSecond: 1e200, direction: "inverse", rateDecimals: 2 } — both pass isPositive, isIntegerIn(2, 0, 6) passes. The inverse branch is rateAB * rateSecond = 1e400 → Infinity, and roundTo(Infinity, 2) returns NaN, which is the sole field of the result.`
- seam: racunovodstvo.ts:1715, where `rate` is constructed in crossRate — the guard belongs on the constructed cross rate before it is handed to roundTo, covering both the multiplying and the dividing branch at once.

### `grossFromNet` — gross, taxBase, tax, contributions, netCheck (and totalCost when employerPercent is given) → `NaN`

- reach: extreme
- line: 1800
- repro: `{ net: 1e300, model: "B", taxPercent: 49.9999999999999, contributionPercent: 50, standardCostPercent: 0 } — isPositive(1e300), isInRange(49.9999999999999, 0, 100), isInRange(50, 0, 100) and isInRange(0, 0, 100) all pass. netOfCosts = 1; denominator = 1 - (0.499999999999999 + 0.5) = 9.992007221626409e-16, which is > 0 so the 'denominator <= 0' refusal does not fire; gross = 1e300 / 9.99e-16 = Infin`
- seam: racunovodstvo.ts:1787 and 1800 unified — the `denominator` construction in grossFromNet, which today is checked only for sign; both models must go through one seam that builds `gross` from (net, denominator) and refuses unless the constructed gross is finite, rather than each model separately testing `denominator <= 0`.

### `loanSchedule` — annuity, plus rows[].interest, rows[].principal and rows[].payment for every non-final row → `NaN`

- reach: extreme
- line: 2349
- repro: `{ principal: 1e308, annualRatePercent: 1000, instalments: 600, frequency: 1, plan: "annuity", rateMethod: "proportional", decimals: 2 } — isPositive(1e308), isInRange(1000, 0, 1000), isIntegerIn(600, 1, 600), frequency 1 allowed, isIntegerIn(2, 0, 4) all pass. frequency !== 12 so the general branch runs: periodicRate = 10, discount = exp(-600*log1p(10)) underflows to 0 so (1 - discount) = 1 and pr`
- seam: racunovodstvo.ts:2347-2349, where `periodicRate` is derived in loanSchedule — one guard there requiring `principal * periodicRate` (and hence the constructed annuity) to be finite; since every row's opening balance is bounded by `principal`, that single seam bounds every row product and the annuity quotient alike, and it covers both plans, unlike a check at line 2365.

### `priceMargin` — sellingPrice, difference, marginOnPricePercent → `Infinity (sellingPrice, difference); NaN (marginOnPricePercent)`

- reach: extreme
- line: 2551
- repro: `{ purchasePrice: 1e300, landedCosts: 0, pair: "costAndMarginOnCost", marginOnCostPercent: 1e20 } — isNonNegative(1e300) and isNonNegative(0) pass; markup is only checked Number.isFinite and > -100, with no upper bound, so 1e20 passes. cost = 1e300; sellingPrice = 1e300 * (1 + 1e18) = Infinity; difference = Infinity; marginOnPricePercent = (100*Infinity)/Infinity = NaN, returned on ok: true. The si`
- seam: racunovodstvo.ts:2586, the single exit of priceMargin where `difference` and the two percentages are built from the constructed (cost, sellingPrice) pair — the guard belongs on that constructed pair, which requires routing the two branches that currently return early (priceAndMarginOnPrice at 2558, priceAndMarginOnCost at 2576) through the same exit so no branch can construct a non-finite price wi

### `inventoryCosting` — purchaseValue, fifo.closingValue, average.closingValue → `NaN`

- reach: extreme
- line: 2127
- repro: `{ openingQuantity: 1e160, openingUnitCost: 1e160, movements: [], averageMode: "moving", decimals: 2 } — both pass isNonNegative (finite, >= 0, no upper bound), isIntegerIn(0, 0, 1000) passes for the empty movements array, isIntegerIn(2, 0, 6) passes. openingValue = 1e320 → Infinity; purchaseValue = roundTo(Infinity, 2) = NaN, and fifoClosing/averageClosing = roundTo(Infinity - 0, 2) = NaN. The sam`
- seam: racunovodstvo.ts:2127-2130, where `openingValue` and `receiptsValue` are constructed in inventoryCosting — one finiteness guard over the constructed valuations (opening value and each receipt's quantity x unitCost) before `purchaseValue` and the layer/average state are built from them.


## tekst (3)

### `readingTime` — totalSeconds → `Infinity (and totalDisplaySeconds = Infinity, totalClock = "NaN:NaN" because Math.floor(Infinity) % 60 is NaN, paragraphs[0].seconds/displaySeconds = Infinity, paragraphs[0].clock = "NaN:NaN")`

- reach: extreme
- line: 1600
- repro: `{ text: "a", pace: 5e-324, pause: 0 } — textFits("a") true; isPositive(5e-324) true (finite and > 0) and 5e-324 > 1000 false, so the pace guard at 1588 passes; isInRange(0,0,600) true. paragraphsOf gives one block, spacedWordCount = 1, so seconds = (1 / 5e-324) * 60. node: (1/5e-324)*60 === Infinity.`
- seam: packages/core/src/pro/tekst.ts:1600 — where `seconds` is constructed inside readingTime's loop. Build it as `quotient(count * SECONDS_PER_MINUTE, input.pace)` and `return fail("pace")` when that is undefined (quotient already checks its own result for finiteness). Every downstream figure — displaySeconds, clock, entrySeconds, entryClock, totalSeconds, displayedSumSeconds — derives from this one va

### `subtitleAudit` — blocks[0].durationMs → `Infinity (and blocks[0].endMs = Infinity; collateral: charactersPerSecond is roundHalfUp(5/(Infinity/1000), 2) = exactly 0, i.e. "0 characters per second" for a 5-character cue)`

- reach: **reachable**
- line: 2185
- repro: `{ subtitle: "1\n00:00:00,000 --> " + "9".repeat(400) + ":00:00,000\nHello", countTags: false } — textFits passes (≈420 code points vs 500000); every optional limit is undefined so no isIntegerIn/isInRange guard runs; parseCues returns exactly 1 cue (verified by executing CUE_LINE: the hour group (?:(\d+):)? is unbounded, so the 400-nine hour field matches and lines.slice(at+1) is ["Hello"]), so pa`
- seam: packages/core/src/pro/tekst.ts — the milliseconds constructor of the subtitle-timecode section: one `wholeMs(h, m, s, f)` builder for the expression `((h*60+m)*60+s)*1000+f`, which today exists twice (in `cueTimes()` at 2048–2055 and inline in `parseTimecode()` at 2087–2089), returning `undefined` when the total is not finite (or exceeds the largest timecode formatTimecode can render). Both sites 

### `parseTimecode` — ms → `Infinity`

- reach: **reachable**
- line: 2086
- repro: `{ text: "9".repeat(400) } — the function's only guard is the regex /^([+-]?)(?:(\d+):(\d{1,2}):(\d{1,2})[.,](\d{3})|(\d+))$/u, whose second alternative (\d+) is unbounded, so a 400-digit run matches with match[6] defined (verified by execution). There is no textFits, no length cap, and no numeric guard. sign = 1, Number("9".repeat(400)) = Infinity.`
- seam: packages/core/src/pro/tekst.ts — the milliseconds constructor of the subtitle-timecode section: one `wholeMs(h, m, s, f)` builder for the expression `((h*60+m)*60+s)*1000+f`, which today exists twice (in `cueTimes()` at 2048–2055 and inline in `parseTimecode()` at 2087–2089), returning `undefined` when the total is not finite (or exceeds the largest timecode formatTimecode can render). Both sites 


## transport (packages/core/src/pro/transport.ts) (3)

### `rigidAxleTargetDistance` — distance (and `shift`, which is Infinity - 0 = Infinity) → `Infinity, returned on ok: true from a life-safety axle-load tool. distanceOutOfBounds is true, so the surface flags it, but the reading itself still prints as ∞ m.`

- reach: extreme
- line: 339
- repro: `{ wheelbase: 6, emptyFront: 0, emptyRear: 0, items: [{ mass: 1e-310, distance: 0 }], itemIndex: 0, targetRear: 40000 } — every guard passes: isInRange(6,0.5,12); isInRange(0,0,30000); isInRange(0,0,40000); validRows accepts mass 1e-310 because isInRange(1e-310,0,60000) is true for a subnormal; isIntegerIn(0,0,0); isInRange(40000,0,40000); isPositive(1e-310) is true. requiredMoment = (40000-0)*6 = `
- seam: The solved-distance construction shared by both target solvers (transport.ts:339 and :556): build the distance as `quotient(moment - others, chosen.mass)` from ./result.js — which already refuses a zero/non-finite divisor AND re-checks that its own result is finite — and turn the `undefined` into `fail("itemMass")` at the point of construction. One helper, two adoptions; after it, no solver in thi

### `tractorSemitrailerTargetDistance` — distance (and `shift`) → `Infinity, returned on ok: true from a life-safety load-placement tool.`

- reach: extreme
- line: 556
- repro: `{ kingpinToBogie: 15, trailerTare: 0, trailerTareCentre: 0, items: [{ mass: 1e-310, distance: 0 }], itemIndex: 0, targetBogie: 40000, tractorWheelbase: 6, fifthWheelFromFrontAxle: 0, emptyFront: 0, emptyDrive: 0 } — every guard passes: isInRange(15,1,15); isInRange(0,0,20000); isInRange(0,0,15); validRows accepts mass 1e-310; isIntegerIn(0,0,0); isInRange(40000,0,40000); isInRange(6,0.5,12); isInR`
- seam: The solved-distance construction shared by both target solvers (transport.ts:339 and :556): build the distance as `quotient(moment - others, chosen.mass)` from ./result.js — which already refuses a zero/non-finite divisor AND re-checks that its own result is finite — and turn the `undefined` into `fail("itemMass")` at the point of construction. One helper, two adoptions; after it, no solver in thi

### `cargoCentreOfGravity` — x (also momentX and momentAboutReference; y/z go the same way with y=±20 or z=±20) → `Infinity on an ok: true result`

- reach: extreme
- line: 705
- repro: `THE SUBMITTED REPRO IS REFUTED AND REPLACED — see 'wrongValue'. Working repro: { items: [{ mass: 1e307, x: 50, y: 0, z: 0 }], useItemDimensions: false, floorHeight: 0, track: 1, innerWidth: 1, momentReference: 0 }. Guards: items.length 1 is in [1,200]; isNonNegative(1e307) is true — and this is the ONLY mass guard in the file with no upper bound, every other tool bands mass with isInRange(row.mass`
- seam: transport.ts:702-704 in cargoCentreOfGravity, where momentX/momentY/momentZ are summed — the seam that builds the derived quantity. Refuse there (`if (![momentX, momentY, momentZ].every(Number.isFinite)) return fail("itemMass")`) before any of the three divisions at 705-707, the combined block at 727-742 or momentAboutReference at 758 can consume them. The root cause worth fixing at the same seam 


## trening (11)

### `bodyComposition` — targetMass → `Infinity (and change = Infinity, targetFatMass = Infinity), all on ok: true`

- reach: extreme
- line: 451
- repro: `{ mass: 1e300, bodyFat: 0, target: 99.99999999999999 } — isPositive(1e300) true; isPercentBelowHundred(0) true; isPercentBelowHundred(99.99999999999999) true (it is strictly < 100). leanMass = 1e300, 1 - target/100 = 1.1102230246251565e-16, quotient = 9e315.`
- seam: bodyComposition, where targetMass is constructed (trening.ts:451) — build it through a guarded derivation (quotient(leanMass, 1 - target/100)) and fail("target") when it is not finite, so change and targetFatMass can never be built from a non-finite mass.

### `bodyIndices` — bmi → `Infinity (ponderal also Infinity) on ok: true`

- reach: extreme
- line: 510
- repro: `{ mass: 70, height: 1e-300 } — isPositive(1e-300) true. heightM = 1e-302; heightM*heightM underflows to exactly 0; 70/0 = Infinity. ponderal likewise.`
- seam: bodyIndices, where the height powers are constructed (trening.ts:507-511) — build heightM² and heightM³ as named guarded quantities immediately after heightM, and refuse there, rather than letting either division see a zero denominator.

### `ergSplitWatts` — power → `Infinity on ok: true`

- reach: extreme
- line: 671
- repro: `{ split: 1e-300, distance: 2000 } — exactly one of split/power given; isPositive(distance) and isPositive(split) both true. pace = 2e-303 passes the isPositive(pace) guard at line 667, but pace*pace*pace underflows to exactly 0, so 2.8/0 = Infinity.`
- seam: ergSplitWatts, at the pace-construction seam (trening.ts:665-667) — construct paceCubed = pace*pace*pace beside pace and guard it with the same isPositive check, so the published relation can never be evaluated against a collapsed cube.

### `intervalSession` — total → `Infinity (also rest, setDuration, totalRest, repRestRatio = Infinity; totalClock renders as the string "Infinity:NaN:NaN") on ok: true`

- reach: extreme
- line: 920
- repro: `{ work: { kind: "seconds", seconds: 1e200 }, rest: { kind: "ratio", work: 1, rest: 1e200 }, reps: 2, sets: 2, restBetweenSets: 0, warmup: 0, cooldown: 0 } — every guard passes (isPositive on work.seconds, rest.work, rest.rest; isPositiveInteger on reps/sets). restSeconds = 1e200*1e200/1 = Infinity, so setDuration, totalRest and total are all Infinity while totalWork stays a finite 4e200.`
- seam: tempoTimeline (trening.ts:853-867) — the one place both interval tools build their timeline: validate the four constructed quantities (setDuration, totalWork, totalRest, total) there and signal a refusal, so no caller can hand out a non-finite timeline or a clock string built from one.

### `jumpHeight` — height → `Infinity (heightM also Infinity) on ok: true`

- reach: extreme
- line: 1011
- repro: `{ flightTime: 1e200 } — exactly one of flightTime/height given; isPositive(1e200) true; gravity defaults to G. heightM = (9.80665 * 1e200 * 1e200)/8 overflows to Infinity before the /8.`
- seam: jumpHeight, where heightM is constructed (trening.ts:1008-1012) — guard the constructed heightM (and the derived time) immediately at that seam, before height, takeoff and rsi are built from it.

### `limbSymmetry` — needed → `Infinity (gap = Infinity) on ok: true`

- reach: extreme
- line: 1084
- repro: `{ involved: 1, reference: 1e300, target: 1e300 } — isNonNegative(involved), isPositive(reference), isPositive(target) all true; target is documented as a regulated-tier input with no default and deliberately no bound. needed = (1e300 * 1e300)/100 overflows in the product before the /100.`
- seam: limbSymmetry, where needed is constructed (trening.ts:1084) — guard the constructed reference × target quantity at that line and refuse, since bounding target itself is forbidden by the tool's own regulated-tier rule.

### `runningPace` — splits[0].seconds → `Infinity (clock renders as "Infinity:NaN:NaN") while distance, time and speedMps are all finite and correct`

- reach: extreme
- line: 1386
- repro: `{ distance: { unit: "km", value: 1e250 }, time: 1e250, splitStep: 1e253 } — two of three fields given; isPositive on splitStep, distance.value and time all true. metres = 1e253, ratio = 1, rowCount = 1 (well under MAX_SPLIT_ROWS). covered = 1e253, and covered*seconds = 1e503 overflows to Infinity before the division by metres would have cancelled it back to the true 1e250.`
- seam: runningPace, at the split-geometry seam just before the row loop (trening.ts:1383) — build and guard the one time-per-metre factor there (seconds/metres) and derive each row from it, instead of forming the covered × seconds product inside the loop.

### `setTempoTut` — tutPerSet → `Infinity (totalTut and block also Infinity; tutPerSetClock = "Infinity:NaN") on ok: true`

- reach: extreme
- line: 862
- repro: `{ eccentric: 1e300, pauseBottom: 0, concentric: 0, pauseTop: 0, reps: 1e300, sets: 1, restBetweenSets: 0 } — isNonNegativeInteger(1e300) is true (Number.isInteger(1e300) === true) for the phase, isPositiveInteger(1e300) is true for reps. perRep = 1e300; setDuration = reps*work = 1e300*1e300 = Infinity, totalWork likewise.`
- seam: tempoTimeline (trening.ts:853-867) — the one place both interval tools build their timeline: validate the four constructed quantities (setDuration, totalWork, totalRest, total) there and signal a refusal, so no caller can hand out a non-finite timeline or a clock string built from one.

### `splitSeries` — decrement → `Infinity (fatigueIndex also Infinity) on ok: true`

- reach: extreme
- line: 1563
- repro: `[1e-307, 5, 5] — length >= 2 and isPositive holds for every entry. total = 10, count = 3, best = 1e-307. total/(count*best) = 3.333e307 is finite; the overflow is one step later, at the × 100: 100 * 3.333e307 = Infinity. fatigueIndex = (100 * (5 - 1e-307))/1e-307 = 5e309 = Infinity by the same route.`
- seam: splitSeries, where the two decline measures are constructed (trening.ts:1562-1563) — build fatigueIndex and decrement through one guarded derivation that checks the FINAL percentage (not just the divisor), since the divisor here is legal and the × 100 scaling is what overflows.

### `sweatRate` — ratePerHour → `Infinity (litresPerHour and replacementPerHour also Infinity) on ok: true`

- reach: extreme
- line: 1643
- repro: `{ preMass: 1e305, postMass: 50, drunk: 0, food: 0, urine: 0, duration: 60, replacementPercent: 50 } — isPositive(preMass) has no MAX_KG ceiling in this tool. massLost = 1e305, sweatGrams = 1e308 (still finite), and SEC_PER_MIN * sweatGrams = 6e309 overflows to Infinity before the division by duration.`
- seam: sweatRate, where the mass-balance chain is constructed (trening.ts:1641-1643) — guard massLost, sweatGrams and ratePerHour at their construction site (the same place MAX_KG would belong if the tool adopted it), before the three derived rate fields are built.

### `trainingVolumeLoad` — rows[0].intensity → `NaN (row reps and tonnage = Infinity; totalReps = Infinity and meanLoad = NaN; intensityGroups[0].meanIntensity = NaN) on ok: true`

- reach: extreme
- line: 1745
- repro: `{ rows: [{ sets: 1e200, reps: 1e200, load: 100, oneRm: 100 }] } — isPositiveInteger accepts 1e200 for both (Number.isInteger(1e200) === true), isNonNegative(load) and isPositive(oneRm) pass. reps = 1e200*1e200 = Infinity, rowTonnage = Infinity, rowMeanLoad = Infinity/Infinity = NaN, so intensity = (100*NaN)/100 = NaN.`
- seam: trainingVolumeLoad, at the row-derivation seam inside the loop (trening.ts:1745-1746) — guard the constructed reps = sets × reps and rowTonnage there and fail("rows"), so no row-, group- or total-level mean can be built from a collapsed product.


## zanat (10)

### `fabricYardageRepeat` — rows[0].usage, rows[0].usagePerPiece, totalLength, orderLength, usedArea, wasteArea → `Infinity`

- reach: extreme
- line: 176
- repro: `{ rows: [{ width: 1.7976931348623157e308, height: 1, count: 1 }], rollWidth: 320, seamAllowance: 0, verticalRepeat: 0, waste: 30, grainMandatory: false }`
- seam: packages/core/src/pro/zanat.ts, the build() closure in fabricYardageRepeat (lines 165-191) where exactLength and usage are constructed: one finite check on the constructed row before results.push, so no FabricRowResult with a non-finite length can exist. Everything downstream (usagePerPiece, totalLength, orderLength, usedArea, wasteArea) is a sum or product of that row and needs no check of its ow

### `iso286Fit` — maxClearance, meanClearance → `Infinity`

- reach: extreme
- line: 517
- repro: `{ nominalSize: 10, holeDeviations: { upper: 1.7976931348623157e308, lower: 0 }, shaftDeviations: { upper: 0, lower: -1.7976931348623157e308 } }`
- seam: packages/core/src/pro/zanat.ts, iso286Fit lines 517-518 where maxClearance/minClearance are constructed (feeding meanClearance at 532): one finite check on the constructed clearance triple, before the result object is built. Guarding here rather than in the two manual-deviation blocks (452-467, 473-479) is one place instead of two.

### `mortarMixQuantity` — freshVolume, compactedVolume, binderVolume, aggregateVolume, binderMass, aggregateMass, bi → `Infinity`

- reach: extreme
- line: 838
- repro: `{ mode: "onsite", volume: 1.7976931348623157e308, waste: 30, packingFactor: 1.6, ratio: 5, binderDensity: 1400, aggregateDensity: 1600, waterCementRatio: 0.5, bagMass: 25 }`
- seam: packages/core/src/pro/zanat.ts, mortarFreshVolume (lines 834-844) at the point the fresh volume is returned: one finite check on the constructed volume covering both the `volume` branch (838) and the area x thickness branch (843). Both mortarMixQuantity modes go through this one function, so the whole downstream chain in the onsite branch (965-976) and the premixed mass (937) are covered by that s

### `sheetMetalBend` — developedLength (Infinity); bendLines[1].startFromOppositeEdge and .endFromOppositeEdge (N → `NaN`

- reach: extreme
- line: 1339
- repro: `{ thickness: 1, radius: 5, angle: 90, kFactor: 0.4, legs: [1.7976931348623157e308, 1.7976931348623157e308, 100], legsAs: "tangent" }`
- seam: packages/core/src/pro/zanat.ts, one shared tangent-total helper adopted by both sheet-metal tools where the tangent sum is built — sheetMetalBend line 1339 and sheetMetalKFactorFromSample lines 1385-1392 — refusing a non-finite total (and a non-finite developedLength) at the summation. Never at the bend-line subtraction (1353-1354) and never at the K-factor division (1394-1395), which are the cons

### `sheetMetalKFactorFromSample` — kFactor → `-Infinity`

- reach: extreme
- line: 1394
- repro: `{ thickness: 1, radius: 5, angle: 90, outerLegs: [1.7976931348623157e308, 1.7976931348623157e308], measuredLength: 6000 }`
- seam: packages/core/src/pro/zanat.ts, one shared tangent-total helper adopted by both sheet-metal tools where the tangent sum is built — sheetMetalBend line 1339 and sheetMetalKFactorFromSample lines 1385-1392 — refusing a non-finite total (and a non-finite developedLength) at the summation. Never at the bend-line subtraction (1353-1354) and never at the K-factor division (1394-1395), which are the cons

### `shelfDeflection` — distributedDeflection, totalDeflection (Infinity); selfWeightDeflection (Infinity); spanOv → `Infinity`

- reach: extreme
- line: 1507
- repro: `{ span: 5000, width: 2000, thickness: 200, udlMass: 0, modulus: 20000, shelfMass: 1e300 }`
- seam: packages/core/src/pro/zanat.ts, shelfDeflection lines 1483-1489 where selfWeightMass is constructed: one banded/finite check on the constructed selfWeightMass after both branches (given mass, and density x section), matching the band udlMass already carries at 1474. That covers the shelfDensity route too, which overflows the same way, and keeps the guard out of the deflection expressions at 1507-1

### `tapDrillSize` — minBlindHoleDepth → `Infinity`

- reach: extreme
- line: 1856
- repro: `{ nominalDiameter: 6, pitch: 0.2, chamferedThreads: 1.7976931348623157e308, threadDepth: 1.7976931348623157e308 }`
- seam: packages/core/src/pro/zanat.ts, tapDrillSize lines 1852-1857 where minBlindHoleDepth is constructed: band chamferedThreads and threadDepth there instead of the bare isPositive at 1854-1855 — they are the only two inputs in this function that carry no upper bound, and this block is the only place they are used.

### `timberVolume` — mass → `Infinity`

- reach: extreme
- line: 2113
- repro: `{ mode: { kind: "stacked-to-solid", stackedVolume: 1.7976931348623157e308, packingCoefficient: 0.9 }, density: 1300 }`
- seam: packages/core/src/pro/zanat.ts, the three raw volume-mode guards in timberVolume — targetVolume (2091), stackedVolume (2105), solidVolume (2117) — replaced by one banded volume guard adopted at all three, so no volume-mode branch can construct pieceCount (2093), totalVolume (2107) or mass (2113/2100/2125) from an unbounded input. One helper, three adoptions, not three patches.

### `timberVolume` — pieceCount → `Infinity`

- reach: extreme
- line: 2093
- repro: `{ mode: { kind: "sawn-from-volume", thickness: 5, width: 5, pieceLength: 0.1, targetVolume: 1.7976931348623157e308, section: "rough" } }`
- seam: packages/core/src/pro/zanat.ts, the three raw volume-mode guards in timberVolume — targetVolume (2091), stackedVolume (2105), solidVolume (2117) — replaced by one banded volume guard adopted at all three, so no volume-mode branch can construct pieceCount (2093), totalVolume (2107) or mass (2113/2100/2125) from an unbounded input. One helper, three adoptions, not three patches.

### `weldConsumable` — legUsed, crossSectionArea, weldMassPerMetre, weldVolume, weldMass, consumableMass → `Infinity`

- reach: extreme
- line: 2351
- repro: `{ seamType: "fillet", throat: 1.7976931348623157e308, reinforcement: 0, weldLength: 1, efficiency: 1, waste: 0 }`
- seam: packages/core/src/pro/zanat.ts, weldConsumable lines 2346-2356 where legUsed and area are constructed: band throat at 2350 the way leg is already banded at 2353 (isInRange(leg, 2, 30)), so the fillet area cannot be built non-finite. The butt branch is already banded on every input, so this single asymmetry is the whole class here.

