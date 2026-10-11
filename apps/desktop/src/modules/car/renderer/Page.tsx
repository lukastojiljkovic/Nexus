import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  TextField,
} from "@nexus/ui";
import {
  DISTANCE_UNITS,
  FAULT_STATUSES,
  FUEL_TYPES,
  SERVICE_CATEGORIES,
  fuelQuantityUnit,
  type DistanceUnit,
  type DueItem,
  type FaultStatus,
  type FuelType,
  type ServiceCategory,
} from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import {
  ConfirmDialog,
  dateTimeFormat,
  declaredText,
  formatMoneyPlain,
  numberFormat,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type {
  CarDetailView,
  CarFaultView,
  CarFuelView,
  CarIntervalView,
  CarReceiptsView,
  CarServiceView,
  CarVehicleView,
  CarView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { moneyPair, parseDecimal } from "./carView.js";
import "./car.css";

/**
 * AUTOMOBIL (ADR-090) -- the module's page: one garage, one vehicle's book, and
 * five sections about the car that is open.
 *
 * **The page calculates nothing.** Every figure it draws -- what is due and how
 * close, today's estimated odometer, the consumption, the totals -- arrives
 * finished in `CarDetailView`, computed in main over rows main read
 * (`main/register.ts` says why main and not a worker). This file turns those
 * numbers into the active locale's text, and turns typed text back into
 * numbers; the two pure rules for the second half live in `carView.ts`.
 *
 * **Sections, in the order a service book is read.** The garage first (which
 * car), then -- for the car that is open -- what is due, the odometer readings
 * the estimate rests on, the log of what was done, the intervals that say when
 * it is next due, the fuel, and the faults. Nothing on this page offers
 * maintenance advice: an interval is what the owner entered, "due" is arithmetic
 * over their own history, and a car with no history says so in words rather than
 * reporting a zero it never earned.
 *
 * **One selection, held here rather than in the shell.** Which vehicle is open
 * is a fact about this page's session, so it is state in this component: the
 * shell knows the module, not which car somebody was looking at.
 */

/** A whole count in the active locale's grouping („12.345" / "12,345"). */
function count(value: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(value);
}

/** A distance, with the vehicle's own unit beside it -- the unit is the VEHICLE's, never the locale's. */
function distance(value: number, unit: DistanceUnit): string {
  return `${count(value)} ${unit}`;
}

/** A number with a stated number of fraction digits: consumption, quantities. */
function decimal(value: number, digits: number): string {
  return numberFormat({ maximumFractionDigits: digits }).format(value);
}

/** A bare calendar day as the locale writes it („8. jul 2026." / "8 July 2026"). */
function day(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : dateTimeFormat({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
        date,
      );
}

/** A bare `YYYY-MM-DD` as an `<input type="date">` reads and writes it, and as the store speaks it. */
function isBareDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Fills a sentence's `{name}` holes. One helper, so no call site forgets one. */
function fill(text: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (sentence, [hole, value]) => sentence.replace(`{${hole}}`, value),
    text,
  );
}

/** The status chip a due item wears: the WORD carries the state, and the tone only repeats it (the Redundancy Rule). */
function dueChip(item: DueItem): ReactElement {
  if (item.status === "overdue") return <Chip variant="danger">{copy.due.overdue}</Chip>;
  if (item.status === "soon") return <Chip variant="accent">{copy.due.soon}</Chip>;
  return <Chip variant="data">{copy.due.ok}</Chip>;
}

/**
 * One due row's remaining figure in words.
 *
 * The two halves are stated separately and never converted into each other:
 * days and kilometres have no exchange rate this module is entitled to invent
 * (`whatIsDue` says the same about its own ordering), so a row judged by both
 * says both, and the half that decided the status is named.
 */
function dueRemaining(item: DueItem, unit: DistanceUnit): string {
  const parts: string[] = [];
  if (item.remainingDays !== null) {
    parts.push(remaining(item.remainingDays, copy.due.days));
  }
  if (item.remainingDistance !== null) {
    parts.push(remaining(item.remainingDistance, fill(copy.due.units, { unit })));
  }
  if (parts.length === 0) return copy.due.noHistory;
  if (item.status === "ok") return parts.join(" · ");
  const by = item.by === "distance" ? copy.due.byDistance : copy.due.byDate;
  return `${parts.join(" · ")} — ${by}`;
}

/** „još 12 dana" / „12 dana je prošlo": the count is the locale's, the sentence is the table's. */
function remaining(value: number, phrase: string): string {
  const template = value < 0 ? copy.due.passed : copy.due.left;
  return fill(template, { value: count(Math.abs(value)), phrase });
}

export default function CarPage({ profileId }: ModulePageProps) {
  const [garage, setGarage] = useState<CarView | null>(null);
  const [detail, setDetail] = useState<CarDetailView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** One read of the garage, into state. */
  const refreshGarage = useCallback(async () => {
    try {
      setGarage(await window.nexus.modules.car.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the garage could not be loaded:", failure);
    }
  }, [profileId]);

  /** One read of the open vehicle's book. */
  const refreshDetail = useCallback(
    async (vehicleId: string) => {
      try {
        setDetail(await window.nexus.modules.car.detail({ profileId, vehicleId }));
        setError(null);
      } catch (failure) {
        setError(copy.errors.load);
        console.error("Nexus: the vehicle could not be loaded:", failure);
      }
    },
    [profileId],
  );

  useEffect(() => {
    void refreshGarage();
  }, [refreshGarage]);

  useEffect(() => {
    if (selected === null) {
      setDetail(null);
      return;
    }
    void refreshDetail(selected);
  }, [selected, refreshDetail]);

  /**
   * A garage mutation: the answer is the whole garage. Which car was just added
   * is the one id the list did not carry before, and there is exactly one such
   * id because a create makes exactly one vehicle -- so the new car opens on the
   * read that follows rather than leaving the user to find it.
   */
  const runGarage = useCallback(
    async (action: (car: typeof window.nexus.modules.car) => Promise<CarView>) => {
      try {
        const before = new Set((garage?.vehicles ?? []).map((vehicle) => vehicle.id));
        const view = await action(window.nexus.modules.car);
        setGarage(view);
        setNotice(null);
        setError(null);
        const added = view.vehicles.find((vehicle) => !before.has(vehicle.id));
        if (added !== undefined) setSelected(added.id);
        if (selected !== null && !view.vehicles.some((vehicle) => vehicle.id === selected)) {
          setSelected(null);
        }
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a garage change failed:", failure);
      }
    },
    [garage, selected],
  );

  /**
   * A vehicle mutation: the answer is that vehicle's whole book -- or, for a
   * receipt pick, the pick's own outcome beside it. The one place a result is
   * read rather than stored, because "three of the four files were too large" is
   * something the user has to be told.
   */
  const runDetail = useCallback(
    async (
      action: (
        car: typeof window.nexus.modules.car,
      ) => Promise<CarDetailView | CarReceiptsView>,
    ) => {
      try {
        const answer = await action(window.nexus.modules.car);
        if ("detail" in answer) {
          setDetail(answer.detail);
          setNotice(
            answer.result.canceled || answer.result.skippedTooLarge === 0
              ? null
              : fill(copy.log.skipped, { value: count(answer.result.skippedTooLarge) }),
          );
        } else {
          setDetail(answer);
          setNotice(null);
        }
        setError(null);
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a change was not saved:", failure);
      }
    },
    [],
  );

  const vehicles = garage?.vehicles ?? [];
  const open = detail?.vehicle ?? null;

  return (
    <div className="car">
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="car"
      />
      {error !== null && (
        <p className="car__error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="car__notice" role="status">
          {notice}
        </p>
      )}
      {garage === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={5} />
      ) : (
        <>
          <GarageSection
            profileId={profileId}
            vehicles={vehicles}
            selected={selected}
            onSelect={setSelected}
            run={runGarage}
          />
          {open !== null && detail !== null && (
            <>
              <DueCard
                detail={detail}
                thresholds={garage.settings}
                onSetThresholds={(dueSoonDays, dueSoonDistance) =>
                  void runGarage((car) =>
                    car.setThresholds({ profileId, dueSoonDays, dueSoonDistance }),
                  )
                }
              />
              <ReadingsCard profileId={profileId} detail={detail} run={runDetail} />
              <ServiceCard profileId={profileId} detail={detail} run={runDetail} />
              <IntervalCard profileId={profileId} detail={detail} run={runDetail} />
              <FuelCard profileId={profileId} detail={detail} run={runDetail} />
              <CostsCard detail={detail} />
              <FaultsCard profileId={profileId} detail={detail} run={runDetail} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// --- Garage ------------------------------------------------------------------

type GarageRun = (action: (car: typeof window.nexus.modules.car) => Promise<CarView>) => void;
type DetailRun = (
  action: (
    car: typeof window.nexus.modules.car,
  ) => Promise<CarDetailView | CarReceiptsView>,
) => void;

/** The fields both forms collect, in the shape the two vehicle ops take. */
interface VehicleFieldsForm {
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string;
  vin: string;
  fuelType: FuelType;
  distanceUnit: DistanceUnit;
  notes: string;
}

function GarageSection({
  profileId,
  vehicles,
  selected,
  onSelect,
  run,
}: {
  profileId: string;
  vehicles: readonly CarVehicleView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  run: GarageRun;
}) {
  /** Which form is open: a new car, the open car's fields, or nothing. */
  const [editing, setEditing] = useState<"new" | "open" | null>(null);
  const [removing, setRemoving] = useState<CarVehicleView | null>(null);
  const open = vehicles.find((vehicle) => vehicle.id === selected) ?? null;

  return (
    <Card className="car__card" title={copy.garage.title}>
      {vehicles.length === 0 && editing === null ? (
        <EmptyState
          sigil="car"
          title={copy.garage.emptyTitle}
          description={copy.garage.emptyBody}
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              {copy.garage.add}
            </Button>
          }
        />
      ) : (
        <div className="car__list">
          {vehicles.map((vehicle) => (
            <ListRow
              key={vehicle.id}
              muted={vehicle.archivedAt !== null}
              leading={<Icon name="car" />}
              onClick={() => onSelect(vehicle.id === selected ? null : vehicle.id)}
              className={vehicle.id === selected ? "car__row--open" : undefined}
              trailing={
                <span className="car__row-actions">
                  {vehicle.archivedAt !== null && <Chip>{copy.garage.archived}</Chip>}
                  <Button
                    size="sm"
                    onClick={() =>
                      void run((car) =>
                        vehicle.archivedAt === null
                          ? car.archiveVehicle({ profileId, id: vehicle.id })
                          : car.unarchiveVehicle({ profileId, id: vehicle.id }),
                      )
                    }
                  >
                    {vehicle.archivedAt === null ? copy.garage.archive : copy.garage.unarchive}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setRemoving(vehicle)}>
                    {copy.garage.remove}
                  </Button>
                </span>
              }
            >
              <span className="car__row-name">{vehicle.name}</span>
              <span className="car__row-facts">
                {`${vehicle.make} ${vehicle.model} · ${vehicle.year}`}
                {vehicle.plate === null ? "" : ` · ${vehicle.plate}`}
              </span>
            </ListRow>
          ))}
        </div>
      )}

      <div className="car__actions">
        {editing === null && (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            {copy.garage.add}
          </Button>
        )}
        {open !== null && editing === null && (
          <Button size="sm" onClick={() => setEditing("open")}>
            {copy.garage.edit}
          </Button>
        )}
      </div>

      {editing !== null && (
        <VehicleForm
          // A key per target, so switching between „new" and the open car's
          // fields starts the form from THAT target's values rather than from
          // whatever was typed into the other one.
          key={editing === "new" ? "new" : (open?.id ?? "open")}
          vehicle={editing === "new" ? null : open}
          onCancel={() => setEditing(null)}
          onSubmit={(fields) => {
            setEditing(null);
            if (editing === "new") {
              void run((car) => car.createVehicle({ profileId, ...fields }));
            } else if (open !== null) {
              void run((car) => car.updateVehicle({ profileId, id: open.id, fields }));
            }
          }}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title={copy.garage.removeTitle}
          name={removing.name}
          question={copy.garage.removeQuestion}
          note={copy.garage.removeNote}
          confirmLabel={copy.garage.removeConfirm}
          cancelLabel={copy.garage.cancel}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            if (id === selected) onSelect(null);
            void run((car) => car.removeVehicle({ profileId, id }));
          }}
        />
      )}
    </Card>
  );
}

/** Everything a vehicle is, in one form -- used for a new car and for the open car's own fields. */
function VehicleForm({
  vehicle,
  onSubmit,
  onCancel,
}: {
  vehicle: CarVehicleView | null;
  onSubmit: (fields: VehicleFieldsForm) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(vehicle?.name ?? "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(vehicle === null ? "" : String(vehicle.year));
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [vin, setVin] = useState(vehicle?.vin ?? "");
  const [fuelType, setFuelType] = useState<FuelType>(vehicle?.fuelType ?? "petrol");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(vehicle?.distanceUnit ?? "km");
  const [notes, setNotes] = useState(vehicle?.notes ?? "");
  const [problem, setProblem] = useState<"name" | "year" | null>(null);

  return (
    <div className="car__form">
      <div className="car__grid">
        <TextField
          label={copy.garage.name}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={copy.garage.make}
          value={make}
          maxLength={60}
          onChange={(event) => setMake(event.target.value)}
        />
        <TextField
          label={copy.garage.model}
          value={model}
          maxLength={60}
          onChange={(event) => setModel(event.target.value)}
        />
        <TextField
          label={copy.garage.year}
          inputMode="numeric"
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
        <TextField
          label={copy.garage.plate}
          value={plate}
          maxLength={20}
          onChange={(event) => setPlate(event.target.value)}
        />
        <TextField
          label={copy.garage.vin}
          value={vin}
          maxLength={17}
          onChange={(event) => setVin(event.target.value)}
        />
        <Select
          label={copy.garage.fuelType}
          value={fuelType}
          onChange={(event) => setFuelType(event.target.value as FuelType)}
        >
          {FUEL_TYPES.map((type) => (
            <option key={type} value={type}>
              {copy.fuelTypes[type]}
            </option>
          ))}
        </Select>
        <Select
          label={copy.garage.distanceUnit}
          value={distanceUnit}
          onChange={(event) => setDistanceUnit(event.target.value as DistanceUnit)}
        >
          {DISTANCE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {copy.units[unit]}
            </option>
          ))}
        </Select>
      </div>
      <TextArea
        label={copy.garage.notes}
        rows={2}
        maxLength={2000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <p className="nx-hint">{copy.garage.vinHint}</p>
      {problem === "name" && <p className="car__field-error">{copy.errors.name}</p>}
      {problem === "year" && <p className="car__field-error">{copy.errors.year}</p>}
      <div className="car__actions">
        <Button
          variant="primary"
          onClick={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setProblem("name");
              return;
            }
            const parsedYear = Number.parseInt(year.trim(), 10);
            if (!Number.isInteger(parsedYear)) {
              setProblem("year");
              return;
            }
            setProblem(null);
            onSubmit({
              name: trimmed,
              make: make.trim(),
              model: model.trim(),
              year: parsedYear,
              plate: plate.trim(),
              vin: vin.trim(),
              fuelType,
              distanceUnit,
              notes: notes.trim(),
            });
          }}
        >
          {vehicle === null ? copy.garage.add : copy.garage.save}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.garage.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- What is due -------------------------------------------------------------

function DueCard({
  detail,
  thresholds,
  onSetThresholds,
}: {
  detail: CarDetailView;
  thresholds: CarView["settings"];
  onSetThresholds: (days: number, distance: number) => void;
}) {
  const [days, setDays] = useState(String(thresholds.dueSoonDays));
  const [distanceValue, setDistanceValue] = useState(String(thresholds.dueSoonDistance));
  const unit = detail.vehicle.distanceUnit;

  return (
    <Card className="car__card" title={copy.due.title}>
      <p className="nx-hint">{copy.due.rule}</p>
      {detail.due.length === 0 ? (
        <EmptyState variant="inline" title={copy.due.empty} />
      ) : (
        <div className="car__list">
          {detail.due.map((item) => (
            <ListRow
              key={item.category}
              leading={<Icon name="clock" />}
              trailing={dueChip(item)}
              muted={item.status === "ok"}
            >
              <span className="car__row-name">{copy.categories[item.category]}</span>
              <span className="car__row-facts">{dueRemaining(item, unit)}</span>
            </ListRow>
          ))}
        </div>
      )}
      <div className="car__row">
        <TextField
          label={copy.due.daysLabel}
          inputMode="numeric"
          className="car__field"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
        <TextField
          label={fill(copy.due.unitsLabel, { unit })}
          inputMode="numeric"
          className="car__field"
          value={distanceValue}
          onChange={(event) => setDistanceValue(event.target.value)}
        />
        <Button
          size="sm"
          onClick={() => {
            const parsedDays = Number.parseInt(days.trim(), 10);
            const parsedDistance = Number.parseInt(distanceValue.trim(), 10);
            if (!Number.isInteger(parsedDays) || !Number.isInteger(parsedDistance)) return;
            onSetThresholds(parsedDays, parsedDistance);
          }}
        >
          {copy.due.saveThresholds}
        </Button>
      </div>
      <p className="nx-hint">
        {`${copy.due.thresholdsNow} ${copy.due.left
          .replace("{value}", count(thresholds.dueSoonDays))
          .replace("{phrase}", copy.due.days)} · ${copy.due.left
          .replace("{value}", distance(thresholds.dueSoonDistance, unit))
          .replace("{phrase}", copy.due.units.replace("{unit}", ""))}`}
      </p>
    </Card>
  );
}

// --- Odometer ----------------------------------------------------------------

function ReadingsCard({
  profileId,
  detail,
  run,
}: {
  profileId: string;
  detail: CarDetailView;
  run: DetailRun;
}) {
  const [date, setDate] = useState("");
  const [value, setValue] = useState("");
  const [newSegment, setNewSegment] = useState(false);
  const [problem, setProblem] = useState<"date" | "value" | null>(null);
  const unit = detail.vehicle.distanceUnit;

  return (
    <Card className="car__card" title={copy.readings.title}>
      <p className="nx-hint">{copy.readings.hint}</p>
      {detail.estimatedOdometer !== null && (
        <p className="car__estimate">
          {`${copy.readings.estimated} ${distance(Math.round(detail.estimatedOdometer), unit)}`}
        </p>
      )}
      {detail.readings.length === 0 ? (
        <EmptyState variant="inline" title={copy.readings.empty} />
      ) : (
        <div className="car__list">
          {detail.readings.map((reading) => (
            <ListRow
              key={reading.id}
              leading={<Icon name="trendUp" />}
              trailing={
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() =>
                    void run((car) =>
                      car.removeReading({ profileId, vehicleId: detail.vehicle.id, id: reading.id }),
                    )
                  }
                >
                  {copy.readings.remove}
                </Button>
              }
            >
              <span className="car__row-name">{distance(reading.reading, unit)}</span>
              <span className="car__row-facts">
                {`${day(reading.date)} · ${fill(copy.readings.segment, { n: count(reading.segment) })}`}
              </span>
            </ListRow>
          ))}
        </div>
      )}
      <div className="car__form">
        <div className="car__row">
          <TextField
            type="date"
            label={copy.readings.date}
            className="car__field"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <TextField
            label={fill(copy.readings.value, { unit })}
            inputMode="numeric"
            className="car__field"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const reading = parseDecimal(value);
              if (!isBareDay(date)) {
                setProblem("date");
                return;
              }
              if (reading === null || !Number.isInteger(reading) || reading < 0) {
                setProblem("value");
                return;
              }
              setProblem(null);
              const enteredDate = date;
              const startsNewSegment = newSegment;
              setDate("");
              setValue("");
              setNewSegment(false);
              void run((car) =>
                car.addReading({
                  profileId,
                  vehicleId: detail.vehicle.id,
                  date: enteredDate,
                  reading,
                  startsNewSegment,
                }),
              );
            }}
          >
            {copy.readings.add}
          </Button>
        </div>
        <Checkbox checked={newSegment} onChange={(event) => setNewSegment(event.target.checked)}>
          {copy.readings.newSegment}
        </Checkbox>
        {problem === "date" && <p className="car__field-error">{copy.errors.date}</p>}
        {problem === "value" && <p className="car__field-error">{copy.errors.odometer}</p>}
      </div>
    </Card>
  );
}

// --- Service log -------------------------------------------------------------

/** What a service entry form collects, in the shape the op takes. */
interface ServiceFieldsForm {
  date: string;
  odometer: number | null;
  category: ServiceCategory;
  description: string;
  costMinor: number | null;
  currency: string | null;
  workshop: string | null;
  parts: string | null;
}

function ServiceCard({
  profileId,
  detail,
  run,
}: {
  profileId: string;
  detail: CarDetailView;
  run: DetailRun;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card className="car__card" title={copy.log.title}>
      <p className="nx-hint">{copy.log.hint}</p>
      {detail.services.length === 0 ? (
        <EmptyState variant="inline" title={copy.log.empty} />
      ) : (
        <div className="car__list">
          {detail.services.map((service) => (
            <ServiceRow
              key={service.id}
              profileId={profileId}
              vehicleId={detail.vehicle.id}
              service={service}
              run={run}
            />
          ))}
        </div>
      )}
      <div className="car__actions">
        {!adding && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            {copy.log.add}
          </Button>
        )}
      </div>
      {adding && (
        <ServiceForm
          unit={detail.vehicle.distanceUnit}
          onCancel={() => setAdding(false)}
          onSubmit={(fields) => {
            setAdding(false);
            void run((car) =>
              car.addService({ profileId, vehicleId: detail.vehicle.id, ...fields }),
            );
          }}
        />
      )}
    </Card>
  );
}

function ServiceRow({
  profileId,
  vehicleId,
  service,
  run,
}: {
  profileId: string;
  vehicleId: string;
  service: CarServiceView;
  run: DetailRun;
}) {
  return (
    <div className="car__service">
      <ListRow
        leading={<Icon name="check" />}
        trailing={
          <span className="car__row-actions">
            <Chip>{copy.categories[service.category]}</Chip>
            {service.costMinor !== null && service.currency !== null && (
              <span className="car__money">
                {`${formatMoneyPlain(service.costMinor, service.currency)} ${service.currency}`}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void run((car) => car.attachReceipts({ profileId, vehicleId, serviceId: service.id }))}
            >
              {copy.log.attach}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                void run((car) => car.removeService({ profileId, vehicleId, id: service.id }))
              }
            >
              {copy.log.remove}
            </Button>
          </span>
        }
      >
        <span className="car__row-name">{service.description}</span>
        <span className="car__row-facts">
          {[day(service.date), service.odometer === null ? null : count(service.odometer), service.workshop]
            .filter((part): part is string => part !== null && part !== "")
            .join(" · ")}
        </span>
      </ListRow>
      {service.receipts.length === 0 ? (
        <p className="nx-hint">{copy.log.noReceipts}</p>
      ) : (
        <div className="car__receipts">
          {service.receipts.map((receipt) => (
            <ListRow
              key={receipt.id}
              leading={<Icon name="attach" />}
              trailing={
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() =>
                    void run((car) =>
                      car.removeReceipt({
                        profileId,
                        vehicleId,
                        serviceId: service.id,
                        id: receipt.id,
                      }),
                    )
                  }
                >
                  {copy.log.removeReceipt}
                </Button>
              }
            >
              <span className="car__row-name">{receipt.fileName}</span>
              <span className="car__row-facts">{`${receipt.mime} · ${count(Math.round(receipt.sizeBytes / 1024))} kB`}</span>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}

/** The service form: what was done, where, for how much, and at which odometer. */
function ServiceForm({
  unit,
  onSubmit,
  onCancel,
}: {
  unit: DistanceUnit;
  onSubmit: (fields: ServiceFieldsForm) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState("");
  const [category, setCategory] = useState<ServiceCategory>(SERVICE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [odometer, setOdometer] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("");
  const [workshop, setWorkshop] = useState("");
  const [parts, setParts] = useState("");
  const [problem, setProblem] = useState<"date" | "description" | "money" | "odometer" | null>(null);

  return (
    <div className="car__form">
      <div className="car__grid">
        <TextField
          type="date"
          label={copy.log.date}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Select
          label={copy.log.category}
          value={category}
          onChange={(event) => setCategory(event.target.value as ServiceCategory)}
        >
          {SERVICE_CATEGORIES.map((each) => (
            <option key={each} value={each}>
              {copy.categories[each]}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.log.description}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />
        <TextField
          label={fill(copy.log.odometer, { unit })}
          inputMode="numeric"
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
        />
        <TextField
          label={copy.log.cost}
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
        <TextField
          label={copy.log.currency}
          value={currency}
          maxLength={3}
          onChange={(event) => setCurrency(event.target.value)}
        />
        <TextField
          label={copy.log.workshop}
          value={workshop}
          maxLength={120}
          onChange={(event) => setWorkshop(event.target.value)}
        />
        <TextField
          label={copy.log.parts}
          value={parts}
          maxLength={500}
          onChange={(event) => setParts(event.target.value)}
        />
      </div>
      <p className="nx-hint">{copy.log.currencyHint}</p>
      {problem === "date" && <p className="car__field-error">{copy.errors.date}</p>}
      {problem === "description" && <p className="car__field-error">{copy.errors.description}</p>}
      {problem === "odometer" && <p className="car__field-error">{copy.errors.odometer}</p>}
      {problem === "money" && <p className="car__field-error">{copy.errors.money}</p>}
      <div className="car__actions">
        <Button
          variant="primary"
          onClick={() => {
            if (!isBareDay(date)) {
              setProblem("date");
              return;
            }
            if (description.trim().length === 0) {
              setProblem("description");
              return;
            }
            const parsedOdometer = odometer.trim() === "" ? null : parseDecimal(odometer);
            if (parsedOdometer !== null && (!Number.isInteger(parsedOdometer) || parsedOdometer < 0)) {
              setProblem("odometer");
              return;
            }
            const paid = moneyPair(cost, currency);
            if (paid === null) {
              setProblem("money");
              return;
            }
            setProblem(null);
            onSubmit({
              date,
              category,
              description: description.trim(),
              odometer: parsedOdometer,
              costMinor: paid.costMinor,
              currency: paid.currency,
              workshop: workshop.trim() === "" ? null : workshop.trim(),
              parts: parts.trim() === "" ? null : parts.trim(),
            });
          }}
        >
          {copy.log.save}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.log.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- Intervals ---------------------------------------------------------------

function IntervalCard({
  profileId,
  detail,
  run,
}: {
  profileId: string;
  detail: CarDetailView;
  run: DetailRun;
}) {
  const unit = detail.vehicle.distanceUnit;
  return (
    <Card className="car__card" title={copy.intervals.title}>
      <p className="nx-hint">{copy.intervals.hint}</p>
      <div className="car__list">
        {SERVICE_CATEGORIES.map((category) => (
          <IntervalRow
            key={category}
            category={category}
            unit={unit}
            interval={detail.intervals.find((row) => row.category === category) ?? null}
            onSet={(everyKm, everyMonths) =>
              void run((car) =>
                car.setInterval({
                  profileId,
                  vehicleId: detail.vehicle.id,
                  category,
                  everyKm,
                  everyMonths,
                }),
              )
            }
            onClear={() =>
              void run((car) =>
                car.clearInterval({
                  profileId,
                  vehicleId: detail.vehicle.id,
                  category,
                }),
              )
            }
          />
        ))}
      </div>
    </Card>
  );
}

/**
 * One category's interval: a distance, a period, or both.
 *
 * Two fields and one Save rather than a live edit: the row is ONE fact, and a
 * form that saved a distance while the period was still being typed would compute
 * a due date from half of what the user meant.
 */
function IntervalRow({
  category,
  unit,
  interval,
  onSet,
  onClear,
}: {
  category: ServiceCategory;
  unit: DistanceUnit;
  interval: CarIntervalView | null;
  onSet: (everyKm: number | null, everyMonths: number | null) => void;
  onClear: () => void;
}) {
  const [km, setKm] = useState(interval?.everyKm === null ? "" : String(interval?.everyKm ?? ""));
  const [months, setMonths] = useState(
    interval?.everyMonths === null ? "" : String(interval?.everyMonths ?? ""),
  );
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="car__interval">
      <span className="car__interval-name">{copy.categories[category]}</span>
      <TextField
        label={fill(copy.intervals.everyKm, { unit })}
        inputMode="numeric"
        className="car__field"
        value={km}
        onChange={(event) => setKm(event.target.value)}
      />
      <TextField
        label={copy.intervals.everyMonths}
        inputMode="numeric"
        className="car__field"
        value={months}
        onChange={(event) => setMonths(event.target.value)}
      />
      <Button
        size="sm"
        onClick={() => {
          const everyKm = km.trim() === "" ? null : parseDecimal(km);
          const everyMonths = months.trim() === "" ? null : parseDecimal(months);
          const usable = (value: number | null): boolean =>
            value === null || (Number.isInteger(value) && value > 0);
          if (everyKm === null && everyMonths === null) {
            setMessage(copy.intervals.problem);
            return;
          }
          if (!usable(everyKm) || !usable(everyMonths)) {
            setMessage(copy.errors.integer);
            return;
          }
          setMessage(null);
          onSet(everyKm, everyMonths);
        }}
      >
        {copy.intervals.save}
      </Button>
      <Button
        size="sm"
        variant="quiet"
        disabled={interval === null}
        onClick={() => {
          setKm("");
          setMonths("");
          onClear();
        }}
      >
        {copy.intervals.clear}
      </Button>
      {message !== null && <p className="car__field-error">{message}</p>}
    </div>
  );
}

// --- Fuel --------------------------------------------------------------------

function FuelCard({
  profileId,
  detail,
  run,
}: {
  profileId: string;
  detail: CarDetailView;
  run: DetailRun;
}) {
  const unit = detail.vehicle.distanceUnit;
  const quantity = fuelQuantityUnit(detail.vehicle.fuelType);
  const [adding, setAdding] = useState(false);
  const costs = new Map(detail.costs.fuel.map((cost) => [cost.fuelId, cost]));

  return (
    <Card className="car__card" title={copy.fuel.title}>
      {/* The rule the figures rest on, in one sentence: consumption is measured
          full tank to full tank, and a stretch nobody bounded is absent rather
          than averaged in. */}
      <p className="nx-hint">{copy.fuel.rule}</p>
      {detail.consumption.overall === null ? (
        <EmptyState variant="inline" title={copy.fuel.noMeasure} />
      ) : (
        <div className="car__figures">
          <span className="car__figure">
            {`${copy.fuel.per100} ${decimal(detail.consumption.overall.per100Km, 1)} ${quantity}/100 km`}
          </span>
          {detail.consumption.overall.mpg !== null && (
            <span className="car__figure">
              {`${copy.fuel.mpg} ${decimal(detail.consumption.overall.mpg, 1)}`}
            </span>
          )}
          <span className="car__figure">
            {`${copy.fuel.segments} ${count(detail.consumption.segments.length)}`}
          </span>
        </div>
      )}
      {detail.fuel.length === 0 ? (
        <EmptyState variant="inline" title={copy.fuel.empty} />
      ) : (
        <div className="car__list">
          {detail.fuel.map((entry) => (
            <FuelRow
              key={entry.id}
              entry={entry}
              cost={costs.get(entry.id) ?? null}
              unit={unit}
              quantityUnit={quantity}
              onRemove={() =>
                void run((car) =>
                  car.removeFuel({ profileId, vehicleId: detail.vehicle.id, id: entry.id }),
                )
              }
            />
          ))}
        </div>
      )}
      <div className="car__actions">
        {!adding && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            {copy.fuel.add}
          </Button>
        )}
      </div>
      {adding && (
        <FuelForm
          unit={unit}
          quantityUnit={quantity}
          onCancel={() => setAdding(false)}
          onSubmit={(fields) => {
            setAdding(false);
            void run((car) =>
              car.addFuel({ profileId, vehicleId: detail.vehicle.id, ...fields }),
            );
          }}
        />
      )}
    </Card>
  );
}

function FuelRow({
  entry,
  cost,
  unit,
  quantityUnit,
  onRemove,
}: {
  entry: CarFuelView;
  cost: { costMinor: number; currency: string } | null;
  unit: DistanceUnit;
  quantityUnit: string;
  onRemove: () => void;
}) {
  return (
    <ListRow
      leading={<Icon name="wallet" />}
      trailing={
        <span className="car__row-actions">
          {cost !== null && (
            <span className="car__money">{`${formatMoneyPlain(cost.costMinor, cost.currency)} ${cost.currency}`}</span>
          )}
          {entry.fullTank && <Chip variant="data">{copy.fuel.full}</Chip>}
          <Button size="sm" variant="quiet" onClick={onRemove}>
            {copy.fuel.remove}
          </Button>
        </span>
      }
    >
      <span className="car__row-name">
        {`${decimal(entry.quantity, 2)} ${quantityUnit} · ${day(entry.date)}`}
      </span>
      <span className="car__row-facts">
        {entry.odometer === null ? copy.fuel.noOdometer : distance(entry.odometer, unit)}
      </span>
    </ListRow>
  );
}

/** What a fill form collects, in the shape the op takes. */
interface FuelFieldsForm {
  date: string;
  odometer: number | null;
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
}

function FuelForm({
  unit,
  quantityUnit,
  onSubmit,
  onCancel,
}: {
  unit: DistanceUnit;
  quantityUnit: string;
  onSubmit: (fields: FuelFieldsForm) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [odometer, setOdometer] = useState("");
  const [price, setPrice] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("");
  const [fullTank, setFullTank] = useState(true);
  const [problem, setProblem] = useState<"date" | "quantity" | "money" | "odometer" | null>(null);

  return (
    <div className="car__form">
      <div className="car__grid">
        <TextField
          type="date"
          label={copy.fuel.date}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label={fill(copy.fuel.quantity, { unit: quantityUnit })}
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <TextField
          label={fill(copy.fuel.odometer, { unit })}
          inputMode="numeric"
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
        />
        <TextField
          label={fill(copy.fuel.price, { unit: quantityUnit })}
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <TextField
          label={copy.fuel.total}
          inputMode="decimal"
          value={total}
          onChange={(event) => setTotal(event.target.value)}
        />
        <TextField
          label={copy.fuel.currency}
          value={currency}
          maxLength={3}
          onChange={(event) => setCurrency(event.target.value)}
        />
      </div>
      <Checkbox checked={fullTank} onChange={(event) => setFullTank(event.target.checked)}>
        {copy.fuel.fullTank}
      </Checkbox>
      <p className="nx-hint">{copy.fuel.priceHint}</p>
      {problem === "date" && <p className="car__field-error">{copy.errors.date}</p>}
      {problem === "quantity" && <p className="car__field-error">{copy.errors.quantity}</p>}
      {problem === "odometer" && <p className="car__field-error">{copy.errors.odometer}</p>}
      {problem === "money" && <p className="car__field-error">{copy.errors.money}</p>}
      <div className="car__actions">
        <Button
          variant="primary"
          onClick={() => {
            if (!isBareDay(date)) {
              setProblem("date");
              return;
            }
            const litres = parseDecimal(quantity);
            if (litres === null || litres <= 0) {
              setProblem("quantity");
              return;
            }
            const parsedOdometer = odometer.trim() === "" ? null : parseDecimal(odometer);
            if (parsedOdometer !== null && (!Number.isInteger(parsedOdometer) || parsedOdometer < 0)) {
              setProblem("odometer");
              return;
            }
            const per = moneyPair(price, currency);
            const paid = moneyPair(total, currency);
            if (per === null || paid === null) {
              setProblem("money");
              return;
            }
            setProblem(null);
            onSubmit({
              date,
              quantity: litres,
              odometer: parsedOdometer,
              fullTank,
              pricePerUnitMinor: per.costMinor,
              totalMinor: paid.costMinor,
              currency: per.currency ?? paid.currency,
            });
          }}
        >
          {copy.fuel.save}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.log.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- Faults ------------------------------------------------------------------

/**
 * What the book cost, by month and by kind.
 *
 * **A total never crosses currencies, and this is where that rule is visible.**
 * There is no exchange rate in this app, so each currency keeps its own row
 * (`@nexus/core`'s `costs.ts` says why) -- and the amounts are printed with their
 * code rather than a symbol, because two currencies can share a symbol and a
 * figure that could be either is worse than no figure.
 *
 * A month nobody spent anything in is ABSENT rather than a row of zeroes: the
 * engine drops it, and inventing a zero here would be inventing a fact about
 * somebody's month.
 */
function CostsCard({ detail }: { detail: CarDetailView }) {
  const { byCategory, byMonth } = detail.costs;

  return (
    <Card className="car__card" title={copy.costs.title}>
      <p className="nx-hint">{copy.costs.hint}</p>
      {byCategory.length === 0 && byMonth.length === 0 ? (
        <EmptyState variant="inline" title={copy.costs.empty} />
      ) : (
        <div className="car__figures-cols">
          <div className="car__list">
            <div className="nx-eyebrow">{copy.costs.byMonth}</div>
            {byMonth.map((total) => (
              <ListRow
                key={`${total.month}|${total.currency}`}
                trailing={
                  <span className="car__money">
                    {`${formatMoneyPlain(total.minorUnits, total.currency)} ${total.currency}`}
                  </span>
                }
              >
                <span className="car__row-name">{monthLabel(total.month)}</span>
                <span className="car__row-facts">
                  {fill(copy.costs.count, { value: count(total.count) })}
                </span>
              </ListRow>
            ))}
          </div>
          <div className="car__list">
            <div className="nx-eyebrow">{copy.costs.byCategory}</div>
            {byCategory.map((total) => (
              <ListRow
                key={`${total.category}|${total.currency}`}
                trailing={
                  <span className="car__money">
                    {`${formatMoneyPlain(total.minorUnits, total.currency)} ${total.currency}`}
                  </span>
                }
              >
                <span className="car__row-name">
                  {/* Fuel is a COST without being a service (`CarCostCategory`),
                      so it has no row in the service vocabulary and names
                      itself here. */}
                  {total.category === "fuel"
                    ? copy.costs.fuelCategory
                    : copy.categories[total.category]}
                </span>
                <span className="car__row-facts">
                  {fill(copy.costs.count, { value: count(total.count) })}
                </span>
              </ListRow>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/** „jul 2026." / "July 2026" -- a `YYYY-MM` key as the locale writes a month. */
function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : dateTimeFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

// --- Faults ------------------------------------------------------------------

/** What a fault form collects, in the shape the op takes. */
interface FaultFieldsForm {
  date: string;
  symptom: string;
  status: FaultStatus;
  fixNotes: string | null;
  serviceId: string | null;
}

function FaultsCard({
  profileId,
  detail,
  run,
}: {
  profileId: string;
  detail: CarDetailView;
  run: DetailRun;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="car__card" title={copy.faults.title}>
      {detail.faults.length === 0 ? (
        <EmptyState variant="inline" title={copy.faults.empty} />
      ) : (
        <div className="car__list">
          {detail.faults.map((fault) => (
            <ListRow
              key={fault.id}
              leading={<Icon name="warning" />}
              muted={fault.status === "fixed"}
              trailing={
                <span className="car__row-actions">
                  <Chip variant={fault.status === "open" ? "accent" : "data"}>
                    {copy.faultStatus[fault.status]}
                  </Chip>
                  {fault.status === "open" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        void run((car) =>
                          car.updateFault({
                            profileId,
                            vehicleId: detail.vehicle.id,
                            id: fault.id,
                            fields: {
                              date: fault.date,
                              symptom: fault.symptom,
                              status: "fixed",
                              fixNotes: fault.fixNotes,
                              serviceId: fault.serviceId,
                            },
                          }),
                        )
                      }
                    >
                      {copy.faults.markFixed}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void run((car) =>
                        car.removeFault({ profileId, vehicleId: detail.vehicle.id, id: fault.id }),
                      )
                    }
                  >
                    {copy.faults.remove}
                  </Button>
                </span>
              }
            >
              <span className="car__row-name">{fault.symptom}</span>
              <span className="car__row-facts">{faultLine(fault)}</span>
            </ListRow>
          ))}
        </div>
      )}
      <div className="car__actions">
        {!adding && (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            {copy.faults.add}
          </Button>
        )}
      </div>
      {adding && (
        <FaultForm
          services={detail.services}
          onCancel={() => setAdding(false)}
          onSubmit={(fields) => {
            setAdding(false);
            void run((car) =>
              car.addFault({ profileId, vehicleId: detail.vehicle.id, ...fields }),
            );
          }}
        />
      )}
    </Card>
  );
}

/** A fault's own line: the day, and what fixed it when anything did. */
function faultLine(fault: CarFaultView): string {
  const parts = [day(fault.date)];
  if (fault.fixNotes !== null && fault.fixNotes.trim() !== "") parts.push(fault.fixNotes);
  return parts.join(" · ");
}

function FaultForm({
  services,
  onSubmit,
  onCancel,
}: {
  services: readonly CarServiceView[];
  onSubmit: (fields: FaultFieldsForm) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState("");
  const [symptom, setSymptom] = useState("");
  const [status, setStatus] = useState<FaultStatus>(FAULT_STATUSES[0]);
  const [fixNotes, setFixNotes] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [problem, setProblem] = useState<"date" | "symptom" | null>(null);

  return (
    <div className="car__form">
      <div className="car__grid">
        <TextField
          type="date"
          label={copy.faults.date}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Select
          label={copy.faults.status}
          value={status}
          onChange={(event) => setStatus(event.target.value as FaultStatus)}
        >
          {FAULT_STATUSES.map((each) => (
            <option key={each} value={each}>
              {copy.faultStatus[each]}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.faults.symptom}
          value={symptom}
          maxLength={300}
          onChange={(event) => setSymptom(event.target.value)}
        />
        <Select
          label={copy.faults.service}
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
        >
          <option value="">{copy.faults.noService}</option>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {`${day(service.date)} · ${service.description}`}
            </option>
          ))}
        </Select>
      </div>
      <TextArea
        label={copy.faults.fixNotes}
        rows={2}
        maxLength={2000}
        value={fixNotes}
        onChange={(event) => setFixNotes(event.target.value)}
      />
      {problem === "date" && <p className="car__field-error">{copy.errors.date}</p>}
      {problem === "symptom" && <p className="car__field-error">{copy.errors.symptom}</p>}
      <div className="car__actions">
        <Button
          variant="primary"
          onClick={() => {
            if (!isBareDay(date)) {
              setProblem("date");
              return;
            }
            if (symptom.trim().length === 0) {
              setProblem("symptom");
              return;
            }
            setProblem(null);
            onSubmit({
              date,
              symptom: symptom.trim(),
              status,
              fixNotes: fixNotes.trim() === "" ? null : fixNotes.trim(),
              serviceId: serviceId === "" ? null : serviceId,
            });
          }}
        >
          {copy.faults.save}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.log.cancel}
        </Button>
      </div>
    </div>
  );
}
