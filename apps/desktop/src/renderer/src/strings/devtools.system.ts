/**
 * „Sistem i mreza" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 */
export const DEVTOOLS_SYSTEM_SR = {
  "http-status": {
    searchLabel: "Pretraga",
    searchHint: "Broj ili deo broja (npr. 4 ili 404), ili reč iz naziva/objašnjenja.",
    codeHeading: "Kod",
    nameHeading: "Naziv",
    classHeading: "Klasa",
    sourceHeading: "Izvor",
    noteHeading: "Objašnjenje",
    unofficial: "nezvanično",
    noMatches: "Nijedan HTTP status ne odgovara pretrazi.",
  },

  "path-convert": {
    pathLabel: "Putanja",
    pathHint:
      "Prepoznaje Windows, POSIX, WSL, UNC i file:// zapise; okružujući navodnici " +
      "se uklanjaju.",
    targetLabel: "Pretvori u",
    flavourLabel: {
      windows: "Windows",
      unix: "POSIX/Unix",
      wsl: "WSL",
      unc: "UNC (mrežni put)",
      "file-url": "file:// URL",
    },
    recognizedAs: "Prepoznato kao",
    outputLabel: "Rezultat",
    shellsTitle: "Navođenje za ljuske",
    shellLabel: {
      powershell: "PowerShell",
      cmd: "cmd.exe",
      posix: "POSIX (bash/zsh)",
    },
    cmdPercentWarning:
      "Ova putanja sadrži znak „%“ — cmd.exe ga čita kao promenljivu PRE nego što " +
      "ukloni navodnike, pa navodnici ovde ne pomažu.",
    refusal: {
      unparsable: "Ovo nije putanja u obliku koji ova alatka prepoznaje.",
      "drive-relative":
        "Ovo je putanja relativna na trenutni disk (npr. C:foo) — njeno značenje " +
        "zavisi od radnog direktorijuma procesa, koji ova alatka ne zna.",
      "no-drive":
        "Ciljani zapis zahteva slovo diska, a izvorna putanja nije vezana ni za " +
        "jedan disk (npr. počinje sa /, kao POSIX putanja).",
      "no-host":
        "UNC zapis zahteva mrežni host i deljeni resurs (\\\\host\\deo), a " +
        "izvorna putanja ih nema.",
      "no-unix-root":
        "Slovo diska ili mrežni (UNC) deo putanje nema POSIX ekvivalent — ne " +
        "postoji direktorijum koji bi ga predstavio.",
      "not-absolute": "file:// zapis zahteva apsolutnu putanju, a ova je relativna.",
      "illegal-windows-name":
        "Neki deo putanje sadrži znak ili ime koje Windows čita kao rezervisano " +
        "(npr. „:“, „*“ ili ime uređaja poput CON) — ne kao deo imena fajla.",
    },
  },

  cidr: {
    blockTitle: "Blok",
    blockLabel: "CIDR blok",
    blockHint: "Adresa i prefiks, npr. 192.168.1.0/24 ili 2001:db8::/32.",
    blockInvalid:
      "Ovo nije ispravan CIDR zapis — očekuje se adresa/prefiks, bez skraćenih " +
      "ili oktalno-dvosmislenih okteta.",
    family: "Porodica",
    familyIpv4: "IPv4",
    familyIpv6: "IPv6",
    address: "Adresa",
    prefix: "Prefiks",
    network: "Mreža",
    broadcast: "Broadcast",
    broadcastNone: "nema (/31, /32 ili IPv6)",
    firstHost: "Prvi domaćin",
    lastHost: "Poslednji domaćin",
    total: "Ukupno adresa",
    usable: "Upotrebljivo domaćinima",
    netmask: "Maska mreže",
    wildcard: "Wildcard maska",

    needsBlock: "Prvo unesi ispravan CIDR blok gore.",

    containmentTitle: "Provera pripadnosti",
    containmentLabel: "Adresa za proveru",
    containmentInvalid: "Ovo nije ispravna IP adresa.",
    containmentResultLabel: "Pripadnost",
    containmentYes: "da, u bloku je",
    containmentNo: "ne, van bloka je",

    splitTitle: "Podela na podmreže",
    splitLabel: "Broj podmreža",
    splitInvalid:
      "Broj podmreža mora biti stepen dvojke i ne sme premašiti raspoloživ " +
      "adresni prostor ovog bloka.",
    splitHeadIndex: "#",
    splitHeadCidr: "Podmreža",

    summaryTitle: "Sažimanje liste",
    summaryLabel: "Blokovi, jedan po redu (ili razdvojeni razmakom/zarezom)",
    summaryInvalid: "Bar jedan unos nije ispravan CIDR zapis.",
    summaryMixed: "Blokovi mešaju IPv4 i IPv6 — nemaju zajednički nadskup.",
    summaryResult: "Najmanji zajednički blok",
  },

  semver: {
    compareTitle: "Poređenje",
    versionALabel: "Verzija A",
    versionBLabel: "Verzija B",
    invalid:
      "Ovo nije ispravna semantička verzija — očekuje se major.minor.patch, uz " +
      "opcioni -prerelease i +build (semver.org).",
    versionACanonical: "Verzija A (kanonski oblik)",
    versionBCanonical: "Verzija B (kanonski oblik)",
    compareResultLabel: "Poređenje",
    relationLess: "je manja od",
    relationEqual: "je jednaka sa",
    relationGreater: "je veća od",

    sortTitle: "Sortiranje i provera opsega",
    listLabel: "Lista verzija, jedna po redu",
    listInvalidPrefix: "Red",
    listInvalidSuffix: "nije ispravna semantička verzija.",
    sortedHeadIndex: "#",
    sortedHeadVersion: "Verzija",

    rangeTitle: "Provera opsega",
    rangeLabel: "Izraz opsega",
    rangeHint:
      "npr. ^1.2.3, ~1.2.0, >=1.0.0 <2.0.0, ili 1.2.3 - 2.0.0 (npm-ov semver " +
      "opseg).",
    rangeInvalid: "Ovo nije ispravan izraz opsega.",
    candidateLabel: "Verzija za proveru",
    satisfiesResultLabel: "Zadovoljava opseg",
    satisfiesYes: "da",
    satisfiesNo: "ne",
    maxSatisfyingLabel: "Najviša verzija iz liste koja zadovoljava opseg",
    maxSatisfyingNone: "Nijedna verzija iz liste ne zadovoljava ovaj opseg.",
  },

  qr: {
    modeLabel: "Vrsta sadržaja",
    modeName: {
      text: "Tekst",
      url: "Veza (URL)",
      wifi: "Wi-Fi mreža",
      mailto: "E-pošta",
      tel: "Telefon",
      sms: "SMS",
      geo: "Lokacija",
      vcard: "Kontakt (vCard)",
    },
    ecLabel: "Nivo ispravke grešaka",
    ecHint: "Viši nivo podnosi više oštećenja simbola, ali pravi gušći kod.",
    ecName: {
      L: "L — nizak (~7% ispravki)",
      M: "M — srednji",
      Q: "Q — visok",
      H: "H — najviši (~30% ispravki)",
    },

    textLabel: "Tekst",

    urlLabel: "URL",

    ssidLabel: "Ime mreže (SSID)",
    securityLabel: "Zaštita",
    securityWpa: "WPA/WPA2",
    securityWep: "WEP",
    securityOpen: "bez zaštite (otvorena)",
    passwordLabel: "Lozinka",
    hiddenLabel: "Mreža ne emituje SSID (sakrivena)",

    mailToLabel: "Adresa primaoca",
    mailSubjectLabel: "Naslov (opciono)",
    mailBodyLabel: "Tekst poruke (opciono)",

    telLabel: "Broj telefona",
    telHint: "Cifre, razmaci, +, zagrade, crtica i tačka; najmanje tri cifre.",

    smsMessageLabel: "Poruka (opciono)",

    latLabel: "Geografska širina",
    latHint: "Između -90 i 90.",
    lngLabel: "Geografska dužina",
    lngHint: "Između -180 i 180.",
    altLabel: "Nadmorska visina (opciono)",
    altHint: "U metrima.",

    firstNameLabel: "Ime",
    lastNameLabel: "Prezime",
    orgLabel: "Organizacija",
    jobTitleLabel: "Zvanje",
    phoneLabel: "Telefon",
    workPhoneLabel: "Telefon (posao)",
    emailLabel: "E-pošta",
    websiteLabel: "Veb-sajt",
    addressTitle: "Adresa",
    streetLabel: "Ulica i broj",
    cityLabel: "Grad",
    regionLabel: "Pokrajina/okrug",
    postalLabel: "Poštanski broj",
    countryLabel: "Država",
    noteLabel: "Beleška",

    svgLabel: "QR kod (SVG za kopiranje)",
    tooLarge:
      "Sadržaj je prevelik za QR kod na izabranom nivou ispravke grešaka — " +
      "probaj kraći tekst ili niži nivo (L ili M).",
    refusal: {
      text: "Upiši tekst za QR kod.",
      url: "Mora početi sa http:// ili https://, u jednom redu, bez razmaka.",
      wifi:
        "Ime mreže (SSID) mora stati u jedan red; lozinka je obavezna osim za " +
        "mrežu bez zaštite, i takođe mora stati u jedan red.",
      mailto: "Adresa nije ispravna e-pošta (oblik ime@domen).",
      tel: "Broj mora imati bar tri cifre, i sadržati samo cifre, razmake, +, ( ), - i tačku.",
      sms:
        "Proveri broj (bar tri cifre, samo cifre, razmaci, +, ( ), - i tačka) " +
        "i poruku (bez kontrolnih znakova).",
      geo:
        "Geografska širina mora biti broj između -90 i 90, dužina između -180 " +
        "i 180, a visina, ako je uneta, mora biti broj.",
      vcard:
        "Unesi bar ime ili prezime; e-pošta, ako je uneta, mora biti ispravna; " +
        "nijedno polje ne sme sadržati kontrolne znakove.",
    },
    versionResultLabel: "Verzija",
    ecResultLabel: "Nivo ispravke",
    sizeResultLabel: "Veličina (moduli)",
  },
} as const;
