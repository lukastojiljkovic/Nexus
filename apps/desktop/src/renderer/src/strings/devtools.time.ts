/**
 * „Vreme" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 *
 * Neither tool's GENERATED sentences live here — `explainCronSr` and
 * `formatRelativeSr` build their own Serbian prose inside
 * `@nexus/core/devtools/datetime.ts`, with the plural and case arithmetic that
 * needs. This table holds only what a flat table CAN hold: field labels,
 * option names and fixed refusal headings.
 */
export const DEVTOOLS_TIME_SR = {
  datetime: {
    input: "Vrednost",
    inputHint:
      "Unix broj (sekunde, milisekunde, mikrosekunde ili nanosekunde), ISO 8601 ili RFC 2822.",
    source: "Zapis",
    sourceAuto: "Prepoznaj sam",
    sourceSeconds: "Unix sekunde",
    sourceMilliseconds: "Unix milisekunde",
    sourceMicroseconds: "Unix mikrosekunde",
    sourceNanoseconds: "Unix nanosekunde",
    sourceFiletime: "Windows FILETIME",
    sourceTicks: ".NET tikovi",
    detected: "Prepoznato kao",
    now: "Sada (UTC)",
    iso: "ISO 8601",
    fraction: "Decimale sekunde",
    fractionAuto: "Koliko treba",
    fraction0: "Bez decimala",
    fraction3: "Milisekunde (3)",
    fraction6: "Mikrosekunde (6)",
    fraction9: "Nanosekunde (9)",
    rfc: "RFC 2822",
    rfcOutOfRange: "RFC 2822 ne ume da zapiše godine van 0000–9999.",
    form: "Oblik",
    value: "Vrednost",
    about: "O trenutku",
    civilDate: "Datum",
    weekday: "Dan u nedelji",
    isoWeek: "ISO nedelja",
    dayOfYear: "Dan u godini",
    of: "od",
    leapYear: "Prestupna godina",
    yes: "da",
    no: "ne",
    relative: "Relativno",
    zone: "Vremenska zona",
    zonePlaceholder: "Europe/Belgrade",
    inZone: "U zoni",
    offset: "Pomeraj",
    invalidZone: "Nepoznata vremenska zona.",
    invalid: "Nije prepoznat trenutak.",
    duration: "Trajanje",
    durationHint: "1h30m, 90m, 5400s, 1,5h",
    durationCompact: "Kratko",
    durationWords: "Rečima",
    invalidDuration: "Nije prepoznato trajanje.",
    durationUnrepresentable: "Ovo trajanje se ne može zapisati u ovom obliku.",
    weekdayNames: [
      "Ponedeljak",
      "Utorak",
      "Sreda",
      "Četvrtak",
      "Petak",
      "Subota",
      "Nedelja",
    ],
  },
  cron: {
    input: "Cron izraz",
    inputHint: "min sat dan mesec dan-u-nedelji, šest polja sa sekundama napred, ili @makro.",
    meaning: "Znači",
    macro: "Makro",
    fields: "Polja",
    fields5: "5 (klasičan crontab)",
    fields6: "6 (sa sekundama)",
    offendingToken: "Sporni deo",
    next: "Sledeća paljenja",
    count: "Koliko",
    zone: "Vremenska zona",
    zoneHint: "Cron bez navedene zone radi po UTC-u.",
    zonePlaceholder: "UTC",
    invalidZone: "Nepoznata vremenska zona.",
    never: "Ovaj izraz nikada ne okida.",
    fewer: "Manje paljenja nego što je traženo — izraz retko okida.",
    unionNote:
      "Kad su i dan u mesecu i dan u nedelji zadati brojem, dan se poklapa čim odgovara " +
      "bilo kojem od njih; čim je jedno od njih zvezdica, traži se poklapanje oba.",
  },
} as const;
