/**
 * „IT" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **The unit tables are here and not in the surface**, because a unit is copy:
 * `MB` and `MiB` are different units and both are shown, so a reader can see
 * which one a figure is in rather than trusting a label that says „MB" for a
 * binary number.
 */
export const PRO_IT_SR = {
  units: {
    data: {
      bit: "bit",
      kbit: "kbit",
      Mbit: "Mbit",
      Gbit: "Gbit",
      Tbit: "Tbit",
      B: "B",
      kB: "kB",
      MB: "MB",
      GB: "GB",
      TB: "TB",
      KiB: "KiB",
      MiB: "MiB",
      GiB: "GiB",
      TiB: "TiB",
    },
    rate: {
      bitPerSecond: "bit/s",
      kbitPerSecond: "kbit/s",
      MbitPerSecond: "Mbit/s",
      GbitPerSecond: "Gbit/s",
      bytePerSecond: "B/s",
      kBPerSecond: "kB/s",
      MBPerSecond: "MB/s",
      GBPerSecond: "GB/s",
      KiBPerSecond: "KiB/s",
      MiBPerSecond: "MiB/s",
      GiBPerSecond: "GiB/s",
    },
    diskSize: {
      GB: "GB",
      TB: "TB",
      TiB: "TiB",
    },
  },

  "transfer-time": {
    size: "Veličina podataka",
    sizeUnit: "Jedinica veličine",
    rate: "Brzina prenosa",
    rateUnit: "Jedinica brzine",
    overhead: "Dodatni saobraćaj",
    overheadHint:
      "U procentima veličine podataka. Prazno polje znači 0 % — samo korisni podaci, bez zaglavlja.",
    results: "Rezultat",
    totalTime: "Vreme prenosa",
    totalSeconds: "Vreme u sekundama",
    effectiveBytes: "Ukupno preneti bajtovi",
    overheadUsed: "Uračunat dodatni saobraćaj",
    formulaLine: "t = veličina × 8 / brzina     (faktor 8 samo kad se bajtovi i bitovi sretnu)",
    inputs: "Uneseno",
    unitDays: "d",
    unitHours: "h",
    unitMinutes: "min",
    unitSeconds: "s",
    unitB: "B",
    errorSize: "Veličina mora biti broj, nula ili veći.",
    errorRate: "Brzina mora biti veća od nule.",
    errorOverhead: "Dodatni saobraćaj je između 0 i 10 000 procenata.",
  },

  "transfer-rate": {
    value: "Vrednost",
    unit: "Jedinica",
    binaryNote:
      "Decimalni prefiksi su stepeni desetice, binarni stepeni dvojke: 1 MiB/s je 8,388608 Mbit/s.",
    results: "Rezultat",
    colUnit: "Jedinica",
    colValue: "Vrednost",
    formulaLine: "1 B/s = 8 bit/s     decimalno: 10³     binarno: 2¹⁰",
    inputs: "Uneseno",
    errorValue: "Vrednost mora biti broj, nula ili veći.",
  },

  "raid-capacity": {
    level: "Nivo RAID-a",
    level0: "RAID 0 — trake bez zaštite",
    level1: "RAID 1 — ogledalo",
    level5: "RAID 5 — jedan paritet",
    level6: "RAID 6 — dva pariteta",
    level10: "RAID 10 — ogledalo u trakama",
    diskCount: "Broj diskova",
    diskCountHint:
      "Samo diskovi sa podacima, bez rezervnih. Nivoi traže najmanje 2, 3 ili 4 diska, u zavisnosti od nivoa.",
    diskSize: "Veličina jednog diska",
    diskSizeUnit: "Jedinica veličine diska",
    hotSpares: "Rezervni diskovi",
    hotSparesHint: "U toploj rezervi, van kapaciteta i pariteta niza. Prazno polje znači nijedan.",
    rebuildRate: "Brzina rebilda",
    rebuildRateHint: "Izmerena brzina u MB/s. Prazno polje izostavlja red sa vremenom rebilda.",
    results: "Rezultat",
    rawBytes: "Sirov kapacitet",
    usableBytes: "Iskoristiv kapacitet",
    usableTiB: "Iskoristivo, kako ga vidi sistem",
    efficiency: "Iskoristivost",
    toleratedFailures: "Broj diskova koji smeju da otkažu",
    redundancyDisks: "Diskovi za redundanciju",
    dataDisks: "Diskovi sa podacima",
    hotSparesOut: "Rezervni diskovi",
    rebuildTime: "Vreme rebilda",
    capacityNote:
      "Kapacitet je kapacitet niza i ne odbija zauzeće fajl-sistema, koje zavisi od njegovog " +
      "izbora i podešavanja.",
    formulaLine:
      "0: N·C     1: C     5: (N−1)·C     6: (N−2)·C     10: (N/2)·C     C = veličina diska",
    inputs: "Uneseno",
    unitB: "B",
    unitTiB: "TiB",
    unitHours: "h",
    errorCount: "Broj diskova je ceo broj od 2 do 240 i mora biti dovoljan za izabrani nivo.",
    errorCountEven: "RAID 10 traži paran broj diskova.",
    errorCountTwo: "RAID 1 u ovoj alatki znači tačno dva diska.",
    errorSize: "Veličina diska mora biti veća od nule.",
    errorSpares: "Broj rezervnih diskova je ceo broj od 0 do 100.",
    errorRebuild: "Brzina rebilda mora biti veća od nule.",
  },

  "uptime-downtime": {
    mode: "Režim",
    modeFromUptime: "Iz procenta dostupnosti",
    modeFromDowntime: "Iz prekida u mesecu",
    uptime: "Dostupnost",
    monthlyDowntime: "Prekid u referentnom mesecu",
    periodNote: "Referentna godina je 365 dana, a mesec 30 dana.",
    results: "Rezultat",
    unavailable: "Nedostupnost",
    nines: "Broj devetki",
    perDay: "Prekid po danu",
    perWeek: "Prekid po nedelji",
    perMonth: "Prekid po mesecu",
    perYear: "Prekid po godini",
    perMonthSeconds: "Prekid po mesecu u sekundama",
    formulaLine: "prekid = (1 − dostupnost)·period     devetke = −log₁₀(1 − dostupnost)",
    inputs: "Uneseno",
    unitMinutes: "min",
    unitSeconds: "s",
    errorUptime: "Dostupnost je broj između 0 i 100.",
    errorUptimeHundred:
      "Dostupnost od tačno 100 % nema prekida i nema broj devetki — unesi vrednost manju od sto.",
    errorDowntime: "Prekid u mesecu mora biti broj veći od nule i manji od ukupnog broja minuta.",
  },

  "vlsm-split": {
    baseAddress: "Osnovna mreža",
    baseAddressHint: "Npr. 192.168.10.0. Adresa se svodi na mrežu po zadatom prefiksu.",
    prefix: "Prefiks osnovne mreže",
    hostCounts: "Potreban broj domaćina",
    hostCountsHint:
      "Jedan ceo broj po podmreži, odvojeni zarezom, tačkom i zarezom ili razmakom, npr. 100, 50, " +
      "20. Zarez je razdelnik, a ne decimalni znak. Redosled nije važan — alatka raspoređuje od " +
      "najveće podmreže.",
    results: "Rezultat",
    baseNetwork: "Mreža",
    baseBroadcast: "Adresa broadcasta",
    colRequested: "Traženo domaćina",
    colPrefix: "Prefiks",
    colNetwork: "Mreža",
    colFirst: "Prva adresa",
    colLast: "Poslednja adresa",
    colBroadcast: "Broadcast",
    colUsable: "Iskoristivo adresa",
    totalRequested: "Ukupno traženo domaćina",
    totalAllocated: "Ukupno dodeljeno adresa",
    freeAddresses: "Neiskorišćene adrese osnovne mreže",
    formulaLine: "prefiks = 32 − ceil(log₂(domaćini + 2))     blok = 2^(32 − prefiks)",
    unitHosts: "domaćina",
    errorAddress: "Adresa mora biti u obliku a.b.c.d, sa svakim delom od 0 do 255.",
    errorPrefix: "Prefiks je ceo broj od 0 do 30 — /31 i /32 nemaju adrese za domaćine.",
    errorCounts: "Unesi bar jedan broj domaćina, svaki ceo broj veći od nule.",
    errorDoesNotFit: "Podmreže ovih veličina ne staju u osnovnu mrežu.",
  },

  "mac-normalise": {
    address: "MAC adresa",
    addressHint:
      "Bilo koji uobičajen zapis: aa:bb:cc:dd:ee:ff, aa-bb-…, aabb.ccdd.eeff ili bez razdelnika.",
    results: "Rezultat",
    colon: "Zapis sa dvotačkama",
    dash: "Zapis sa crticama",
    dotted: "Cisco zapis",
    bare: "Bez razdelnika",
    oui: "OUI (proizvođač)",
    groupBit: "Prvi bit prvog okteta",
    adminBit: "Drugi bit prvog okteta",
    multicast: "Grupna adresa (multicast)",
    unicast: "Adresa jednog uređaja (unicast)",
    locallyAdministered: "Dodelio administrator, ne proizvođač",
    globallyAdministered: "Dodelio proizvođač",
    formulaLine: "I/G = bit 0 prvog okteta     U/L = bit 1 prvog okteta",
    errorAddress: "Adresa mora imati tačno šest bajtova u heksadecimalnom zapisu.",
  },
} as const;
