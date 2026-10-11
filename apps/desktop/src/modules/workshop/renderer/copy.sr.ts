/**
 * RADIONICA's own copy, in Serbian - the SHAPE every other locale of this module
 * is checked against (ADR-090).
 *
 * The three viewers share one table because they share one page: what differs
 * between them is the file, not the errand, and three tables would be three
 * places to keep the same words about opening, reading and refusing a file.
 *
 * The layer names are keyed by `GerberRole`, which is `@nexus/core`'s union: a
 * role added there is a compile error here rather than a raw id on screen.
 */
export const sr = {
  page: {
    subtitle: "Model, putanja i ploča — pregled bez ijednog dodatnog programa.",
    loading: "Učitavanje…",
  },
  targets: {
    model: "Model",
    toolpath: "G-kod",
    board: "Gerber",
  },
  /** The two tool sets, as the switcher's own segments read them. */
  views: {
    pdf: "PDF",
    images: "Slike",
  },
  open: {
    model: "Otvori STL",
    toolpath: "Otvori G-kod",
    board: "Otvori Gerber",
    /** For a file whose path the session still holds: no dialog, one click. */
    again: "Otvori ponovo",
    busy: "Otvori drugu datoteku",
  },
  empty: {
    modelTitle: "Nijedan model nije otvoren",
    modelBody: "Otvori STL datoteku da vidiš oblik, granice u milimetrima, zapreminu i površinu.",
    toolpathTitle: "Nijedna putanja nije otvorena",
    toolpathBody:
      "Otvori G-kod datoteku da vidiš slojeve, dužinu putanje, filament i procenu vremena.",
    boardTitle: "Nijedna ploča nije otvorena",
    boardBody:
      "Otvori Gerber i Excellon datoteke jednog kola — slojevi se slažu na istu ploču, pa možeš birati koji se vide.",
  },
  model: {
    format: "Zapis",
    formatBinary: "binarni",
    formatAscii: "ASCII",
    triangles: "Trouglova",
    bounds: "Granice",
    volume: "Zapremina",
    area: "Površina",
    wireframe: "Mreža",
    closedNote: "Mreža je zatvorena, pa je zapremina tačna za ovaj model.",
    openNote: "Mreža nije zatvorena — zapremina je tada samo orijentir, ne mera.",
    unitsNote: "STL ne nosi jedinicu; sve mere se čitaju kao milimetri.",
    reading: "Čitam model…",
    readError:
      "Datoteka je otvorena, ali nije STL koji ovaj pregled može da pročita. Proveri da je u pitanju STL.",
  },
  toolpath: {
    layers: "Slojeva",
    layer: "Sloj",
    zHeight: "Visina sloja",
    extruding: "Štampa",
    travel: "Prazan hod",
    filament: "Filament",
    time: "Procena vremena",
    timeNote:
      "Procena je zbir pređenog puta podeljen zadatim brzinama (F). Slicer pokaže duže vreme jer računa i ubrzavanje, usporavanje i kratke poteze na kojima se zadata brzina ne postigne.",
    showingAll: "svi slojevi",
    units: "Jedinice",
    unitsInch: "inči (G20)",
    reading: "Čitam putanju…",
    readError:
      "Datoteka je otvorena, ali u njoj nema nijedne putanje koju ovaj pregled crta. Proveri da je u pitanju G-kod.",
    warnings: {
      title: "Napomene o datoteci",
      "missing-feed": "Neke putanje nemaju zadatu brzinu (F), pa im vreme nije uračunato.",
      "arc-without-centre": "Luk bez središta (I/J ili R) je nacrtan kao prava do svoje krajnje tačke.",
      "arc-radius-too-small": "Poluprečnik luka ne stiže od početka do kraja, pa je luk nacrtan kao prava.",
      "segments-capped": "Putanja ima više od dva miliona segmenata; nacrtan je početak.",
    },
  },
  board: {
    layers: "Slojeva",
    size: "Veličina ploče",
    fromOutline: "iz konture",
    fromLayers: "iz otvorenih slojeva",
    flip: "Okreni ploču",
    flipOn: "Odozdo",
    flipOff: "Odozgo",
  },
  layers: {
    "copper-top": "Bakar, gornji",
    "copper-bottom": "Bakar, donji",
    "copper-inner": "Unutrašnji bakar",
    "mask-top": "Zaštitni sloj, gornji",
    "mask-bottom": "Zaštitni sloj, donji",
    "silk-top": "Sitotisak, gornji",
    "silk-bottom": "Sitotisak, donji",
    "paste-top": "Pasta, gornja",
    "paste-bottom": "Pasta, donja",
    outline: "Kontura ploče",
    drill: "Bušenje",
    other: "Ostalo",
  },
  problems: {
    unreadable: "Datoteka ne može da se pročita.",
    "not-a-file": "Ovaj unos nije datoteka.",
    "too-large": "Datoteka je veća nego što ovaj pregled čita (32 MB za STL i G-kod, 8 MB za sloj ploče).",
    "not-gerber": "Ovo nije Gerber ili Excellon koji se može prikazati.",
    "not-in-this-session": "Datoteka je iz prethodne sesije; otvori je kroz dijalog.",
    "too-many-files": "Odjednom je izabrano više slojeva nego što jedna ploča ima (16).",
  },
  errors: {
    load: "Datoteka nije otvorena. Pokušaj ponovo.",
    read: "Čitanje datoteke nije uspelo. Otvori je ponovo.",
  },
  view: {
    fit: "Uklopi u prikaz",
  },
  recent: {
    title: "Nedavno otvorene datoteke",
    empty: "Još nema otvorenih datoteka.",
    caption: "Samo putanje, nikad sadržaj. Lista je na ovom računaru.",
    forget: "Zaboravi listu",
  },
  settings: {
    caption: "Radionica ne pamti sadržaj datoteka koje otvoriš.",
  },
  /** The words a duration is read in. „mm", „mm²" and „mm³" are the same in both languages and stay at their call sites. */
  units: {
    hour: "č",
    minute: "min",
    second: "s",
  },
};
