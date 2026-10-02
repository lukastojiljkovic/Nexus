/**
 * „Sistem i mreza" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 */
export const DEVTOOLS_SYSTEM_EN = {
  "http-status": {
    searchLabel: "Search",
    searchHint: "A number or part of a number (e.g. 4 or 404), or a word from the name/description.",
    codeHeading: "Code",
    nameHeading: "Name",
    classHeading: "Class",
    sourceHeading: "Source",
    noteHeading: "Description",
    unofficial: "unofficial",
    noMatches: "No HTTP status matches the search.",
  },

  "path-convert": {
    pathLabel: "Path",
    pathHint:
      "Recognises Windows, POSIX, WSL, UNC and file:// notation; surrounding quotes are stripped.",
    targetLabel: "Convert to",
    flavourLabel: {
      windows: "Windows",
      unix: "POSIX/Unix",
      wsl: "WSL",
      unc: "UNC (network path)",
      "file-url": "file:// URL",
    },
    recognizedAs: "Detected as",
    outputLabel: "Result",
    shellsTitle: "Shell quoting",
    shellLabel: {
      powershell: "PowerShell",
      cmd: "cmd.exe",
      posix: "POSIX (bash/zsh)",
    },
    cmdPercentWarning:
      "This path contains “%” — cmd.exe reads it as a variable BEFORE it strips quotes, so quotes do not help here.",
    refusal: {
      unparsable: "This is not a path in a form this tool recognises.",
      "drive-relative":
        "This is a path relative to the current drive (e.g. C:foo) — its meaning depends on the process's working directory, which this tool does not know.",
      "no-drive":
        "The target notation needs a drive letter, but the source path is not tied to any drive (e.g. it starts with /, like a POSIX path).",
      "no-host":
        "UNC notation needs a network host and share (\\\\host\\share), and the source path has neither.",
      "no-unix-root":
        "A drive letter or a network (UNC) part of the path has no POSIX equivalent — there is no directory that would stand for it.",
      "not-absolute": "file:// notation needs an absolute path, and this one is relative.",
      "illegal-windows-name":
        "Some part of the path contains a character or name Windows reads as reserved (e.g. “:”, “*” or a device name like CON) — not as part of a file name.",
    },
  },

  cidr: {
    blockTitle: "Block",
    blockLabel: "CIDR block",
    blockHint: "An address and prefix, e.g. 192.168.1.0/24 or 2001:db8::/32.",
    blockInvalid:
      "This is not valid CIDR notation — an address/prefix is expected, without shortened or octal-ambiguous octets.",
    family: "Family",
    familyIpv4: "IPv4",
    familyIpv6: "IPv6",
    address: "Address",
    prefix: "Prefix",
    network: "Network",
    broadcast: "Broadcast",
    broadcastNone: "none (/31, /32 or IPv6)",
    firstHost: "First host",
    lastHost: "Last host",
    total: "Total addresses",
    usable: "Usable by hosts",
    netmask: "Netmask",
    wildcard: "Wildcard mask",

    needsBlock: "First enter a valid CIDR block above.",

    containmentTitle: "Membership check",
    containmentLabel: "Address to check",
    containmentInvalid: "This is not a valid IP address.",
    containmentResultLabel: "Membership",
    containmentYes: "yes, it is in the block",
    containmentNo: "no, it is outside the block",

    splitTitle: "Subnetting",
    splitLabel: "Number of subnets",
    splitInvalid:
      "The number of subnets must be a power of two and may not exceed the address space available in this block.",
    splitHeadIndex: "#",
    splitHeadCidr: "Subnet",

    summaryTitle: "List aggregation",
    summaryLabel: "Blocks, one per line (or separated by a space/comma)",
    summaryInvalid: "At least one entry is not valid CIDR notation.",
    summaryMixed: "The blocks mix IPv4 and IPv6 — they have no common supernet.",
    summaryResult: "Smallest common block",
  },

  semver: {
    compareTitle: "Comparison",
    versionALabel: "Version A",
    versionBLabel: "Version B",
    invalid:
      "This is not a valid semantic version — major.minor.patch is expected, with an optional -prerelease and +build (semver.org).",
    versionACanonical: "Version A (canonical form)",
    versionBCanonical: "Version B (canonical form)",
    compareResultLabel: "Comparison",
    relationLess: "is less than",
    relationEqual: "is equal to",
    relationGreater: "is greater than",

    sortTitle: "Sorting and range check",
    listLabel: "A list of versions, one per line",
    listInvalidPrefix: "Line",
    listInvalidSuffix: "is not a valid semantic version.",
    sortedHeadIndex: "#",
    sortedHeadVersion: "Version",

    rangeTitle: "Range check",
    rangeLabel: "Range expression",
    rangeHint:
      "e.g. ^1.2.3, ~1.2.0, >=1.0.0 <2.0.0, or 1.2.3 - 2.0.0 (npm's semver range).",
    rangeInvalid: "This is not a valid range expression.",
    candidateLabel: "Version to check",
    satisfiesResultLabel: "Satisfies the range",
    satisfiesYes: "yes",
    satisfiesNo: "no",
    maxSatisfyingLabel: "Highest version in the list that satisfies the range",
    maxSatisfyingNone: "No version in the list satisfies this range.",
  },

  qr: {
    modeLabel: "Content kind",
    modeName: {
      text: "Text",
      url: "Link (URL)",
      wifi: "Wi-Fi network",
      mailto: "Email",
      tel: "Phone",
      sms: "SMS",
      geo: "Location",
      vcard: "Contact (vCard)",
    },
    ecLabel: "Error correction level",
    ecHint: "A higher level tolerates more symbol damage but makes a denser code.",
    ecName: {
      L: "L — low (~7% correction)",
      M: "M — medium",
      Q: "Q — high",
      H: "H — highest (~30% correction)",
    },

    textLabel: "Text",

    urlLabel: "URL",

    ssidLabel: "Network name (SSID)",
    securityLabel: "Security",
    securityWpa: "WPA/WPA2",
    securityWep: "WEP",
    securityOpen: "no security (open)",
    passwordLabel: "Password",
    hiddenLabel: "The network does not broadcast its SSID (hidden)",

    mailToLabel: "Recipient address",
    mailSubjectLabel: "Subject (optional)",
    mailBodyLabel: "Message text (optional)",

    telLabel: "Phone number",
    telHint: "Digits, spaces, +, brackets, hyphen and dot; at least three digits.",

    smsMessageLabel: "Message (optional)",

    latLabel: "Latitude",
    latHint: "Between -90 and 90.",
    lngLabel: "Longitude",
    lngHint: "Between -180 and 180.",
    altLabel: "Altitude (optional)",
    altHint: "In metres.",

    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    orgLabel: "Organisation",
    jobTitleLabel: "Title",
    phoneLabel: "Phone",
    workPhoneLabel: "Phone (work)",
    emailLabel: "Email",
    websiteLabel: "Website",
    addressTitle: "Address",
    streetLabel: "Street and number",
    cityLabel: "City",
    regionLabel: "Province/county",
    postalLabel: "Postal code",
    countryLabel: "Country",
    noteLabel: "Note",

    svgLabel: "QR code (SVG to copy)",
    tooLarge:
      "The content is too large for a QR code at the chosen error correction level — try shorter text or a lower level (L or M).",
    refusal: {
      text: "Enter text for the QR code.",
      url: "Must start with http:// or https://, on one line, without spaces.",
      wifi:
        "The network name (SSID) must fit on one line; the password is required unless the network is open, and it must fit on one line too.",
      mailto: "The address is not a valid email (name@domain form).",
      tel: "The number must have at least three digits, and contain only digits, spaces, +, ( ), - and dot.",
      sms:
        "Check the number (at least three digits, only digits, spaces, +, ( ), - and dot) and the message (no control characters).",
      geo:
        "Latitude must be a number between -90 and 90, longitude between -180 and 180, and altitude, if entered, must be a number.",
      vcard:
        "Enter at least a first or last name; the email, if entered, must be valid; and no field may contain control characters.",
    },
    versionResultLabel: "Version",
    ecResultLabel: "Correction level",
    sizeResultLabel: "Size (modules)",
  },
} as const;
