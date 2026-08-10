import {
  AES_KEY_SIZES,
  AES_MODES,
  AMBIGUOUS_CHARACTERS,
  EC_CURVES,
  HASH_ALGORITHMS,
  PASSWORD_CLASSES,
  PBKDF2_DEFAULT_ITERATIONS,
  RSA_HASHES,
  RSA_MODULUS_SIZES,
  RSA_SCHEMES,
  SIGNATURE_ALGORITHMS,
  TOKEN_ALPHABETS,
  UNAVAILABLE_HASH_ALGORITHMS,
  WORD_LISTS,
  bytesToHex,
  decodeJwt,
  decryptAes,
  digestText,
  encryptAes,
  formatAesEnvelope,
  generateEcKeyPair,
  generatePassphrase,
  generatePassword,
  generateRsaKeyPair,
  generateTokens,
  hashAvailability,
  hmacText,
  parseAesEnvelope,
  rsaDecrypt,
  rsaEncrypt,
  signMessage,
  textToBytes,
  verifyJwt,
  verifyMessage,
  type AesEnvelope,
  type AesKeySize,
  type AesKeySource,
  type AesMode,
  type CryptoToolFailure,
  type CryptoToolResult,
  type EcCurve,
  type GeneratedPassphrase,
  type GeneratedPassword,
  type HashAlgorithm,
  type JwtDecoded,
  type JwtVerification,
  type JwtVerificationKey,
  type PasswordClass,
  type PemKeyPair,
  type RsaCryptOutput,
  type RsaHash,
  type RsaModulusSize,
  type RsaScheme,
  type SignRequest,
  type SignatureAlgorithm,
  type SignatureOutput,
  type TokenAlphabetId,
  type TokenBatch,
  type VerifyRequest,
  type WordListId,
} from "@nexus/core/devtools/cryptoTools";
import { Button, Checkbox, Chip } from "@nexus/ui";
import { useRef, useState, type ComponentType, type ReactNode } from "react";

import { fill, lookup, strings } from "../strings.js";
import {
  CopyButton,
  ResultRow,
  ToolFailure,
  ToolInput,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Kriptografija" — the 8 surfaces of this group of the developer drawer.
 *
 * One file per category rather than one map for all forty-eight, because the
 * map is the seam every surface is added at: a single file would be the one
 * place every future tool has to touch, and the place two people writing two
 * unrelated tools collide. `devToolSurfaces.tsx` composes the nine.
 *
 * Every id below is declared in `DEVTOOLS_TOOLS` (`shared/modules.ts`) and
 * `modules.test.ts` pins the two lists against each other in both directions —
 * a surface with no declaration is unreachable, and a declaration with no
 * surface is a row the drawer would offer and then fail to open.
 *
 * **This category is ASYNC, and every tool here reflects it.** WebCrypto's
 * digest, HMAC, AES, RSA and ECDSA operations all return promises, and an
 * RSA-4096 key takes real wall-clock time — so, unlike every other category in
 * this drawer, nothing here recomputes on a keystroke. Each tool acts on an
 * explicit button press, the button disables and names itself while its
 * promise is in flight, and `useAsyncAction` below keeps a request counter so
 * a stale response can never overwrite a newer one. Nothing here persists a
 * generated key, token, password or signature anywhere — the value exists only
 * in this surface's own state, for as long as the tab stays open.
 *
 * The tools this file owes:
 *   - `token-gen`
 *   - `password-gen`
 *   - `jwt`
 *   - `hashing`
 *   - `aes`
 *   - `rsa-keygen`
 *   - `rsa-crypt`
 *   - `signature`
 */

// ── Small, private plumbing — glue, not logic ───────────────────────────────

/** This category's strings, sliced per tool by each component at render time. */
type CryptoStrings = typeof strings.devtools.crypto;

/**
 * `"12"` → `12`; anything that is not a bare non-negative integer → `null`,
 * empty text included.
 *
 * **`null`, and not `NaN`.** `NaN` is a `number`, so it passes untouched through
 * the `??` chains the core validators use to apply their own defaults, and the
 * first check that notices is whichever one happens to run first. That is how a
 * nonsense PBKDF2 iteration count came back as „Koverta nije ispravna" during an
 * ENCRYPT, where there is no envelope on screen to be wrong. A `null` cannot be
 * handed to a `number` parameter, so every call site has to say what it means by
 * „nothing usable was typed" — and the sites genuinely disagree: for the PSS
 * salt length an empty field means „the algorithm's default", everywhere else it
 * is a refusal.
 */
function parseIntStrict(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

/**
 * What a numeric field is worth when it holds nothing usable, for the tools
 * whose core validator already refuses out-of-range values with a message
 * naming that exact field („Dužina mora biti između 1 i 512."). Negative on
 * purpose — it is outside every range this file passes — so what the user reads
 * is about their field rather than about the parse.
 */
const OUT_OF_RANGE = -1;

/** One decimal place, or an em dash for a figure that never came out finite. */
function formatBits(bits: number): string {
  return Number.isFinite(bits) ? bits.toFixed(1) : "—";
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A pasted JWK, narrowed to the string fields `verifyJwt` actually reads. */
interface JwkDraft {
  kty?: string;
  k?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  alg?: string;
  d?: string;
}

const JWK_FIELDS = ["kty", "k", "n", "e", "crv", "x", "y", "alg", "d"] as const;

/** `null` for anything that is not a JSON object — the same „refuse, don't repair" rule. */
function parseJwk(text: string): JwkDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isJsonRecord(parsed)) return null;
  const draft: JwkDraft = {};
  for (const key of JWK_FIELDS) {
    const value = parsed[key];
    if (typeof value === "string") draft[key] = value;
  }
  return draft;
}

type AsyncState<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "done"; readonly result: CryptoToolResult<T> }
  | { readonly kind: "unexpected" };

/**
 * Runs one WebCrypto-backed action at a time.
 *
 * `token` is bumped on every `run()`; a `.then`/`.catch` that lands after a
 * newer call started is dropped rather than applied to state, which is the
 * race the brief asks every async surface here to close. Nothing here can
 * throw into React: the module never throws for bad user input, so `.catch`
 * exists only for the one case that is not user input — WebCrypto itself
 * refusing — and it resolves to a named state instead of an unhandled
 * rejection.
 */
function useAsyncAction<T>() {
  const token = useRef(0);
  const [state, setState] = useState<AsyncState<T>>({ kind: "idle" });

  function run(
    task: () => Promise<CryptoToolResult<T>>,
    onDone?: (result: CryptoToolResult<T>) => void,
  ): void {
    const id = (token.current += 1);
    setState({ kind: "pending" });
    task()
      .then((result) => {
        if (token.current !== id) return;
        setState({ kind: "done", result });
        onDone?.(result);
      })
      .catch(() => {
        if (token.current !== id) return;
        setState({ kind: "unexpected" });
      });
  }

  return { state, run, pending: state.kind === "pending" } as const;
}

/** The one failure every async tool shares: a typed refusal, or the unexpected fallback. */
function renderAsyncFailure<T>(
  state: AsyncState<T>,
  describe: (failure: CryptoToolFailure) => string,
  unexpected: string,
): ReactNode {
  if (state.kind === "done" && !state.result.ok) {
    return <ToolFailure>{describe(state.result.failure)}</ToolFailure>;
  }
  if (state.kind === "unexpected") return <ToolFailure>{unexpected}</ToolFailure>;
  return null;
}

/** The app's segmented recipe, generic over a two-or-more-way choice. */
function ModeToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { readonly id: T; readonly label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="tool__actions" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={option.id === value ? "primary" : "ghost"}
          aria-pressed={option.id === value}
          onClick={() => {
            onChange(option.id);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

// ── 1. Token generator ───────────────────────────────────────────────────────

function describeTokenFailure(s: CryptoStrings["token-gen"], failure: CryptoToolFailure): string {
  switch (failure.code) {
    case "length-out-of-range":
      return fill(s.errLength, { limit: failure.limit ?? 0 });
    case "count-out-of-range":
      return fill(s.errCount, { limit: failure.limit ?? 0 });
    case "alphabet-too-small":
      return s.errAlphabetSmall;
    case "alphabet-too-large":
      return fill(s.errAlphabetLarge, { limit: failure.limit ?? 0 });
    case "alphabet-repeats":
      return s.errAlphabetRepeats;
    default:
      return s.errRandom;
  }
}

function TokenGenTool() {
  const s = strings.devtools.crypto["token-gen"];
  const [lengthText, setLengthText] = useState("32");
  const [alphabet, setAlphabet] = useState<TokenAlphabetId>("hex");
  const [customAlphabet, setCustomAlphabet] = useState("");
  const [countText, setCountText] = useState("1");
  const [batch, setBatch] = useState<CryptoToolResult<TokenBatch> | null>(null);

  const alphabetLabels: Record<TokenAlphabetId, string> = {
    hex: s.alphabetHex,
    base64url: s.alphabetBase64Url,
    base58: s.alphabetBase58,
    alphanumeric: s.alphabetAlphanumeric,
    custom: s.alphabetCustom,
  };
  const alphabetOptions = TOKEN_ALPHABETS.map((id) => ({ id, label: alphabetLabels[id] }));

  function handleGenerate(): void {
    const length = parseIntStrict(lengthText) ?? OUT_OF_RANGE;
    const count = parseIntStrict(countText) ?? OUT_OF_RANGE;
    setBatch(
      generateTokens(
        alphabet === "custom"
          ? { length, alphabet, customAlphabet, count }
          : { length, alphabet, count },
      ),
    );
  }

  return (
    <>
      <ToolInput label={s.length} value={lengthText} onChange={setLengthText} mono />
      <ToolSelect
        label={s.alphabet}
        value={alphabet}
        options={alphabetOptions}
        onChange={setAlphabet}
      />
      {alphabet === "custom" && (
        <ToolInput
          label={s.customAlphabet}
          value={customAlphabet}
          onChange={setCustomAlphabet}
          placeholder={s.customPlaceholder}
          mono
        />
      )}
      <ToolInput label={s.count} value={countText} onChange={setCountText} mono />
      <Button onClick={handleGenerate}>{s.generate}</Button>
      {batch !== null &&
        (batch.ok ? (
          <>
            <div className="tool__actions">
              <CopyButton value={batch.value.tokens.join("\n")} label={s.copyAll} />
            </div>
            <ToolTable
              head={[s.tokenColumn, ""]}
              rows={batch.value.tokens.map((token) => [token, <CopyButton value={token} />])}
            />
            <div className="tool__results">
              <ResultRow
                label={s.entropy}
                value={
                  fill(s.entropyValue, { bits: formatBits(batch.value.entropyBitsPerToken) }) +
                  " " +
                  fill(s.entropyFrom, { size: batch.value.alphabetSize })
                }
              />
            </div>
          </>
        ) : (
          <ToolFailure>{describeTokenFailure(s, batch.failure)}</ToolFailure>
        ))}
    </>
  );
}

// ── 2. Password / passphrase generator ──────────────────────────────────────

function describePasswordFailure(
  s: CryptoStrings["password-gen"],
  failure: CryptoToolFailure,
): string {
  switch (failure.code) {
    case "length-out-of-range":
      return fill(s.errLength, { limit: failure.limit ?? 0 });
    case "no-character-classes":
      return s.errNoClasses;
    case "length-below-required-classes":
      return fill(s.errTooShort, { limit: failure.limit ?? 0 });
    case "word-count-out-of-range":
      return fill(s.errWords, { limit: failure.limit ?? 0 });
    default:
      return s.errRandom;
  }
}

function PasswordGenTool() {
  const s = strings.devtools.crypto["password-gen"];
  const [mode, setMode] = useState<"password" | "passphrase">("password");

  const [lengthText, setLengthText] = useState("20");
  const [classes, setClasses] = useState<readonly PasswordClass[]>([
    "lower",
    "upper",
    "digit",
    "symbol",
  ]);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [requireEachClass, setRequireEachClass] = useState(true);
  const [passwordResult, setPasswordResult] =
    useState<CryptoToolResult<GeneratedPassword> | null>(null);

  const [wordsText, setWordsText] = useState("6");
  const [list, setList] = useState<WordListId>("sr");
  const [separator, setSeparator] = useState("-");
  const [capitalize, setCapitalize] = useState(false);
  const [passphraseResult, setPassphraseResult] =
    useState<CryptoToolResult<GeneratedPassphrase> | null>(null);

  const classLabels: Record<PasswordClass, string> = {
    lower: s.lower,
    upper: s.upper,
    digit: s.digit,
    symbol: s.symbol,
  };
  const listOptions = WORD_LISTS.map((id) => ({ id, label: id === "sr" ? s.listSr : s.listEn }));

  function toggleClass(cls: PasswordClass): void {
    setClasses((current) =>
      current.includes(cls) ? current.filter((c) => c !== cls) : [...current, cls],
    );
  }

  function handleGeneratePassword(): void {
    const length = parseIntStrict(lengthText) ?? OUT_OF_RANGE;
    setPasswordResult(generatePassword({ length, classes, excludeAmbiguous, requireEachClass }));
  }

  function handleGeneratePassphrase(): void {
    const words = parseIntStrict(wordsText) ?? OUT_OF_RANGE;
    setPassphraseResult(generatePassphrase({ words, list, separator, capitalize }));
  }

  return (
    <>
      <ModeToggle
        value={mode}
        onChange={setMode}
        label={s.modeLabel}
        options={[
          { id: "password", label: s.modePassword },
          { id: "passphrase", label: s.modePassphrase },
        ]}
      />
      {mode === "password" ? (
        <>
          <ToolInput label={s.length} value={lengthText} onChange={setLengthText} mono />
          <div className="tool__actions" role="group" aria-label={s.classesLabel}>
            {PASSWORD_CLASSES.map((cls) => (
              <Checkbox
                key={cls}
                checked={classes.includes(cls)}
                onChange={() => {
                  toggleClass(cls);
                }}
              >
                {classLabels[cls]}
              </Checkbox>
            ))}
          </div>
          <div className="tool__actions">
            <Checkbox
              checked={excludeAmbiguous}
              onChange={(event) => {
                setExcludeAmbiguous(event.target.checked);
              }}
            >
              {fill(s.excludeAmbiguous, { chars: AMBIGUOUS_CHARACTERS })}
            </Checkbox>
            <Checkbox
              checked={requireEachClass}
              onChange={(event) => {
                setRequireEachClass(event.target.checked);
              }}
            >
              {s.requireEachClass}
            </Checkbox>
          </div>
          <Button onClick={handleGeneratePassword}>
            {passwordResult === null ? s.generate : s.regenerate}
          </Button>
          {passwordResult !== null &&
            (passwordResult.ok ? (
              <>
                <ToolOutput
                  label={strings.devtools.common.result}
                  value={passwordResult.value.password}
                />
                <div className="tool__results">
                  <ResultRow
                    label={s.entropy}
                    value={fill(s.entropyValue, {
                      bits: formatBits(passwordResult.value.entropyBits),
                    })}
                    mono={false}
                  />
                </div>
                <p className="tool__note">
                  {fill(s.entropyNote, { size: passwordResult.value.alphabetSize })}
                </p>
              </>
            ) : (
              <ToolFailure>{describePasswordFailure(s, passwordResult.failure)}</ToolFailure>
            ))}
        </>
      ) : (
        <>
          <ToolInput label={s.words} value={wordsText} onChange={setWordsText} mono />
          <div className="tool__pair">
            <ToolSelect label={s.list} value={list} options={listOptions} onChange={setList} />
            <ToolInput label={s.separator} value={separator} onChange={setSeparator} mono />
          </div>
          <Checkbox
            checked={capitalize}
            onChange={(event) => {
              setCapitalize(event.target.checked);
            }}
          >
            {s.capitalize}
          </Checkbox>
          <Button onClick={handleGeneratePassphrase}>
            {passphraseResult === null ? s.generate : s.regenerate}
          </Button>
          {passphraseResult !== null &&
            (passphraseResult.ok ? (
              <>
                <ToolOutput
                  label={strings.devtools.common.result}
                  value={passphraseResult.value.passphrase}
                />
                <div className="tool__results">
                  <ResultRow
                    label={s.entropy}
                    value={fill(s.entropyValue, {
                      bits: formatBits(passphraseResult.value.entropyBits),
                    })}
                    mono={false}
                  />
                </div>
                <p className="tool__note">
                  {fill(s.entropyNoteWords, { size: passphraseResult.value.listSize })}
                </p>
              </>
            ) : (
              <ToolFailure>{describePasswordFailure(s, passphraseResult.failure)}</ToolFailure>
            ))}
        </>
      )}
    </>
  );
}

// ── 3. JWT ───────────────────────────────────────────────────────────────────

function describeJwtDecodeFailure(
  s: CryptoStrings["jwt"],
  failure: CryptoToolFailure,
  subjectLabels: Readonly<Record<string, string>>,
): string {
  const subject = subjectLabels[failure.subject ?? ""] ?? failure.subject ?? "";
  switch (failure.code) {
    case "jwt-not-base64url":
      return fill(s.errNotBase64Url, { subject });
    case "jwt-not-json":
      return fill(s.errNotJson, { subject });
    default:
      return s.errMalformed;
  }
}

function describeJwtVerifyFailure(
  s: CryptoStrings["jwt"],
  failure: CryptoToolFailure,
  subjectLabels: Readonly<Record<string, string>>,
): string {
  switch (failure.code) {
    case "jwt-malformed":
    case "jwt-not-base64url":
    case "jwt-not-json":
      return describeJwtDecodeFailure(s, failure, subjectLabels);
    case "jwt-alg-none":
      return s.errAlgNone;
    case "jwt-alg-missing":
      return s.errAlgMissing;
    case "jwt-alg-unsupported":
      return fill(s.errAlgUnsupported, { subject: failure.subject ?? "" });
    case "jwt-key-mismatch":
      return fill(s.errKeyMismatch, { subject: failure.subject ?? "" });
    case "key-is-private":
      return s.errKeyPrivate;
    case "pem-malformed":
      return s.errPem;
    case "pem-wrong-label":
      return fill(s.errPemLabel, { subject: failure.subject ?? "" });
    default:
      return s.errKeyImport;
  }
}

function validityLabel(s: CryptoStrings["jwt"], validity: JwtDecoded["validity"]): string {
  if (validity.expired) return s.expired;
  if (validity.notYetValid) return s.notYetValid;
  if (!validity.bounded) return s.unbounded;
  return s.valid;
}

function claimValueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function claimNameCell(s: CryptoStrings["jwt"], claim: JwtDecoded["claims"][number]): ReactNode {
  if (!claim.registered) return claim.name;
  const label = lookup(s.registeredClaimNames, claim.name) ?? claim.name;
  return (
    <>
      {label} ({claim.name}) <span className="tool__badge">{s.registered}</span>
    </>
  );
}

function unsupportedAlgorithmNote(s: CryptoStrings["jwt"], support: JwtDecoded["support"]): string {
  if (support.supported) return "";
  if (support.reason === "none") return s.errAlgNone;
  if (support.reason === "missing") return s.errAlgMissing;
  return fill(s.errAlgUnsupported, { subject: support.algorithm ?? "" });
}

function JwtTool() {
  const s = strings.devtools.crypto.jwt;
  const [token, setToken] = useState("");
  const [keyKind, setKeyKind] = useState<"secret" | "pem" | "jwk">("secret");
  const [secretText, setSecretText] = useState("");
  const [pemText, setPemText] = useState("");
  const [jwkText, setJwkText] = useState("");
  const verifyState = useAsyncAction<JwtVerification>();

  const subjectLabels: Record<string, string> = {
    header: s.header,
    payload: s.payload,
    signature: s.signature,
  };
  const keyKindOptions = [
    { id: "secret", label: s.keySecret },
    { id: "pem", label: s.keyPem },
    { id: "jwk", label: s.keyJwk },
  ] as const;

  const trimmed = token.trim();
  const decoded = trimmed === "" ? null : decodeJwt(trimmed, Date.now());

  function buildKey(): JwtVerificationKey | null {
    if (keyKind === "secret") return { kind: "secret", secret: textToBytes(secretText) };
    if (keyKind === "pem") return { kind: "pem", pem: pemText };
    const draft = parseJwk(jwkText);
    return draft === null ? null : { kind: "jwk", jwk: draft };
  }

  async function verifyTask(): Promise<CryptoToolResult<JwtVerification>> {
    const key = buildKey();
    if (key === null) return { ok: false, failure: { code: "key-import-failed" } };
    return verifyJwt(trimmed, key, Date.now());
  }

  function handleVerify(): void {
    verifyState.run(verifyTask);
  }

  return (
    <>
      <ToolTextArea
        label={s.token}
        value={token}
        onChange={setToken}
        placeholder={s.tokenPlaceholder}
      />
      {decoded === null ? (
        <ToolOutput
          label={strings.devtools.common.output}
          value=""
          empty={strings.devtools.common.awaitingInput}
        />
      ) : !decoded.ok ? (
        <ToolFailure>{describeJwtDecodeFailure(s, decoded.failure, subjectLabels)}</ToolFailure>
      ) : (
        <>
          <div className="tool__results">
            <ResultRow
              label={s.algorithm}
              value={decoded.value.support.supported ? decoded.value.support.algorithm : "—"}
            />
            <ResultRow
              label={s.valid}
              value={validityLabel(s, decoded.value.validity)}
              mono={false}
            />
          </div>
          {decoded.value.validity.unreadable.length > 0 && (
            <p className="tool__note">
              {fill(s.unreadable, { claims: decoded.value.validity.unreadable.join(", ") })}
            </p>
          )}

          <ToolSection title={s.header}>
            <ToolOutput
              label={s.header}
              value={JSON.stringify(decoded.value.header, null, 2)}
              multiline
            />
          </ToolSection>
          <ToolSection title={s.payload}>
            <ToolOutput
              label={s.payload}
              value={JSON.stringify(decoded.value.payload, null, 2)}
              multiline
            />
          </ToolSection>
          <ToolSection title={s.signature}>
            <ToolOutput label={s.signature} value={bytesToHex(decoded.value.signature)} />
          </ToolSection>

          <ToolSection title={s.claims}>
            <ToolTable
              head={[s.claimName, s.claimValue, s.claimInstant]}
              rows={decoded.value.claims.map((claim) => [
                claimNameCell(s, claim),
                claimValueText(claim.value),
                claim.instant ?? "—",
              ])}
            />
          </ToolSection>

          {decoded.value.support.supported ? (
            <ToolSection title={s.verify}>
              <ToolSelect
                label={s.keyKind}
                value={keyKind}
                options={keyKindOptions}
                onChange={setKeyKind}
              />
              {keyKind === "secret" && (
                <ToolInput
                  label={s.keySecret}
                  value={secretText}
                  onChange={setSecretText}
                  placeholder={s.secretPlaceholder}
                  mono
                />
              )}
              {keyKind === "pem" && (
                <ToolTextArea label={s.keyPem} value={pemText} onChange={setPemText} />
              )}
              {keyKind === "jwk" && (
                <ToolTextArea
                  label={s.keyJwk}
                  value={jwkText}
                  onChange={setJwkText}
                  placeholder={s.jwkPlaceholder}
                />
              )}
              <Button onClick={handleVerify} disabled={verifyState.pending}>
                {verifyState.pending ? strings.devtools.crypto.shared.working : s.verify}
              </Button>
              {verifyState.state.kind === "done" && verifyState.state.result.ok && (
                <Chip variant={verifyState.state.result.value.signatureValid ? "accent" : "danger"}>
                  {verifyState.state.result.value.signatureValid
                    ? s.signatureValid
                    : s.signatureInvalid}
                </Chip>
              )}
              {renderAsyncFailure(
                verifyState.state,
                (failure) => describeJwtVerifyFailure(s, failure, subjectLabels),
                strings.devtools.crypto.shared.webCryptoFailure,
              )}
            </ToolSection>
          ) : (
            <p className="tool__note">{unsupportedAlgorithmNote(s, decoded.value.support)}</p>
          )}
        </>
      )}
    </>
  );
}

// ── 4. Hashing / HMAC ────────────────────────────────────────────────────────

function HashingTool() {
  const s = strings.devtools.crypto.hashing;
  const [inputText, setInputText] = useState("");
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("SHA-256");
  const [hmacOn, setHmacOn] = useState(false);
  const [hmacKey, setHmacKey] = useState("");
  const digestState = useAsyncAction<{ readonly hex: string; readonly base64: string }>();

  const unavailableNotes = UNAVAILABLE_HASH_ALGORITHMS.map((name) => {
    const availability = hashAvailability(name);
    return availability.ok
      ? null
      : fill(s.errUnavailable, { subject: availability.failure.subject ?? name });
  }).filter((note): note is string => note !== null);

  function handleCompute(): void {
    digestState.run(() =>
      hmacOn ? hmacText(hmacKey, inputText, algorithm) : digestText(inputText, algorithm),
    );
  }

  return (
    <>
      <ToolTextArea
        label={strings.devtools.common.input}
        value={inputText}
        onChange={setInputText}
        placeholder={s.inputPlaceholder}
      />
      <div className="tool__actions" role="group" aria-label={s.algorithm}>
        {HASH_ALGORITHMS.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={algorithm === name ? "primary" : "ghost"}
            aria-pressed={algorithm === name}
            onClick={() => {
              setAlgorithm(name);
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      <Checkbox
        checked={hmacOn}
        onChange={(event) => {
          setHmacOn(event.target.checked);
        }}
      >
        {s.hmacOn}
      </Checkbox>
      {hmacOn && (
        <ToolInput
          label={s.hmacKey}
          value={hmacKey}
          onChange={setHmacKey}
          placeholder={s.hmacKeyPlaceholder}
          mono
        />
      )}
      <Button onClick={handleCompute} disabled={digestState.pending}>
        {digestState.pending ? strings.devtools.crypto.shared.working : s.compute}
      </Button>
      {digestState.state.kind === "done" && digestState.state.result.ok && (
        <div className="tool__results">
          <ResultRow label={s.hex} value={digestState.state.result.value.hex} />
          <ResultRow label={s.base64} value={digestState.state.result.value.base64} />
        </div>
      )}
      {renderAsyncFailure(
        digestState.state,
        () => strings.devtools.crypto.shared.webCryptoFailure,
        strings.devtools.crypto.shared.webCryptoFailure,
      )}
      {unavailableNotes.map((note) => (
        <p key={note} className="tool__note">
          {note}
        </p>
      ))}
    </>
  );
}

// ── 5. AES ───────────────────────────────────────────────────────────────────

function describeAesFailure(s: CryptoStrings["aes"], failure: CryptoToolFailure): string {
  switch (failure.code) {
    case "invalid-hex":
      return s.errInvalidHex;
    case "invalid-base64":
      return s.errInvalidBase64;
    case "key-length-mismatch":
      return fill(s.errKeyLength, { limit: failure.limit ?? 0, actual: failure.actual ?? 0 });
    case "iterations-too-low":
      return fill(s.errIterations, { limit: failure.limit ?? 0 });
    case "aes-authentication-failed":
      return s.errAuth;
    case "aes-decrypt-failed":
      return s.errDecrypt;
    case "not-utf8":
      return s.errNotUtf8;
    case "envelope-key-mismatch":
      return s.errKeyMismatch;
    default:
      return s.errEnvelope;
  }
}

function AesTool() {
  const s = strings.devtools.crypto.aes;
  const [direction, setDirection] = useState<"encrypt" | "decrypt">("encrypt");
  const [mode, setMode] = useState<AesMode>("AES-GCM");
  const [keyBits, setKeyBits] = useState<AesKeySize>(256);
  const [keyKind, setKeyKind] = useState<"raw" | "passphrase">("raw");
  const [rawEncoding, setRawEncoding] = useState<"hex" | "base64">("hex");
  const [rawKeyText, setRawKeyText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [iterationsText, setIterationsText] = useState(String(PBKDF2_DEFAULT_ITERATIONS));
  const [plaintext, setPlaintext] = useState("");
  const [envelopeText, setEnvelopeText] = useState("");
  const encryptState = useAsyncAction<AesEnvelope>();
  const decryptState = useAsyncAction<string>();

  const keyBitsOptions = AES_KEY_SIZES.map((bits) => ({ id: String(bits), label: String(bits) }));
  const modeOptions = AES_MODES.map((id) => ({ id, label: id }));

  // The iteration count is only a question while a passphrase is being turned
  // INTO a key: a decrypt reads the count out of the envelope it was given, and
  // a direct key has no KDF at all. Outside that one case the field is not even
  // rendered, so its text must not be able to refuse anything.
  const iterationsAsked = keyKind === "passphrase" && direction === "encrypt";
  const iterations = parseIntStrict(iterationsText);
  const iterationsError = iterationsAsked && iterations === null ? s.errIterationsShape : undefined;

  function keySource(): AesKeySource | null {
    if (keyKind === "raw") return { kind: "raw", text: rawKeyText, encoding: rawEncoding };
    if (direction === "decrypt") return { kind: "passphrase", passphrase };
    return iterations === null ? null : { kind: "passphrase", passphrase, iterations };
  }

  function handleEncrypt(): void {
    const source = keySource();
    if (source === null) return; // The field says why, and the button is disabled.
    encryptState.run(() => encryptAes(plaintext, source, { mode, keyBits }));
  }

  async function decryptTask(source: AesKeySource): Promise<CryptoToolResult<string>> {
    const envelope = parseAesEnvelope(envelopeText);
    if (!envelope.ok) return envelope;
    return decryptAes(envelope.value, source);
  }

  function handleDecrypt(): void {
    const source = keySource();
    if (source === null) return;
    decryptState.run(() => decryptTask(source));
  }

  return (
    <>
      <ModeToggle
        value={direction}
        onChange={setDirection}
        label={s.direction}
        options={[
          { id: "encrypt", label: s.encrypt },
          { id: "decrypt", label: s.decrypt },
        ]}
      />
      <div className="tool__pair">
        <ToolSelect label={s.mode} value={mode} options={modeOptions} onChange={setMode} />
        <ToolSelect
          label={s.keyBits}
          value={String(keyBits)}
          options={keyBitsOptions}
          onChange={(value) => {
            const found = AES_KEY_SIZES.find((size) => String(size) === value);
            if (found !== undefined) setKeyBits(found);
          }}
        />
      </div>
      <ModeToggle
        value={keyKind}
        onChange={setKeyKind}
        label={s.keySource}
        options={[
          { id: "raw", label: s.keyRaw },
          { id: "passphrase", label: s.keyPassphrase },
        ]}
      />
      {keyKind === "raw" ? (
        <div className="tool__pair">
          <ToolSelect
            label={s.encoding}
            value={rawEncoding}
            options={[
              { id: "hex", label: s.encodingHex },
              { id: "base64", label: s.encodingBase64 },
            ]}
            onChange={setRawEncoding}
          />
          <ToolInput label={s.keyValue} value={rawKeyText} onChange={setRawKeyText} mono />
        </div>
      ) : (
        <>
          <ToolInput label={s.passphrase} value={passphrase} onChange={setPassphrase} mono />
          {iterationsAsked && (
            <ToolInput
              label={s.iterations}
              value={iterationsText}
              onChange={setIterationsText}
              error={iterationsError}
              mono
            />
          )}
        </>
      )}

      {direction === "encrypt" ? (
        <>
          <ToolTextArea
            label={s.plaintext}
            value={plaintext}
            onChange={setPlaintext}
            placeholder={s.plaintextPlaceholder}
          />
          <Button
            onClick={handleEncrypt}
            disabled={encryptState.pending || iterationsError !== undefined}
          >
            {encryptState.pending ? strings.devtools.crypto.shared.working : s.encrypt}
          </Button>
          {encryptState.state.kind === "done" && encryptState.state.result.ok && (
            <ToolOutput
              label={s.envelope}
              value={formatAesEnvelope(encryptState.state.result.value)}
              multiline
            />
          )}
          {renderAsyncFailure(
            encryptState.state,
            (failure) => describeAesFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      ) : (
        <>
          <ToolTextArea
            label={s.envelope}
            value={envelopeText}
            onChange={setEnvelopeText}
            placeholder={s.envelopePlaceholder}
          />
          <Button onClick={handleDecrypt} disabled={decryptState.pending}>
            {decryptState.pending ? strings.devtools.crypto.shared.working : s.decrypt}
          </Button>
          {decryptState.state.kind === "done" && decryptState.state.result.ok && (
            <ToolOutput
              label={strings.devtools.common.output}
              value={decryptState.state.result.value}
              multiline
            />
          )}
          {renderAsyncFailure(
            decryptState.state,
            (failure) => describeAesFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      )}
      <p className="tool__note">{s.ivNote}</p>
    </>
  );
}

// ── 6. RSA / EC key generation ───────────────────────────────────────────────

function describeKeygenFailure(
  s: CryptoStrings["rsa-keygen"],
  failure: CryptoToolFailure,
): string {
  return fill(s.errUnsupported, { subject: failure.subject ?? "" });
}

function RsaKeygenTool() {
  const s = strings.devtools.crypto["rsa-keygen"];
  const [scheme, setScheme] = useState<RsaScheme>("RSA-OAEP");
  const [modulusBits, setModulusBits] = useState<RsaModulusSize>(2048);
  const [hash, setHash] = useState<RsaHash>("SHA-256");
  const [curve, setCurve] = useState<EcCurve>("P-256");
  const rsaState = useAsyncAction<PemKeyPair>();
  const ecState = useAsyncAction<PemKeyPair>();

  const schemeOptions = RSA_SCHEMES.map((id) => ({
    id,
    label: id === "RSA-OAEP" ? s.schemeOaep : s.schemePss,
  }));
  const modulusOptions = RSA_MODULUS_SIZES.map((size) => ({
    id: String(size),
    label: String(size),
  }));
  const hashOptions = RSA_HASHES.map((id) => ({ id, label: id }));
  const curveOptions = EC_CURVES.map((id) => ({ id, label: id }));

  function handleGenerateRsa(): void {
    rsaState.run(() => generateRsaKeyPair({ scheme, modulusBits, hash }));
  }

  function handleGenerateEc(): void {
    ecState.run(() => generateEcKeyPair(curve));
  }

  return (
    <>
      <p className="tool__note">{s.warning}</p>

      <ToolSection title={s.sectionRsa}>
        <div className="tool__pair">
          <ToolSelect
            label={s.scheme}
            value={scheme}
            options={schemeOptions}
            onChange={setScheme}
          />
          <ToolSelect
            label={s.modulus}
            value={String(modulusBits)}
            options={modulusOptions}
            onChange={(value) => {
              const found = RSA_MODULUS_SIZES.find((size) => String(size) === value);
              if (found !== undefined) setModulusBits(found);
            }}
          />
        </div>
        <ToolSelect label={s.hash} value={hash} options={hashOptions} onChange={setHash} />
        {modulusBits === 4096 && <p className="tool__note">{s.working}</p>}
        <Button onClick={handleGenerateRsa} disabled={rsaState.pending}>
          {rsaState.pending ? strings.devtools.crypto.shared.working : s.generate}
        </Button>
        {rsaState.state.kind === "done" && rsaState.state.result.ok && (
          <>
            <ToolOutput
              label={s.privateKey}
              value={rsaState.state.result.value.privatePem}
              multiline
            />
            <ToolOutput
              label={s.publicKey}
              value={rsaState.state.result.value.publicPem}
              multiline
            />
          </>
        )}
        {renderAsyncFailure(
          rsaState.state,
          (failure) => describeKeygenFailure(s, failure),
          strings.devtools.crypto.shared.webCryptoFailure,
        )}
      </ToolSection>

      <ToolSection title={s.sectionEc}>
        <ToolSelect label={s.curve} value={curve} options={curveOptions} onChange={setCurve} />
        <Button onClick={handleGenerateEc} disabled={ecState.pending}>
          {ecState.pending ? strings.devtools.crypto.shared.working : s.generateEc}
        </Button>
        {ecState.state.kind === "done" && ecState.state.result.ok && (
          <>
            <ToolOutput
              label={s.privateKey}
              value={ecState.state.result.value.privatePem}
              multiline
            />
            <ToolOutput
              label={s.publicKey}
              value={ecState.state.result.value.publicPem}
              multiline
            />
          </>
        )}
        {renderAsyncFailure(
          ecState.state,
          (failure) => describeKeygenFailure(s, failure),
          strings.devtools.crypto.shared.webCryptoFailure,
        )}
      </ToolSection>
    </>
  );
}

// ── 7. RSA-OAEP encrypt / decrypt ────────────────────────────────────────────

function describeRsaCryptFailure(
  s: CryptoStrings["rsa-crypt"],
  failure: CryptoToolFailure,
): string {
  switch (failure.code) {
    case "rsa-plaintext-too-long":
      return fill(s.errTooLong, { actual: failure.actual ?? 0, limit: failure.limit ?? 0 });
    case "pem-wrong-label":
      return fill(s.errPemLabel, { subject: failure.subject ?? "" });
    case "pem-malformed":
      return s.errPem;
    case "rsa-decrypt-failed":
      return s.errDecrypt;
    case "invalid-base64":
      return s.errInvalidBase64;
    case "not-utf8":
      return s.errNotUtf8;
    default:
      return s.errKeyImport;
  }
}

function RsaCryptTool() {
  const s = strings.devtools.crypto["rsa-crypt"];
  const [direction, setDirection] = useState<"encrypt" | "decrypt">("encrypt");
  const [publicPem, setPublicPem] = useState("");
  const [privatePem, setPrivatePem] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [ciphertext, setCiphertext] = useState("");
  const [hash, setHash] = useState<RsaHash>("SHA-256");
  const encryptState = useAsyncAction<RsaCryptOutput>();
  const decryptState = useAsyncAction<string>();

  const hashOptions = RSA_HASHES.map((id) => ({ id, label: id }));

  function handleEncrypt(): void {
    encryptState.run(() => rsaEncrypt(publicPem, plaintext, hash));
  }

  function handleDecrypt(): void {
    decryptState.run(() => rsaDecrypt(privatePem, ciphertext, hash));
  }

  return (
    <>
      <ModeToggle
        value={direction}
        onChange={setDirection}
        label={s.direction}
        options={[
          { id: "encrypt", label: s.encrypt },
          { id: "decrypt", label: s.decrypt },
        ]}
      />
      <ToolSelect label={s.hash} value={hash} options={hashOptions} onChange={setHash} />
      {direction === "encrypt" ? (
        <>
          <ToolTextArea label={s.publicKey} value={publicPem} onChange={setPublicPem} />
          <ToolTextArea label={s.plaintext} value={plaintext} onChange={setPlaintext} />
          <Button onClick={handleEncrypt} disabled={encryptState.pending}>
            {encryptState.pending ? strings.devtools.crypto.shared.working : s.encrypt}
          </Button>
          {encryptState.state.kind === "done" && encryptState.state.result.ok && (
            <>
              <ToolOutput label={s.ciphertext} value={encryptState.state.result.value.base64} />
              <div className="tool__results">
                <ResultRow
                  label={s.usedLabel}
                  value={fill(s.used, {
                    // Both figures come off the RESULT. Measuring the live
                    // `plaintext` field here described a ciphertext that was
                    // already on screen with a number that changed under it on
                    // the next keystroke.
                    actual: encryptState.state.result.value.plaintextBytes,
                    limit: encryptState.state.result.value.maxPlaintextBytes,
                  })}
                />
              </div>
            </>
          )}
          {renderAsyncFailure(
            encryptState.state,
            (failure) => describeRsaCryptFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      ) : (
        <>
          <ToolTextArea label={s.privateKey} value={privatePem} onChange={setPrivatePem} />
          <ToolInput label={s.ciphertext} value={ciphertext} onChange={setCiphertext} mono />
          <Button onClick={handleDecrypt} disabled={decryptState.pending}>
            {decryptState.pending ? strings.devtools.crypto.shared.working : s.decrypt}
          </Button>
          {decryptState.state.kind === "done" && decryptState.state.result.ok && (
            <ToolOutput label={s.plaintext} value={decryptState.state.result.value} multiline />
          )}
          {renderAsyncFailure(
            decryptState.state,
            (failure) => describeRsaCryptFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      )}
    </>
  );
}

// ── 8. Digital signature ─────────────────────────────────────────────────────

function isEcdsaAlgorithm(algorithm: SignatureAlgorithm): boolean {
  return algorithm === "ECDSA-P-256" || algorithm === "ECDSA-P-384";
}

function ecCurveOf(algorithm: SignatureAlgorithm): EcCurve {
  return algorithm === "ECDSA-P-384" ? "P-384" : "P-256";
}

function describeSignatureFailure(
  s: CryptoStrings["signature"],
  failure: CryptoToolFailure,
): string {
  switch (failure.code) {
    case "unsupported-algorithm":
      return fill(s.errUnsupported, { subject: failure.subject ?? "" });
    case "pem-malformed":
      return s.errPem;
    case "invalid-hex":
      return s.errInvalidHex;
    case "invalid-base64":
      return s.errInvalidBase64;
    case "signature-failed":
      return s.errSign;
    default:
      return s.errKeyImport;
  }
}

function SignatureTool() {
  const s = strings.devtools.crypto.signature;
  const [tab, setTab] = useState<"sign" | "verify">("sign");
  const [algorithm, setAlgorithm] = useState<SignatureAlgorithm>("RSA-PSS");
  const [privatePem, setPrivatePem] = useState("");
  const [publicPem, setPublicPem] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<RsaHash>("SHA-256");
  const [saltLengthText, setSaltLengthText] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [encoding, setEncoding] = useState<"hex" | "base64">("hex");
  const signState = useAsyncAction<SignatureOutput>();
  const verifyState = useAsyncAction<{ readonly valid: boolean }>();
  const ecState = useAsyncAction<PemKeyPair>();

  const algorithmOptions = SIGNATURE_ALGORITHMS.map((id) => ({ id, label: id }));
  const hashOptions = RSA_HASHES.map((id) => ({ id, label: id }));
  const ecdsa = isEcdsaAlgorithm(algorithm);

  // An EMPTY salt-length field means „whatever the algorithm does by default",
  // which is why it starts empty and says so. Text that is not a whole number is
  // a refusal — falling back to the default there would be indistinguishable on
  // screen from having typed a valid length, and PSS with the wrong salt length
  // produces signatures nothing else will verify.
  const saltLength = parseIntStrict(saltLengthText);
  const saltError =
    !ecdsa && saltLengthText.trim() !== "" && saltLength === null ? s.errSaltShape : undefined;

  function buildSignRequest(): SignRequest {
    if (ecdsa) return { algorithm, privatePem, message };
    return saltLength === null
      ? { algorithm, privatePem, message, hash }
      : { algorithm, privatePem, message, hash, saltLength };
  }

  function buildVerifyRequest(): VerifyRequest {
    if (ecdsa) return { algorithm, publicPem, message, signature: signatureText, encoding };
    return saltLength === null
      ? { algorithm, publicPem, message, signature: signatureText, encoding, hash }
      : { algorithm, publicPem, message, signature: signatureText, encoding, hash, saltLength };
  }

  function handleSign(): void {
    if (saltError !== undefined) return; // The field says why, and the button is disabled.
    signState.run(() => signMessage(buildSignRequest()));
  }

  function handleVerify(): void {
    if (saltError !== undefined) return;
    verifyState.run(() => verifyMessage(buildVerifyRequest()));
  }

  function handleGenerateEc(): void {
    ecState.run(
      () => generateEcKeyPair(ecCurveOf(algorithm)),
      (result) => {
        if (result.ok) {
          setPrivatePem(result.value.privatePem);
          setPublicPem(result.value.publicPem);
        }
      },
    );
  }

  return (
    <>
      <ToolSelect
        label={s.algorithm}
        value={algorithm}
        options={algorithmOptions}
        onChange={setAlgorithm}
      />
      {ecdsa ? (
        <>
          <p className="tool__note">{s.ecdsaNote}</p>
          <Button onClick={handleGenerateEc} disabled={ecState.pending}>
            {ecState.pending ? strings.devtools.crypto.shared.working : s.generateEc}
          </Button>
          {renderAsyncFailure(
            ecState.state,
            () => strings.devtools.crypto.shared.webCryptoFailure,
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      ) : (
        <div className="tool__pair">
          <ToolSelect label={s.hash} value={hash} options={hashOptions} onChange={setHash} />
          {algorithm === "RSA-PSS" && (
            <ToolInput
              label={s.saltLength}
              value={saltLengthText}
              onChange={setSaltLengthText}
              hint={s.saltHint}
              error={saltError}
              mono
            />
          )}
        </div>
      )}

      <ModeToggle
        value={tab}
        onChange={setTab}
        label={s.action}
        options={[
          { id: "sign", label: s.sign },
          { id: "verify", label: s.verify },
        ]}
      />

      {tab === "sign" ? (
        <>
          <ToolTextArea label={s.privateKey} value={privatePem} onChange={setPrivatePem} />
          <ToolTextArea label={s.message} value={message} onChange={setMessage} />
          <Button onClick={handleSign} disabled={signState.pending || saltError !== undefined}>
            {signState.pending ? strings.devtools.crypto.shared.working : s.sign}
          </Button>
          {signState.state.kind === "done" && signState.state.result.ok && (
            <div className="tool__results">
              <ResultRow label={s.hex} value={signState.state.result.value.hex} />
              <ResultRow label={s.base64} value={signState.state.result.value.base64} />
            </div>
          )}
          {renderAsyncFailure(
            signState.state,
            (failure) => describeSignatureFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      ) : (
        <>
          <ToolTextArea label={s.publicKey} value={publicPem} onChange={setPublicPem} />
          <ToolTextArea label={s.message} value={message} onChange={setMessage} />
          <div className="tool__pair">
            <ToolInput
              label={s.signatureValue}
              value={signatureText}
              onChange={setSignatureText}
              mono
            />
            <ToolSelect
              label={s.encoding}
              value={encoding}
              options={[
                { id: "hex", label: s.encodingHex },
                { id: "base64", label: s.encodingBase64 },
              ]}
              onChange={setEncoding}
            />
          </div>
          <Button onClick={handleVerify} disabled={verifyState.pending || saltError !== undefined}>
            {verifyState.pending ? strings.devtools.crypto.shared.working : s.verify}
          </Button>
          {verifyState.state.kind === "done" && verifyState.state.result.ok && (
            <Chip variant={verifyState.state.result.value.valid ? "accent" : "danger"}>
              {verifyState.state.result.value.valid ? s.valid : s.invalid}
            </Chip>
          )}
          {renderAsyncFailure(
            verifyState.state,
            (failure) => describeSignatureFailure(s, failure),
            strings.devtools.crypto.shared.webCryptoFailure,
          )}
        </>
      )}
    </>
  );
}

// ── The map ──────────────────────────────────────────────────────────────────

export const CRYPTO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "token-gen": TokenGenTool,
  "password-gen": PasswordGenTool,
  jwt: JwtTool,
  hashing: HashingTool,
  aes: AesTool,
  "rsa-keygen": RsaKeygenTool,
  "rsa-crypt": RsaCryptTool,
  signature: SignatureTool,
};
