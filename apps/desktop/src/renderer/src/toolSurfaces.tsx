import {
  addVat,
  annuityPlan,
  applyPercentChange,
  compareUnitPrices,
  convertUnit,
  extractVat,
  parseToolNumber,
  percentChange,
  percentOf,
  unitsOfKind,
  whatPercent,
  PDV_RATES,
  type UnitKind,
} from "@nexus/core";
import { Button, TextField } from "@nexus/ui";
import { useState, type ComponentType, type ReactNode } from "react";

import {
  formatToolAmount,
  formatToolNumber,
  formatToolPercent,
  formatToolUnitPrice,
} from "./toolFormat.js";
import { readStoredDefaultVatRate } from "./toolPrefs.js";
import { strings } from "./strings.js";

/**
 * The bodies of the tools „Alatke" draws — one component per `ToolRegistration`,
 * plus the map the drawer looks a tool up in.
 *
 * This is `moduleSettingsPanels.tsx` for the tool drawer, and deliberately the
 * same pairing: the catalogue is the module registry's (`manifest.tools`), this
 * is the renderer half, and `modules.test.ts` pins that the two agree. A tool
 * whose declaration this map does not know draws NOTHING rather than failing,
 * which is what lets a module be dropped from a build without the drawer
 * noticing — and it is why `ToolsPage.tsx` carries no `switch` and no list of
 * ids. Adding a tool is a declaration in `shared/modules.ts` and an entry here.
 *
 * **Nothing in this file talks to the database, the clock or the network.**
 * Every figure comes from `@nexus/core`'s pure functions, every input goes
 * through `parseToolNumber`, and a tool holds its own draft in local state that
 * is deliberately not persisted: a converter is something you use and leave,
 * and restoring yesterday's half-typed sum would be clutter pretending to be
 * memory.
 */

const s = strings.tools;

/** A unit's Serbian name, falling back to its own id — an id is at least true. */
function unitName(id: string): string {
  return s.unit[id] ?? id;
}

/** A labelled figure — the shape every result in the drawer is drawn in. */
function ResultRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="tool__result-row">
      <span className="tool__result-label">{label}</span>
      <span className="tool__result-value">{value}</span>
    </div>
  );
}

/** A `<select>` over a fixed set of options — the drawer's only dropdown shape. */
function ToolSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="tool__field">
      <span className="tool__field-label">{label}</span>
      <select
        className="tool__select"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What a converter tool is: a kind, and the pair it opens on. */
interface ConverterSpec {
  kind: UnitKind;
  from: string;
  to: string;
}

/**
 * The one converter body, used by all seven conversion tools.
 *
 * The opening pair is per-kind and chosen rather than defaulted to „the first
 * two units": these are the conversions people actually reach for — metric
 * against imperial, and for data the kB/KiB pair that the two conventions exist
 * to disambiguate. A list that opened on „milimetar → centimetar" would be
 * technically fine and would make the tool feel unconsidered.
 */
function UnitConverter({ kind, from, to }: ConverterSpec) {
  const units = unitsOfKind(kind);
  const options = units.map((unit) => ({ id: unit.id, label: unitName(unit.id) }));
  const [fromId, setFromId] = useState(from);
  const [toId, setToId] = useState(to);
  const [text, setText] = useState("1");

  const value = parseToolNumber(text);
  const result = value === null ? null : convertUnit(value, fromId, toId);
  const typedButUnreadable = text.trim() !== "" && value === null;

  return (
    <div className="tool__body">
      {kind === "data" && <p className="tool__note">{s.dataNote}</p>}
      <TextField
        label={s.convert.valueLabel}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="tool__pair">
        <ToolSelect label={s.convert.fromLabel} value={fromId} options={options} onChange={setFromId} />
        <Button
          className="tool__swap"
          aria-label={s.convert.swap}
          title={s.convert.swap}
          onClick={() => {
            setFromId(toId);
            setToId(fromId);
          }}
        >
          ⇄
        </Button>
        <ToolSelect label={s.convert.toLabel} value={toId} options={options} onChange={setToId} />
      </div>
      {typedButUnreadable ? (
        <p className="tool__error">{s.convert.invalid}</p>
      ) : result !== null ? (
        <p className="tool__figure">
          <span className="tool__figure-value">{formatToolNumber(result)}</span>
          <span className="tool__figure-unit">{unitName(toId)}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * One line of the percentage tool: two fields and an answer. Four of these make
 * the whole tool, which is why they are a component rather than four hand-rolled
 * blocks — the questions differ, the shape does not.
 */
function PercentRow({
  title,
  labelA,
  labelB,
  compute,
  format,
}: {
  title: string;
  labelA: string;
  labelB: string;
  compute: (a: number, b: number) => number | null;
  format: (value: number) => string;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const valueA = parseToolNumber(a);
  const valueB = parseToolNumber(b);
  const result = valueA === null || valueB === null ? null : compute(valueA, valueB);

  return (
    <section className="tool__section">
      <h4 className="tool__section-title">{title}</h4>
      <div className="tool__pair">
        <TextField
          label={labelA}
          value={a}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => {
            setA(event.target.value);
          }}
        />
        <TextField
          label={labelB}
          value={b}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => {
            setB(event.target.value);
          }}
        />
      </div>
      {result !== null && <p className="tool__figure-inline">{format(result)}</p>}
    </section>
  );
}

function PercentTool() {
  const p = s.percent;
  return (
    <div className="tool__body">
      <PercentRow
        title={p.ofTitle}
        labelA={p.ofPercent}
        labelB={p.ofValue}
        compute={percentOf}
        format={formatToolNumber}
      />
      <PercentRow
        title={p.whatTitle}
        labelA={p.whatPart}
        labelB={p.whatWhole}
        compute={whatPercent}
        format={formatToolPercent}
      />
      <PercentRow
        title={p.applyTitle}
        labelA={p.applyValue}
        labelB={p.applyPercent}
        compute={applyPercentChange}
        format={formatToolNumber}
      />
      <PercentRow
        title={p.changeTitle}
        labelA={p.changeFrom}
        labelB={p.changeTo}
        compute={percentChange}
        format={formatToolPercent}
      />
    </div>
  );
}

/** The two PDV rates as dropdown options — read off `PDV_RATES` so a rate cannot be named here that the law does not have. */
const PDV_RATE_OPTIONS = PDV_RATES.map((rate) => ({
  id: String(rate),
  label: rate === 10 ? s.pdv.rateReduced : s.pdv.rateStandard,
}));

const PDV_DIRECTIONS = [
  { id: "add", label: s.pdv.directionAdd },
  { id: "extract", label: s.pdv.directionExtract },
] as const;

/**
 * PDV in both directions, because a shopkeeper needs the second more often than
 * the first: the number they have is the one on the shelf, and „koliko je od
 * ovoga PDV" is not „20% od ovoga". `note` says that on screen rather than
 * leaving it to be rediscovered.
 */
function PdvTool() {
  const [text, setText] = useState("");
  const [rate, setRate] = useState(() => String(readStoredDefaultVatRate()));
  const [direction, setDirection] = useState<string>("add");

  const amount = parseToolNumber(text);
  const rateValue = Number(rate);
  const breakdown =
    amount === null ? null : direction === "add" ? addVat(amount, rateValue) : extractVat(amount, rateValue);

  return (
    <div className="tool__body">
      <TextField
        label={s.pdv.amountLabel}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="tool__pair">
        <ToolSelect label={s.pdv.rateLabel} value={rate} options={PDV_RATE_OPTIONS} onChange={setRate} />
        <ToolSelect
          label={s.pdv.directionLabel}
          value={direction}
          options={PDV_DIRECTIONS}
          onChange={setDirection}
        />
      </div>
      {breakdown !== null && (
        <div className="tool__results">
          <ResultRow label={s.pdv.netLabel} value={formatToolAmount(breakdown.net)} />
          <ResultRow label={s.pdv.vatLabel} value={formatToolAmount(breakdown.vat)} />
          <ResultRow label={s.pdv.grossLabel} value={formatToolAmount(breakdown.gross)} />
        </div>
      )}
      <p className="tool__note">{s.pdv.note}</p>
    </div>
  );
}

/**
 * The annuity. `caveat` is drawn ALWAYS, not only once a figure appears: what
 * the number assumes is part of the number, and a user who reads the instalment
 * before the caveat has already formed the wrong expectation.
 */
function LoanTool() {
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [months, setMonths] = useState("");

  const principalValue = parseToolNumber(principal);
  const rateValue = parseToolNumber(rate);
  const monthsValue = parseToolNumber(months);
  const plan =
    principalValue === null || rateValue === null || monthsValue === null
      ? null
      : annuityPlan({
          principal: principalValue,
          annualRatePercent: rateValue,
          months: monthsValue,
        });
  const allTyped = [principal, rate, months].every((text) => text.trim() !== "");

  return (
    <div className="tool__body">
      <TextField
        label={s.loan.principalLabel}
        value={principal}
        inputMode="decimal"
        autoComplete="off"
        onChange={(event) => {
          setPrincipal(event.target.value);
        }}
      />
      <div className="tool__pair">
        <TextField
          label={s.loan.rateLabel}
          value={rate}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => {
            setRate(event.target.value);
          }}
        />
        <TextField
          label={s.loan.monthsLabel}
          value={months}
          inputMode="numeric"
          autoComplete="off"
          onChange={(event) => {
            setMonths(event.target.value);
          }}
        />
      </div>
      {plan !== null ? (
        <div className="tool__results">
          <ResultRow label={s.loan.paymentLabel} value={formatToolAmount(plan.monthlyPayment)} />
          <ResultRow label={s.loan.totalPaidLabel} value={formatToolAmount(plan.totalPaid)} />
          <ResultRow label={s.loan.totalInterestLabel} value={formatToolAmount(plan.totalInterest)} />
        </div>
      ) : allTyped ? (
        <p className="tool__error">{s.loan.invalid}</p>
      ) : null}
      <p className="tool__note">{s.loan.caveat}</p>
    </div>
  );
}

/** A package row's draft — its own id, so removing the middle row does not renumber the others' React keys. */
interface OfferDraft {
  key: number;
  price: string;
  quantity: string;
}

const INITIAL_OFFERS: OfferDraft[] = [
  { key: 0, price: "", quantity: "" },
  { key: 1, price: "", quantity: "" },
];

/**
 * „Koje pakovanje je jeftinije". Two rows to begin with, because a comparison
 * needs two things to compare, and more on request.
 *
 * `note` says the one thing the tool does NOT do: it compares numbers, not
 * units, so „500 g" against „1 kg" has to be made common first. Doing that
 * silently would mean guessing which unit each row was in.
 */
function UnitPriceTool() {
  const [offers, setOffers] = useState<OfferDraft[]>(INITIAL_OFFERS);
  const [nextKey, setNextKey] = useState(INITIAL_OFFERS.length);

  function update(key: number, patch: Partial<OfferDraft>): void {
    setOffers((current) => current.map((offer) => (offer.key === key ? { ...offer, ...patch } : offer)));
  }

  const parsed = offers.map((offer) => ({
    key: offer.key,
    price: parseToolNumber(offer.price),
    quantity: parseToolNumber(offer.quantity),
  }));
  const complete = parsed.filter(
    (offer): offer is { key: number; price: number; quantity: number } =>
      offer.price !== null && offer.quantity !== null,
  );
  // Ranked only once at least two rows are fully readable — one package has
  // nothing to be cheaper than, which `compareUnitPrices` would answer with a
  // lone „najjeftinije" chip that says nothing.
  const ranked =
    complete.length >= 2
      ? compareUnitPrices(
          complete.map((offer) => ({ id: String(offer.key), price: offer.price, quantity: offer.quantity })),
        )
      : null;
  const anyTyped = offers.some((offer) => offer.price.trim() !== "" || offer.quantity.trim() !== "");

  return (
    <div className="tool__body">
      {offers.map((offer, index) => (
        <div key={offer.key} className="tool__pair">
          <TextField
            label={`${s.unitPrice.priceLabel} ${index + 1}`}
            value={offer.price}
            inputMode="decimal"
            autoComplete="off"
            onChange={(event) => {
              update(offer.key, { price: event.target.value });
            }}
          />
          <TextField
            label={`${s.unitPrice.quantityLabel} ${index + 1}`}
            value={offer.quantity}
            inputMode="decimal"
            autoComplete="off"
            onChange={(event) => {
              update(offer.key, { quantity: event.target.value });
            }}
          />
          {offers.length > 2 && (
            <Button
              className="tool__row-remove"
              aria-label={s.unitPrice.remove}
              title={s.unitPrice.remove}
              onClick={() => {
                setOffers((current) => current.filter((candidate) => candidate.key !== offer.key));
              }}
            >
              ✕
            </Button>
          )}
        </div>
      ))}
      <Button
        onClick={() => {
          setOffers((current) => [...current, { key: nextKey, price: "", quantity: "" }]);
          setNextKey((current) => current + 1);
        }}
      >
        {s.unitPrice.add}
      </Button>
      {ranked !== null ? (
        <div className="tool__results">
          {ranked.map((row) => (
            <ResultRow
              key={row.id}
              label={`${s.unitPrice.packageLabel} ${offers.findIndex((offer) => String(offer.key) === row.id) + 1}`}
              value={
                <>
                  {formatToolUnitPrice(row.unitPrice)}
                  {row.cheapest ? (
                    <span className="tool__badge">{s.unitPrice.cheapest}</span>
                  ) : (
                    <span className="tool__premium">
                      +{formatToolPercent(row.premiumPercent)} {s.unitPrice.premium}
                    </span>
                  )}
                </>
              }
            />
          ))}
        </div>
      ) : anyTyped && complete.length < offers.length ? (
        <p className="tool__error">{s.unitPrice.invalid}</p>
      ) : null}
      <p className="tool__note">{s.unitPrice.note}</p>
    </div>
  );
}

/**
 * The seven converters, each a kind plus the pair it opens on. Declared here
 * rather than in the manifest because a default dropdown selection is a RENDER
 * decision — `@nexus/core`'s table knows the units, not which two a Serbian
 * user reaches for first.
 */
const CONVERTERS: readonly (ConverterSpec & { id: string })[] = [
  { id: "duzina", kind: "length", from: "km", to: "mi" },
  { id: "masa", kind: "mass", from: "kg", to: "lb" },
  { id: "zapremina", kind: "volume", from: "l", to: "gal-us" },
  { id: "temperatura", kind: "temperature", from: "degc", to: "degf" },
  { id: "povrsina", kind: "area", from: "m2", to: "ft2" },
  { id: "brzina", kind: "speed", from: "kmh", to: "mph" },
  { id: "podaci", kind: "data", from: "mb-dec", to: "mib" },
];

/**
 * The renderer half of the `manifest.tools` pairing. Built once at module load,
 * so each converter's wrapper is a stable component type rather than a fresh
 * function on every render.
 */
export const TOOL_SURFACES: Record<string, ComponentType> = {
  ...Object.fromEntries(
    CONVERTERS.map((spec) => [
      spec.id,
      function Converter() {
        return <UnitConverter kind={spec.kind} from={spec.from} to={spec.to} />;
      },
    ]),
  ),
  procenat: PercentTool,
  pdv: PdvTool,
  kredit: LoanTool,
  "jedinicna-cena": UnitPriceTool,
};
