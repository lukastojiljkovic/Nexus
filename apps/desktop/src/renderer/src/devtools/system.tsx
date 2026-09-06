import {
  cidrBlockOf,
  cidrContains,
  cmdExpandsPath,
  compareSemver,
  convertPath,
  describeCidr,
  formatCidr,
  formatSemver,
  maxSatisfyingSemver,
  parseCidr,
  parseCidrList,
  parseIp,
  parsePath,
  parseSemver,
  parseSemverRange,
  quotePath,
  satisfiesSemver,
  searchHttpStatuses,
  sortSemvers,
  splitCidr,
  summariseCidrs,
  PATH_FLAVOURS,
  PATH_SHELLS,
  type PathFlavour,
  type SemVer,
} from "@nexus/core/devtools/system";
import {
  encodeQr,
  qrGeoPayload,
  qrMailtoPayload,
  qrPlainText,
  qrSmsPayload,
  qrTelPayload,
  qrToSvg,
  qrUrlPayload,
  qrVCardPayload,
  qrWifiPayload,
  QR_EC_LEVELS,
  type QrEcLevel,
  type QrWifiSecurity,
} from "@nexus/core/devtools/qr";
import { parseToolNumber } from "@nexus/core";
import { Button, Checkbox } from "@nexus/ui";
import { useMemo, useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import {
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "../pro/shared.js";

/**
 * „Sistem i mreza" — the 5 surfaces of this group of the developer drawer: an
 * HTTP status registry, a path-flavour converter, CIDR arithmetic, semantic
 * version comparison and a QR code generator. All parsing, arithmetic and the
 * QR encoding itself are `@nexus/core/devtools/system.ts` and `…/qr.ts`'s —
 * nothing here repairs an input or reimplements a rule; a surface either
 * shows the module's answer or, when the module refuses, names why in
 * Serbian.
 *
 * **The QR preview is the one place this file injects raw markup.**
 * `qrToSvg` escapes every colour and its optional `<title>` through its own
 * `escapeXml`, and the path data it emits (`qrToSvgPath`) holds only integer
 * module coordinates — verified by reading `packages/core/src/devtools/qr.ts`
 * before writing the `dangerouslySetInnerHTML` below. The two colours are
 * always the app's own tokens (`var(--nx-text)` / `var(--nx-bg)`), never a
 * literal — the QR surface is handed no colour picker at all.
 *
 * **CIDR splitting reads from a `ToolSelect` of powers of two, not a
 * free-typed count.** `splitCidr` already refuses anything that is not one,
 * but a control that can only ever HOLD a valid choice needs no refusal state
 * of its own to draw.
 */

function HttpStatusTool() {
  const s = strings.devtools.system["http-status"];
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchHttpStatuses(query), [query]);

  return (
    <>
      <ToolInput label={s.searchLabel} value={query} onChange={setQuery} hint={s.searchHint} />
      {results.length === 0 ? (
        <ToolFailure>{s.noMatches}</ToolFailure>
      ) : (
        <ToolTable
          head={[s.codeHeading, s.nameHeading, s.classHeading, s.sourceHeading, s.noteHeading]}
          // „Naziv" as well as „Objašnjenje": the audit still found this table
          // 212 px past its pane with only the explanation wrapping, and 212 px
          // is almost exactly „Request Header Fields Too Large" set on one
          // unbreakable line. An English status phrase is a sentence, not a hex
          // word — only the code and the class are machine text here.
          prose={[1, 4]}
          rows={results.map((entry) => [
            String(entry.code),
            entry.official ? entry.name : `${entry.name} (${s.unofficial})`,
            entry.statusClass,
            entry.reference,
            entry.noteSr,
          ])}
        />
      )}
    </>
  );
}

function PathConvertTool() {
  const s = strings.devtools.system["path-convert"];
  const c = strings.pro.common;
  const [text, setText] = useState("");
  const [target, setTarget] = useState<PathFlavour>("wsl");

  const parsed = useMemo(() => parsePath(text), [text]);
  const converted = useMemo(() => convertPath(text, target), [text, target]);
  const typed = text.trim() !== "";

  const flavourOptions = PATH_FLAVOURS.map((flavour) => ({
    id: flavour,
    label: s.flavourLabel[flavour],
  }));

  return (
    <>
      <ToolInput label={s.pathLabel} value={text} onChange={setText} mono hint={s.pathHint} />
      <ToolSelect
        label={s.targetLabel}
        value={target}
        options={flavourOptions}
        onChange={setTarget}
      />
      {!typed ? (
        <ToolOutput label={s.outputLabel} value="" empty={c.awaitingInput} />
      ) : !converted.ok ? (
        <ToolFailure>{s.refusal[converted.reason]}</ToolFailure>
      ) : (
        <>
          {parsed !== null && (
            <ResultRow
              label={s.recognizedAs}
              value={s.flavourLabel[parsed.flavour]}
              mono={false}
            />
          )}
          <ToolOutput label={s.outputLabel} value={converted.path} />
          <ToolSection title={s.shellsTitle}>
            <div className="tool__results">
              {PATH_SHELLS.map((shell) => (
                <ResultRow
                  key={shell}
                  label={s.shellLabel[shell]}
                  value={quotePath(converted.path, shell)}
                />
              ))}
            </div>
            {cmdExpandsPath(converted.path) && (
              <p className="nx-hint nx-hint--prose">{s.cmdPercentWarning}</p>
            )}
          </ToolSection>
        </>
      )}
    </>
  );
}

/** Split counts a `ToolSelect` can offer without ever needing a refusal for the count itself. */
const CIDR_SPLIT_PARTS = [2, 4, 8, 16, 32, 64, 128, 256] as const;

function CidrTool() {
  const s = strings.devtools.system.cidr;

  const [blockText, setBlockText] = useState("");
  const cidrInput = useMemo(() => parseCidr(blockText), [blockText]);
  const report = useMemo(
    () => (cidrInput === null ? null : describeCidr(cidrInput)),
    [cidrInput],
  );
  const block = useMemo(
    () => (cidrInput === null ? null : cidrBlockOf(cidrInput)),
    [cidrInput],
  );
  const typedBlock = blockText.trim() !== "";

  const [addressText, setAddressText] = useState("");
  const address = useMemo(() => parseIp(addressText), [addressText]);
  const typedAddress = addressText.trim() !== "";
  const contains = block !== null && address !== null ? cidrContains(block, address) : null;

  const [partsId, setPartsId] = useState("4");
  const subnets = useMemo(
    () => (block === null ? null : splitCidr(block, Number(partsId))),
    [block, partsId],
  );
  const partsOptions = CIDR_SPLIT_PARTS.map((parts) => ({
    id: String(parts),
    label: String(parts),
  }));

  const [listText, setListText] = useState("");
  const list = useMemo(() => parseCidrList(listText), [listText]);
  const summary = useMemo(() => (list === null ? null : summariseCidrs(list)), [list]);
  const typedList = listText.trim() !== "";

  return (
    <>
      <ToolSection title={s.blockTitle}>
        <ToolInput
          label={s.blockLabel}
          value={blockText}
          onChange={setBlockText}
          mono
          hint={s.blockHint}
        />
        {!typedBlock ? null : report === null ? (
          <ToolFailure>{s.blockInvalid}</ToolFailure>
        ) : (
          <div className="tool__results">
            <ResultRow
              label={s.family}
              value={report.family === "ipv4" ? s.familyIpv4 : s.familyIpv6}
              mono={false}
            />
            <ResultRow label={s.address} value={report.address} />
            <ResultRow label={s.prefix} value={`/${report.prefix}`} />
            <ResultRow label={s.network} value={report.network} />
            <ResultRow label={s.broadcast} value={report.broadcast ?? s.broadcastNone} />
            <ResultRow label={s.firstHost} value={report.firstHost} />
            <ResultRow label={s.lastHost} value={report.lastHost} />
            <ResultRow label={s.total} value={report.total.toString()} />
            <ResultRow label={s.usable} value={report.usable.toString()} />
            <ResultRow label={s.netmask} value={report.netmask} />
            <ResultRow label={s.wildcard} value={report.wildcard} />
          </div>
        )}
      </ToolSection>

      <ToolSection title={s.containmentTitle}>
        <ToolInput label={s.containmentLabel} value={addressText} onChange={setAddressText} mono />
        {block === null ? (
          <p className="nx-hint nx-hint--prose">{s.needsBlock}</p>
        ) : !typedAddress ? null : address === null ? (
          <ToolFailure>{s.containmentInvalid}</ToolFailure>
        ) : (
          <ResultRow
            label={s.containmentResultLabel}
            value={contains === true ? s.containmentYes : s.containmentNo}
            mono={false}
          />
        )}
      </ToolSection>

      <ToolSection title={s.splitTitle}>
        <ToolSelect
          label={s.splitLabel}
          value={partsId}
          options={partsOptions}
          onChange={setPartsId}
        />
        {block === null ? (
          <p className="nx-hint nx-hint--prose">{s.needsBlock}</p>
        ) : subnets === null ? (
          <ToolFailure>{s.splitInvalid}</ToolFailure>
        ) : (
          <ToolTable
            head={[s.splitHeadIndex, s.splitHeadCidr]}
            rows={subnets.map((sub, index) => [String(index + 1), formatCidr(sub)])}
          />
        )}
      </ToolSection>

      <ToolSection title={s.summaryTitle}>
        <ToolTextArea label={s.summaryLabel} value={listText} onChange={setListText} rows={4} />
        {!typedList ? null : list === null ? (
          <ToolFailure>{s.summaryInvalid}</ToolFailure>
        ) : summary === null ? (
          <ToolFailure>{s.summaryMixed}</ToolFailure>
        ) : (
          <ToolOutput label={s.summaryResult} value={formatCidr(summary)} />
        )}
      </ToolSection>
    </>
  );
}

function SemverTool() {
  const s = strings.devtools.system.semver;

  const [versionAText, setVersionAText] = useState("");
  const [versionBText, setVersionBText] = useState("");
  const versionA = useMemo(() => parseSemver(versionAText), [versionAText]);
  const versionB = useMemo(() => parseSemver(versionBText), [versionBText]);
  const typedCompare = versionAText.trim() !== "" || versionBText.trim() !== "";
  const compareInvalid = typedCompare && (versionA === null || versionB === null);

  const [listText, setListText] = useState("");
  const lines = useMemo(
    () =>
      listText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    [listText],
  );
  const parsedLines = useMemo(
    () => lines.map((line) => ({ line, version: parseSemver(line) })),
    [lines],
  );
  const badLine = parsedLines.find((entry) => entry.version === null)?.line;
  const sorted = useMemo(
    () =>
      badLine !== undefined
        ? null
        : sortSemvers(
            parsedLines
              .map((entry) => entry.version)
              .filter((version): version is SemVer => version !== null),
          ),
    [parsedLines, badLine],
  );
  const typedList = lines.length > 0;

  const [rangeText, setRangeText] = useState("");
  const range = useMemo(() => parseSemverRange(rangeText), [rangeText]);
  const typedRange = rangeText.trim() !== "";

  const [candidateText, setCandidateText] = useState("");
  const candidate = useMemo(() => parseSemver(candidateText), [candidateText]);
  const typedCandidate = candidateText.trim() !== "";

  const maxSatisfying = useMemo(
    () => (range === null || sorted === null ? null : maxSatisfyingSemver(sorted, range)),
    [range, sorted],
  );
  const hasCandidateRow = typedCandidate && candidate !== null && range !== null;
  const hasMaxRow = sorted !== null && range !== null;

  return (
    <>
      <ToolSection title={s.compareTitle}>
        <div className="tool__pair">
          <ToolInput label={s.versionALabel} value={versionAText} onChange={setVersionAText} mono />
          <ToolInput label={s.versionBLabel} value={versionBText} onChange={setVersionBText} mono />
        </div>
        {!typedCompare ? null : compareInvalid ? (
          <ToolFailure>{s.invalid}</ToolFailure>
        ) : versionA === null || versionB === null ? null : (
          <div className="tool__results">
            <ResultRow label={s.versionACanonical} value={formatSemver(versionA)} />
            <ResultRow label={s.versionBCanonical} value={formatSemver(versionB)} />
            <ResultRow
              label={s.compareResultLabel}
              value={
                compareSemver(versionA, versionB) < 0
                  ? s.relationLess
                  : compareSemver(versionA, versionB) > 0
                    ? s.relationGreater
                    : s.relationEqual
              }
              mono={false}
            />
          </div>
        )}
      </ToolSection>

      <ToolSection title={s.sortTitle}>
        <ToolTextArea label={s.listLabel} value={listText} onChange={setListText} rows={5} />
        {!typedList ? null : badLine !== undefined ? (
          <ToolFailure>
            {s.listInvalidPrefix} „{badLine}“ {s.listInvalidSuffix}
          </ToolFailure>
        ) : sorted === null ? null : (
          <ToolTable
            head={[s.sortedHeadIndex, s.sortedHeadVersion]}
            rows={sorted.map((version, index) => [String(index + 1), formatSemver(version)])}
          />
        )}
      </ToolSection>

      <ToolSection title={s.rangeTitle}>
        <ToolInput
          label={s.rangeLabel}
          value={rangeText}
          onChange={setRangeText}
          mono
          hint={s.rangeHint}
        />
        <ToolInput
          label={s.candidateLabel}
          value={candidateText}
          onChange={setCandidateText}
          mono
        />
        {!typedRange ? null : range === null ? (
          <ToolFailure>{s.rangeInvalid}</ToolFailure>
        ) : typedCandidate && candidate === null ? (
          <ToolFailure>{s.invalid}</ToolFailure>
        ) : !hasCandidateRow && !hasMaxRow ? null : (
          <div className="tool__results">
            {hasCandidateRow && candidate !== null && (
              <ResultRow
                label={s.satisfiesResultLabel}
                value={satisfiesSemver(candidate, range) ? s.satisfiesYes : s.satisfiesNo}
                mono={false}
              />
            )}
            {hasMaxRow && sorted !== null && (
              <ResultRow
                label={s.maxSatisfyingLabel}
                value={
                  maxSatisfying !== null ? formatSemver(maxSatisfying) : s.maxSatisfyingNone
                }
              />
            )}
          </div>
        )}
      </ToolSection>
    </>
  );
}

/** One vCard draft, held as one object so fourteen fields share one `onChange` shape. */
interface VCardDraft {
  readonly first: string;
  readonly last: string;
  readonly org: string;
  readonly title: string;
  readonly phone: string;
  readonly workPhone: string;
  readonly email: string;
  readonly url: string;
  readonly street: string;
  readonly city: string;
  readonly region: string;
  readonly postal: string;
  readonly country: string;
  readonly note: string;
}

const EMPTY_VCARD: VCardDraft = {
  first: "",
  last: "",
  org: "",
  title: "",
  phone: "",
  workPhone: "",
  email: "",
  url: "",
  street: "",
  city: "",
  region: "",
  postal: "",
  country: "",
  note: "",
};

function vCardTouched(draft: VCardDraft): boolean {
  return Object.values(draft).some((value) => value !== "");
}

function buildVCardPayload(draft: VCardDraft): string | null {
  const hasAddress = [draft.street, draft.city, draft.region, draft.postal, draft.country].some(
    (value) => value !== "",
  );
  return qrVCardPayload({
    ...(draft.first === "" ? {} : { firstName: draft.first }),
    ...(draft.last === "" ? {} : { lastName: draft.last }),
    ...(draft.org === "" ? {} : { organization: draft.org }),
    ...(draft.title === "" ? {} : { jobTitle: draft.title }),
    ...(draft.phone === "" ? {} : { phone: draft.phone }),
    ...(draft.workPhone === "" ? {} : { workPhone: draft.workPhone }),
    ...(draft.email === "" ? {} : { email: draft.email }),
    ...(draft.url === "" ? {} : { url: draft.url }),
    ...(hasAddress
      ? {
          address: {
            ...(draft.street === "" ? {} : { street: draft.street }),
            ...(draft.city === "" ? {} : { city: draft.city }),
            ...(draft.region === "" ? {} : { region: draft.region }),
            ...(draft.postal === "" ? {} : { postalCode: draft.postal }),
            ...(draft.country === "" ? {} : { country: draft.country }),
          },
        }
      : {}),
    ...(draft.note === "" ? {} : { note: draft.note }),
  });
}

function buildWifiPayload(
  ssid: string,
  security: QrWifiSecurity,
  password: string,
  hidden: boolean,
): string | null {
  return qrWifiPayload({
    ssid,
    security,
    ...(password === "" ? {} : { password }),
    ...(hidden ? { hidden: true } : {}),
  });
}

function buildMailtoPayload(to: string, subject: string, body: string): string | null {
  return qrMailtoPayload({
    to,
    ...(subject === "" ? {} : { subject }),
    ...(body === "" ? {} : { body }),
  });
}

function buildSmsPayload(number: string, message: string): string | null {
  return qrSmsPayload({ number, ...(message === "" ? {} : { message }) });
}

function buildGeoPayload(latText: string, lngText: string, altText: string): string | null {
  const latitude = parseToolNumber(latText);
  const longitude = parseToolNumber(lngText);
  if (latitude === null || longitude === null) return null;
  let altitude: number | undefined;
  if (altText.trim() !== "") {
    const parsedAlt = parseToolNumber(altText);
    if (parsedAlt === null) return null;
    altitude = parsedAlt;
  }
  return qrGeoPayload({ latitude, longitude, ...(altitude === undefined ? {} : { altitude }) });
}

type QrPayloadKind = "text" | "url" | "wifi" | "mailto" | "tel" | "sms" | "geo" | "vcard";

const QR_PAYLOAD_KINDS: readonly QrPayloadKind[] = [
  "text",
  "url",
  "wifi",
  "mailto",
  "tel",
  "sms",
  "geo",
  "vcard",
];

function QrTool() {
  const s = strings.devtools.system.qr;
  const c = strings.pro.common;

  const [mode, setMode] = useState<QrPayloadKind>("text");
  const [ecLevel, setEcLevel] = useState<QrEcLevel>("M");

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const [ssid, setSsid] = useState("");
  const [wifiSecurity, setWifiSecurity] = useState<QrWifiSecurity>("WPA");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiHidden, setWifiHidden] = useState(false);

  const [mailTo, setMailTo] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");

  const [telNumber, setTelNumber] = useState("");

  const [smsNumber, setSmsNumber] = useState("");
  const [smsMessage, setSmsMessage] = useState("");

  const [geoLat, setGeoLat] = useState("");
  const [geoLng, setGeoLng] = useState("");
  const [geoAlt, setGeoAlt] = useState("");

  const [vcard, setVcard] = useState<VCardDraft>(EMPTY_VCARD);
  const setVcardField = (key: keyof VCardDraft, value: string): void => {
    setVcard((current) => ({ ...current, [key]: value }));
  };

  const touched = useMemo(() => {
    switch (mode) {
      case "text":
        return text.trim() !== "";
      case "url":
        return url.trim() !== "";
      case "wifi":
        return ssid.trim() !== "" || wifiPassword.trim() !== "";
      case "mailto":
        return mailTo.trim() !== "";
      case "tel":
        return telNumber.trim() !== "";
      case "sms":
        return smsNumber.trim() !== "";
      case "geo":
        return geoLat.trim() !== "" || geoLng.trim() !== "";
      case "vcard":
        return vCardTouched(vcard);
    }
  }, [mode, text, url, ssid, wifiPassword, mailTo, telNumber, smsNumber, geoLat, geoLng, vcard]);

  const payload = useMemo(() => {
    switch (mode) {
      case "text":
        return qrPlainText(text);
      case "url":
        return qrUrlPayload(url);
      case "wifi":
        return buildWifiPayload(ssid, wifiSecurity, wifiPassword, wifiHidden);
      case "mailto":
        return buildMailtoPayload(mailTo, mailSubject, mailBody);
      case "tel":
        return qrTelPayload(telNumber);
      case "sms":
        return buildSmsPayload(smsNumber, smsMessage);
      case "geo":
        return buildGeoPayload(geoLat, geoLng, geoAlt);
      case "vcard":
        return buildVCardPayload(vcard);
    }
  }, [
    mode,
    text,
    url,
    ssid,
    wifiSecurity,
    wifiPassword,
    wifiHidden,
    mailTo,
    mailSubject,
    mailBody,
    telNumber,
    smsNumber,
    smsMessage,
    geoLat,
    geoLng,
    geoAlt,
    vcard,
  ]);

  const code = useMemo(
    () => (payload === null ? null : encodeQr(payload, { ecLevel })),
    [payload, ecLevel],
  );
  const svg = useMemo(
    () => (code === null ? "" : qrToSvg(code, { dark: "var(--nx-text)", light: "var(--nx-bg)" })),
    [code],
  );

  return (
    <>
      <div className="tool__actions" role="group" aria-label={s.modeLabel}>
        {QR_PAYLOAD_KINDS.map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant={mode === kind ? "primary" : "ghost"}
            aria-pressed={mode === kind}
            onClick={() => {
              setMode(kind);
            }}
          >
            {s.modeName[kind]}
          </Button>
        ))}
      </div>

      {mode === "text" && (
        <ToolTextArea label={s.textLabel} value={text} onChange={setText} rows={4} />
      )}

      {mode === "url" && <ToolInput label={s.urlLabel} value={url} onChange={setUrl} mono />}

      {mode === "wifi" && (
        <>
          <ToolInput label={s.ssidLabel} value={ssid} onChange={setSsid} />
          <div className="tool__pair">
            <ToolSelect
              label={s.securityLabel}
              value={wifiSecurity}
              options={[
                { id: "WPA", label: s.securityWpa },
                { id: "WEP", label: s.securityWep },
                { id: "nopass", label: s.securityOpen },
              ]}
              onChange={setWifiSecurity}
            />
            {wifiSecurity !== "nopass" && (
              <ToolInput
                label={s.passwordLabel}
                value={wifiPassword}
                onChange={setWifiPassword}
                mono
              />
            )}
          </div>
          <Checkbox
            checked={wifiHidden}
            onChange={(event) => {
              setWifiHidden(event.target.checked);
            }}
          >
            {s.hiddenLabel}
          </Checkbox>
        </>
      )}

      {mode === "mailto" && (
        <>
          <ToolInput label={s.mailToLabel} value={mailTo} onChange={setMailTo} mono />
          <ToolInput label={s.mailSubjectLabel} value={mailSubject} onChange={setMailSubject} />
          <ToolTextArea label={s.mailBodyLabel} value={mailBody} onChange={setMailBody} rows={3} />
        </>
      )}

      {mode === "tel" && (
        <ToolInput
          label={s.telLabel}
          value={telNumber}
          onChange={setTelNumber}
          mono
          hint={s.telHint}
        />
      )}

      {mode === "sms" && (
        <>
          <ToolInput
            label={s.telLabel}
            value={smsNumber}
            onChange={setSmsNumber}
            mono
            hint={s.telHint}
          />
          <ToolTextArea
            label={s.smsMessageLabel}
            value={smsMessage}
            onChange={setSmsMessage}
            rows={3}
          />
        </>
      )}

      {mode === "geo" && (
        <>
          <div className="tool__pair">
            <ToolInput
              label={s.latLabel}
              value={geoLat}
              onChange={setGeoLat}
              mono
              hint={s.latHint}
            />
            <ToolInput
              label={s.lngLabel}
              value={geoLng}
              onChange={setGeoLng}
              mono
              hint={s.lngHint}
            />
          </div>
          <ToolInput label={s.altLabel} value={geoAlt} onChange={setGeoAlt} mono hint={s.altHint} />
        </>
      )}

      {mode === "vcard" && (
        <>
          <div className="tool__pair">
            <ToolInput
              label={s.firstNameLabel}
              value={vcard.first}
              onChange={(value) => {
                setVcardField("first", value);
              }}
            />
            <ToolInput
              label={s.lastNameLabel}
              value={vcard.last}
              onChange={(value) => {
                setVcardField("last", value);
              }}
            />
          </div>
          <div className="tool__pair">
            <ToolInput
              label={s.orgLabel}
              value={vcard.org}
              onChange={(value) => {
                setVcardField("org", value);
              }}
            />
            <ToolInput
              label={s.jobTitleLabel}
              value={vcard.title}
              onChange={(value) => {
                setVcardField("title", value);
              }}
            />
          </div>
          <div className="tool__pair">
            <ToolInput
              label={s.phoneLabel}
              value={vcard.phone}
              onChange={(value) => {
                setVcardField("phone", value);
              }}
              mono
            />
            <ToolInput
              label={s.workPhoneLabel}
              value={vcard.workPhone}
              onChange={(value) => {
                setVcardField("workPhone", value);
              }}
              mono
            />
          </div>
          <div className="tool__pair">
            <ToolInput
              label={s.emailLabel}
              value={vcard.email}
              onChange={(value) => {
                setVcardField("email", value);
              }}
              mono
            />
            <ToolInput
              label={s.websiteLabel}
              value={vcard.url}
              onChange={(value) => {
                setVcardField("url", value);
              }}
              mono
            />
          </div>
          <ToolSection title={s.addressTitle}>
            <ToolInput
              label={s.streetLabel}
              value={vcard.street}
              onChange={(value) => {
                setVcardField("street", value);
              }}
            />
            <div className="tool__pair">
              <ToolInput
                label={s.cityLabel}
                value={vcard.city}
                onChange={(value) => {
                  setVcardField("city", value);
                }}
              />
              <ToolInput
                label={s.regionLabel}
                value={vcard.region}
                onChange={(value) => {
                  setVcardField("region", value);
                }}
              />
            </div>
            <div className="tool__pair">
              <ToolInput
                label={s.postalLabel}
                value={vcard.postal}
                onChange={(value) => {
                  setVcardField("postal", value);
                }}
              />
              <ToolInput
                label={s.countryLabel}
                value={vcard.country}
                onChange={(value) => {
                  setVcardField("country", value);
                }}
              />
            </div>
          </ToolSection>
          <ToolTextArea
            label={s.noteLabel}
            value={vcard.note}
            onChange={(value) => {
              setVcardField("note", value);
            }}
            rows={3}
          />
        </>
      )}

      <ToolSelect
        label={s.ecLabel}
        value={ecLevel}
        options={QR_EC_LEVELS.map((level) => ({ id: level, label: s.ecName[level] }))}
        onChange={setEcLevel}
        hint={s.ecHint}
      />

      {!touched ? (
        <ToolOutput label={s.svgLabel} value="" empty={c.awaitingInput} />
      ) : payload === null ? (
        <ToolFailure>{s.refusal[mode]}</ToolFailure>
      ) : code === null ? (
        <ToolFailure>{s.tooLarge}</ToolFailure>
      ) : (
        <>
          {/* qrToSvg escapes every colour and the optional title through its
              own escapeXml (verified by reading
              packages/core/src/devtools/qr.ts), and the path `d` attribute it
              emits (qrToSvgPath) holds only integer module coordinates —
              nothing user-controlled reaches this markup unescaped, so it is
              safe to render as raw HTML. */}
          <div
            className="tool__figure"
            style={{ display: "grid", width: "12rem", height: "12rem" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="tool__results">
            <ResultRow label={s.versionResultLabel} value={String(code.version)} />
            <ResultRow label={s.ecResultLabel} value={code.ecLevel} />
            <ResultRow label={s.sizeResultLabel} value={`${code.size}×${code.size}`} />
          </div>
          <ToolOutput label={s.svgLabel} value={svg} multiline />
        </>
      )}
    </>
  );
}

export const SYSTEM_SURFACES: Readonly<Record<string, ComponentType>> = {
  "http-status": HttpStatusTool,
  "path-convert": PathConvertTool,
  cidr: CidrTool,
  semver: SemverTool,
  qr: QrTool,
};
