import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
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
import { PANTRY_CATEGORIES, PANTRY_UNITS, isPantryBarcode } from "@nexus/core";
import type { PantryCategory, PantryUnit } from "@nexus/core";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import type { PantryItemView, PantryLocationView, PantryView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  countedPhrase,
  expiryChipVariant,
  expiryLabel,
  expiryWords,
  formatQuantity,
  groupItemsByLocation,
  parseQuantityInput,
  quantityPhrase,
  quantityInputValue,
  splitArchived,
  urgentItems,
} from "./pantryPage.js";
import "./pantry.css";

/**
 * OSTAVA (ADR-090) — what is in the house, what runs out, and what expires.
 *
 * **Four sections, and the split is the module's own shape.** What is about to
 * go off, the stock itself with the form that adds to it, the shopping list, and
 * the shelves the other two are grouped by.
 *
 * **Nothing here computes a verdict.** Every expiry state, every "short by", and
 * the day they belong to arrive on the view (`main/register.ts` says why), so the
 * page draws what main said and never what it worked out.
 *
 * **Nothing opens over the page.** The item form, the shelf rename and the
 * shopping line are drawn where the row they make will land — the
 * `InlineNameForm` recipe the shell's own notes use — so there is no dialog to
 * trap focus in, and Escape closes the thing the user opened (`onKeyDown` on the
 * form, where the keystroke arrives from the field being typed into).
 *
 * **One read, one write, one answer.** Every mutation is `run`, which puts the
 * view main answered straight into state; the page holds no second copy of a row
 * and never guesses a delta.
 */

/** The module's own API, as the page reaches it. */
type PantryApi = typeof window.nexus.modules.pantry;
/**
 * Every write goes through this, and it answers whether it landed.
 *
 * `true`/`false` rather than a thrown error, because only ONE caller has
 * something of its own to say about a refusal: removing a shelf that still
 * holds items is refused by the store, and that sentence belongs beside the row
 * it is about rather than in the page's one error line. Every other caller
 * ignores the answer.
 */
type Run = (action: (pantry: PantryApi) => Promise<PantryView>) => Promise<boolean>;

/** A unit's name, read from the live copy table at USE time (`check:string-capture`'s rule). */
function unitName(unit: PantryUnit): string {
  return copy.units[unit];
}

/** A category's name, on `unitName`'s terms. */
function categoryName(category: PantryCategory): string {
  return copy.categories[category];
}

export default function PantryPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<PantryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: (pantry: PantryApi) => Promise<PantryView>): Promise<boolean> => {
      try {
        setView(await action(window.nexus.modules.pantry));
        setError(null);
        return true;
      } catch (failure) {
        setError(copy.errors.mutate);
        console.error("Nexus: a pantry change failed:", failure);
        return false;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.pantry.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the pantry could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="pantry">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it: the rail, the
          settings gallery and this header then cannot disagree about what the
          module is called (ADR-090's copy split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil="pantry"
      />
      {error !== null && (
        <p className="pantry__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={4} />
      ) : (
        <>
          <ExpiringSection view={view} />
          <StockSection profileId={profileId} view={view} run={run} />
          <ShoppingSection profileId={profileId} view={view} run={run} />
          <LocationsSection profileId={profileId} view={view} run={run} />
        </>
      )}
    </div>
  );
}

// --- Šta ističe --------------------------------------------------------------

/**
 * What is expired or inside the profile's own window, most urgent first.
 *
 * The list is DERIVED from the same rows the stock section draws, and the window
 * is the one the settings card holds — so this card, the chip on each row and the
 * reminder main fires are one fact read three times.
 */
function ExpiringSection({ view }: { view: PantryView }) {
  const urgent = urgentItems(view.items);
  const words = expiryWords();
  const caption = countedPhrase(
    copy.expiring.caption,
    view.settings.expiryWindowDays,
    copy.common,
  );

  return (
    <Card className="pantry__card" title={copy.expiring.title}>
      <p className="nx-hint">{caption}</p>
      {urgent.length === 0 ? (
        <p className="nx-hint">{copy.expiring.empty}</p>
      ) : (
        <div className="pantry__list">
          {urgent.map((item) => (
            <ListRow
              key={item.id}
              leading={<Icon name={item.status.expiry === "expired" ? "warning" : "clock"} />}
              trailing={
                <Chip variant={expiryChipVariant(item.status)}>
                  {expiryLabel(item.status, words)}
                </Chip>
              }
            >
              <span className="pantry__row-name">{item.name}</span>
              <span className="pantry__row-detail">
                {formatQuantity(item.quantity, unitName(item.unit))}
              </span>
              {/* The date a person acts on may come from the OPENING date and the
                  "use within" the packet states rather than from the packet's own
                  date, and a screen that showed only one of the two would disagree
                  with the box. This is the line that says which rule answered
                  (`effectiveExpiry.source`). */}
              {item.status.effectiveExpiry?.source === "opened" && (
                <span className="pantry__row-note nx-hint">
                  {copy.expiring.openedSource} {item.status.effectiveExpiry.date}
                </span>
              )}
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Ostava ------------------------------------------------------------------

function StockSection({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: PantryView;
  run: Run;
}) {
  /** Which form is open, and which item it edits — null while the list is just a list. */
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; id: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  /** The shelf a NEW item is filed under, so adding three things to one shelf is not three selections. */
  const [newLocationId, setNewLocationId] = useState<string | null>(null);

  const { current, archived } = splitArchived(view.items);
  const groups = groupItemsByLocation(current, view.locations);
  const words = expiryWords();
  const edited =
    editing?.mode === "edit" ? (view.items.find((one) => one.id === editing.id) ?? null) : null;

  const nameOf = (locationId: string | null): string =>
    locationId === null
      ? copy.stock.unassigned
      : (view.locations.find((location) => location.id === locationId)?.name ??
        copy.stock.unassigned);

  return (
    <Card className="pantry__card" title={copy.stock.title}>
      <div className="pantry__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setEditing(editing?.mode === "create" ? null : { mode: "create", id: "" })}
        >
          {copy.stock.add}
        </Button>
        {archived.length > 0 && (
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((shown) => !shown)}
          >
            {showArchived ? copy.stock.hideArchived : copy.stock.showArchived}
          </Button>
        )}
      </div>

      {editing?.mode === "create" && (
        <ItemForm
          profileId={profileId}
          locations={view.locations}
          item={null}
          initialLocationId={newLocationId}
          run={run}
          // The shelf the user just filed something under is the shelf the next
          // "Add" opens on: putting four things into the fridge should not mean
          // choosing the fridge four times.
          onSaved={setNewLocationId}
          onClose={() => setEditing(null)}
        />
      )}

      {current.length === 0 ? (
        <EmptyState
          title={copy.stock.emptyTitle}
          description={copy.stock.emptyBody}
          sigil="pantry"
          action={
            <Button
              size="sm"
              variant="primary"
              onClick={() => setEditing({ mode: "create", id: "" })}
            >
              {copy.stock.add}
            </Button>
          }
        />
      ) : (
        groups.map((group) => (
          <div key={group.locationId ?? "bez-mesta"} className="pantry__group">
            <p className="nx-eyebrow">{nameOf(group.locationId)}</p>
            <div className="pantry__list">
              {group.items.map((item) =>
                edited !== null && edited.id === item.id ? (
                  <ItemForm
                    key={item.id}
                    profileId={profileId}
                    locations={view.locations}
                    item={item}
                    initialLocationId={item.locationId}
                    run={run}
                    onSaved={setNewLocationId}
                    onClose={() => setEditing(null)}
                  />
                ) : (
                  <StockRow
                    key={item.id}
                    profileId={profileId}
                    item={item}
                    expiryText={expiryLabel(item.status, words)}
                    run={run}
                    onEdit={() => {
                      setNewLocationId(item.locationId);
                      setEditing({ mode: "edit", id: item.id });
                    }}
                  />
                ),
              )}
            </div>
          </div>
        ))
      )}

      {showArchived && archived.length > 0 && (
        <div className="pantry__group">
          <p className="nx-eyebrow">{copy.stock.archived}</p>
          <div className="pantry__list">
            {archived.map((item) => (
              <ListRow
                key={item.id}
                leading={<Icon name="archive" />}
                muted
                trailing={
                  <span className="pantry__row-actions">
                    <Button
                      size="sm"
                      onClick={() =>
                        void run((pantry) => pantry.unarchiveItem({ profileId, id: item.id }))
                      }
                    >
                      {copy.stock.unarchive}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        void run((pantry) => pantry.removeItem({ profileId, id: item.id }))
                      }
                    >
                      {copy.common.remove}
                    </Button>
                  </span>
                }
              >
                <span className="pantry__row-name">{item.name}</span>
                <span className="pantry__row-detail">
                  {formatQuantity(item.quantity, unitName(item.unit))}
                </span>
              </ListRow>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * One item of stock: what it is, how much there is, whether that is running out,
 * and when it stops being good.
 *
 * The two quick adjusts are the reason this module has a page rather than a form
 * — taking one of something is a keystroke, and a meal cooked out of the fridge
 * should not cost a dialog. Their reasons are the two moves a household makes
 * (something was used, something was bought), and the discard button is the
 * third: it is what puts the `expired` reason into the log the waste report adds
 * up.
 */
function StockRow({
  profileId,
  item,
  expiryText,
  run,
  onEdit,
}: {
  profileId: string;
  item: PantryItemView;
  expiryText: string;
  run: Run;
  onEdit: () => void;
}) {
  return (
    <ListRow
      leading={<Icon name="pantry" />}
      trailing={
        <span className="pantry__row-actions">
          {/* The chip repeats what the verdict SAYS, so colour never carries the
              state on its own (the design's redundancy rule). */}
          <Chip variant={expiryChipVariant(item.status)}>{expiryText}</Chip>
          {item.needed !== null && (
            <Chip variant="data">
              {quantityPhrase(copy.stock.low, item.needed, unitName(item.unit))}
            </Chip>
          )}
          <Button
            size="sm"
            aria-label={copy.stock.decrease}
            // Nothing left to take: an item that has run out is 0, not a debt
            // (the store refuses the move), so the control says so instead of
            // offering a refusal.
            disabled={item.quantity < 1}
            onClick={() =>
              void run((pantry) =>
                pantry.changeQuantity({ profileId, id: item.id, delta: -1, reason: "used" }),
              )
            }
          >
            -1
          </Button>
          <Button
            size="sm"
            aria-label={copy.stock.increase}
            onClick={() =>
              void run((pantry) =>
                pantry.changeQuantity({ profileId, id: item.id, delta: 1, reason: "bought" }),
              )
            }
          >
            +1
          </Button>
          <Button size="sm" onClick={onEdit}>
            {copy.common.edit}
          </Button>
          <Button
            size="sm"
            onClick={() => void run((pantry) => pantry.archiveItem({ profileId, id: item.id }))}
          >
            {copy.stock.archive}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void run((pantry) => pantry.removeItem({ profileId, id: item.id }))}
          >
            {copy.common.remove}
          </Button>
        </span>
      }
    >
      <span className="pantry__row-name">{item.name}</span>
      <span className="pantry__row-detail">
        {formatQuantity(item.quantity, unitName(item.unit))}
      </span>
      {/* What the user wrote is shown where it was written, and the barcode is
          deliberately NOT: a barcode is a key for a scanner rather than a line
          somebody reads, the app stores it verbatim, and a row of digits on
          every shelf would be noise on a page that is meant to be calm. The
          form is where it is entered and checked. */}
      {item.notes !== null && <span className="pantry__row-note nx-hint">{item.notes}</span>}
      {item.doseNote !== null && (
        <span className="pantry__row-note nx-hint">{item.doseNote}</span>
      )}
      {item.status.expiry === "expired" && item.quantity > 0 && (
        <Button
          size="sm"
          variant="quiet"
          onClick={() =>
            void run(async (pantry) => {
              // The whole of what is left goes at once, recorded as the one reason
              // that means "this went in the bin", and the row is then finished
              // with — a second walk through the same list would only be a second
              // chance to get the two ends of this out of step.
              const after = await pantry.changeQuantity({
                profileId,
                id: item.id,
                delta: -item.quantity,
                reason: "expired",
              });
              return after.items.find((one) => one.id === item.id)?.quantity === 0
                ? await pantry.archiveItem({ profileId, id: item.id })
                : after;
            })
          }
        >
          {copy.stock.discard}
        </Button>
      )}
    </ListRow>
  );
}

// --- Forma namirnice ---------------------------------------------------------

/** The form's own state, as text: a number field holds what the user is typing, never a number nobody finished. */
interface ItemDraft {
  name: string;
  category: PantryCategory;
  quantity: string;
  unit: PantryUnit;
  locationId: string;
  minQuantity: string;
  expiryDate: string;
  openedDate: string;
  useWithinDays: string;
  notes: string;
  barcode: string;
  doseNote: string;
}

/**
 * The create/edit form, drawn IN the list rather than over it.
 *
 * **Why the two modes are one component.** They hold the same eleven fields and
 * differ in two places: which op they call, and whether the quantity is writable
 * at all — a new item starts where the caller says, while an existing one moves
 * through the quick adjusts, because that is the path that writes the log in the
 * same transaction (`UpdatePantryItemFields`). Two components would be two
 * copies of eleven fields and two chances to let them drift apart.
 *
 * **Escape cancels**, on the form itself, so the keystroke arrives from whichever
 * field has focus. A refusal names the field it is about and never shows an
 * exception: the store's own sentence is English and belongs in the log, not on
 * a Serbian screen.
 */
function ItemForm({
  profileId,
  locations,
  item,
  initialLocationId,
  run,
  onSaved,
  onClose,
}: {
  profileId: string;
  locations: readonly PantryLocationView[];
  item: PantryItemView | null;
  initialLocationId: string | null;
  run: Run;
  /** Told the shelf the write landed on, so the NEXT form opens where this one did. */
  onSaved: (locationId: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => ({
    name: item?.name ?? "",
    category: item?.category ?? "food",
    quantity: item === null ? "1" : quantityInputValue(item.quantity),
    unit: item?.unit ?? "pcs",
    locationId: (item === null ? initialLocationId : item.locationId) ?? "",
    minQuantity: item?.minQuantity == null ? "" : quantityInputValue(item.minQuantity),
    expiryDate: item?.expiryDate ?? "",
    openedDate: item?.openedDate ?? "",
    useWithinDays: item?.useWithinDays == null ? "" : String(item.useWithinDays),
    notes: item?.notes ?? "",
    barcode: item?.barcode ?? "",
    doseNote: item?.doseNote ?? "",
  }));
  const [problem, setProblem] = useState<
    "name" | "quantity" | "minQuantity" | "useWithinDays" | "barcode" | null
  >(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof ItemDraft>(key: K, value: ItemDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    const name = draft.name.trim();
    if (name.length === 0 || name.length > 80) {
      setProblem("name");
      return;
    }
    const quantity = parseQuantityInput(draft.quantity);
    if (item === null && (quantity === null || quantity < 0)) {
      setProblem("quantity");
      return;
    }
    // A field the user filled in has to be READ: a minimum typed as "dva" is
    // refused by name rather than silently stored as "no minimum", and the same
    // goes for the two fields the store would otherwise catch after a round trip.
    const minimum = draft.minQuantity.trim() === "" ? null : parseQuantityInput(draft.minQuantity);
    if (draft.minQuantity.trim() !== "" && (minimum === null || minimum <= 0)) {
      setProblem("minQuantity");
      return;
    }
    const useWithin = draft.useWithinDays.trim() === "" ? null : Number(draft.useWithinDays);
    if (
      useWithin !== null &&
      (!Number.isSafeInteger(useWithin) || useWithin < 1 || useWithin > 3650)
    ) {
      setProblem("useWithinDays");
      return;
    }
    const code = draft.barcode.trim();
    if (code !== "" && !isPantryBarcode(code)) {
      setProblem("barcode");
      return;
    }
    setProblem(null);
    setBusy(true);
    const fields = {
      profileId,
      name,
      category: draft.category,
      unit: draft.unit,
      locationId: draft.locationId === "" ? null : draft.locationId,
      minQuantity: minimum,
      expiryDate: draft.expiryDate === "" ? null : draft.expiryDate,
      openedDate: draft.openedDate === "" ? null : draft.openedDate,
      useWithinDays: useWithin,
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      barcode: code === "" ? null : code,
      doseNote: draft.doseNote.trim() === "" ? null : draft.doseNote.trim(),
    };
    const landed = await run((pantry) =>
      item === null
        ? pantry.createItem({ ...fields, quantity: quantity ?? 0 })
        : pantry.updateItem({ ...fields, id: item.id }),
    );
    setBusy(false);
    if (!landed) return;
    onSaved(fields.locationId);
    onClose();
  }

  return (
    <div
      className="pantry__form"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="nx-eyebrow">{item === null ? copy.form.newTitle : copy.form.editTitle}</p>
      <div className="pantry__form-grid">
        <TextField
          label={copy.form.name}
          value={draft.name}
          maxLength={80}
          onChange={(event) => set("name", event.target.value)}
        />
        <Select
          label={copy.form.category}
          value={draft.category}
          onChange={(event) => set("category", event.target.value as PantryCategory)}
        >
          {PANTRY_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {categoryName(value)}
            </option>
          ))}
        </Select>
        {item === null && (
          <TextField
            label={copy.form.quantity}
            value={draft.quantity}
            inputMode="decimal"
            onChange={(event) => set("quantity", event.target.value)}
          />
        )}
        <Select
          label={copy.form.unit}
          value={draft.unit}
          onChange={(event) => set("unit", event.target.value as PantryUnit)}
        >
          {PANTRY_UNITS.map((value) => (
            <option key={value} value={value}>
              {unitName(value)}
            </option>
          ))}
        </Select>
        <Select
          label={copy.form.location}
          value={draft.locationId}
          onChange={(event) => set("locationId", event.target.value)}
        >
          <option value="">{copy.form.locationNone}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
        <TextField
          label={copy.form.minQuantity}
          value={draft.minQuantity}
          inputMode="decimal"
          onChange={(event) => set("minQuantity", event.target.value)}
        />
        <TextField
          label={copy.form.expiry}
          type="date"
          value={draft.expiryDate}
          onChange={(event) => set("expiryDate", event.target.value)}
        />
        <TextField
          label={copy.form.opened}
          type="date"
          value={draft.openedDate}
          onChange={(event) => set("openedDate", event.target.value)}
        />
        <TextField
          label={copy.form.useWithin}
          inputMode="numeric"
          value={draft.useWithinDays}
          onChange={(event) => set("useWithinDays", event.target.value)}
        />
        <TextField
          label={copy.form.barcode}
          inputMode="numeric"
          value={draft.barcode}
          onChange={(event) => set("barcode", event.target.value)}
        />
        {/* Medicine is stock and nothing more: the one field it adds is a line of
            free text from the box, never a dose this app computes from. */}
        {draft.category === "medicine" && (
          <TextField
            label={copy.form.doseNote}
            value={draft.doseNote}
            onChange={(event) => set("doseNote", event.target.value)}
          />
        )}
      </div>
      <p className="nx-hint">{copy.form.minQuantityHint}</p>
      {draft.category === "medicine" && <p className="nx-hint">{copy.form.doseNoteHint}</p>}
      <TextArea
        label={copy.form.notes}
        value={draft.notes}
        rows={2}
        onChange={(event) => set("notes", event.target.value)}
      />
      {problem === "name" && <p className="pantry__field-error">{copy.errors.name}</p>}
      {problem === "quantity" && <p className="pantry__field-error">{copy.errors.quantity}</p>}
      {problem === "minQuantity" && (
        <p className="pantry__field-error">{copy.errors.quantity}</p>
      )}
      {problem === "useWithinDays" && <p className="pantry__field-error">{copy.errors.days}</p>}
      {problem === "barcode" && <p className="pantry__field-error">{copy.errors.barcode}</p>}
      <div className="pantry__actions">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
          {copy.common.save}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {copy.common.cancel}
        </Button>
      </div>
    </div>
  );
}

// --- Lista za kupovinu -------------------------------------------------------

/**
 * The shopping list, in the two halves it really has.
 *
 * The DERIVED half is `@nexus/core`'s `shoppingList`: every live item below its
 * minimum, grouped by shelf, with the quantity that reaches it — and it is stored
 * nowhere, because "below the minimum" is a fact about today's shelf. Ticking one
 * of those is a PURCHASE: the quantity goes back into the item, and the line
 * leaves the list by itself the moment the item reaches its minimum. That is the
 * round trip the module is built around.
 *
 * The other half is what the user wrote in himself (migration 075's
 * `pantry_shopping`). A line there may name an item, and ticking it restocks that
 * item; a line that names none is a reminder, and ticking it is the whole of
 * "bought it".
 */
function ShoppingSection({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: PantryView;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState<PantryUnit>("pcs");
  const [itemId, setItemId] = useState("");
  const [problem, setProblem] = useState<"name" | "quantity" | null>(null);

  const nothing = view.autoShopping.length === 0 && view.shopping.length === 0;

  function add(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setProblem("name");
      return;
    }
    const amount = parseQuantityInput(quantity);
    if (amount === null || amount <= 0) {
      setProblem("quantity");
      return;
    }
    setProblem(null);
    setName("");
    setQuantity("1");
    setItemId("");
    void run((pantry) =>
      pantry.addShoppingLine({
        profileId,
        name: trimmed,
        quantity: amount,
        unit,
        itemId: itemId === "" ? null : itemId,
      }),
    );
  }

  return (
    <Card className="pantry__card" title={copy.shopping.title}>
      {nothing && <p className="nx-hint">{copy.shopping.empty}</p>}

      {view.autoShopping.length > 0 && (
        <>
          <p className="nx-hint">{copy.shopping.auto}</p>
          {view.autoShopping.map((group) => (
            <div key={group.locationId ?? "bez-mesta"} className="pantry__group">
              <p className="nx-eyebrow">
                {group.locationName ?? copy.shopping.unassigned}
              </p>
              <div className="pantry__list">
                {group.lines.map((line) => (
                  <ListRow
                    key={line.itemId}
                    leading={<Icon name="list" />}
                    trailing={
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void run((pantry) =>
                            pantry.changeQuantity({
                              profileId,
                              id: line.itemId,
                              delta: line.needed,
                              reason: "bought",
                            }),
                          )
                        }
                      >
                        {copy.shopping.tick}
                      </Button>
                    }
                  >
                    <span className="pantry__row-name">{line.name}</span>
                    <span className="pantry__row-detail">
                      {quantityPhrase(copy.shopping.needed, line.needed, unitName(line.unit))}
                    </span>
                  </ListRow>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {view.shopping.length > 0 && (
        <>
          <p className="nx-eyebrow">{copy.shopping.manual}</p>
          <div className="pantry__list">
            {view.shopping.map((line) => (
              <ListRow
                key={line.id}
                leading={<Icon name="plus" />}
                trailing={
                  <span className="pantry__row-actions">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() =>
                        void run((pantry) => pantry.tickShoppingLine({ profileId, id: line.id }))
                      }
                    >
                      {copy.shopping.tick}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        void run((pantry) =>
                          pantry.removeShoppingLine({ profileId, id: line.id }),
                        )
                      }
                    >
                      {copy.shopping.removeLine}
                    </Button>
                  </span>
                }
              >
                <span className="pantry__row-name">{line.name}</span>
                <span className="pantry__row-detail">
                  {formatQuantity(line.quantity, unitName(line.unit))}
                </span>
              </ListRow>
            ))}
          </div>
        </>
      )}

      <div className="pantry__form-grid">
        <TextField
          label={copy.shopping.name}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={copy.shopping.quantity}
          value={quantity}
          inputMode="decimal"
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Select
          label={copy.shopping.unit}
          value={unit}
          onChange={(event) => setUnit(event.target.value as PantryUnit)}
        >
          {PANTRY_UNITS.map((value) => (
            <option key={value} value={value}>
              {unitName(value)}
            </option>
          ))}
        </Select>
        {/* The one optional thing on a hand-written line: the item it restocks
            when it is ticked. A line with no link is a reminder, which is what
            most of a shopping list is. */}
        <Select
          label={copy.shopping.link}
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
        >
          <option value="">{copy.shopping.linkNone}</option>
          {view.items
            .filter((item) => item.archivedAt === null)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </Select>
      </div>
      <p className="nx-hint">{copy.shopping.tickHint}</p>
      {problem === "name" && <p className="pantry__field-error">{copy.errors.name}</p>}
      {problem === "quantity" && <p className="pantry__field-error">{copy.errors.quantity}</p>}
      <div className="pantry__actions">
        <Button size="sm" onClick={add}>
          {copy.shopping.add}
        </Button>
      </div>
    </Card>
  );
}

// --- Mesta -------------------------------------------------------------------

/**
 * The shelves, in the order the user put them in.
 *
 * A shelf is where things ARE, so the order is theirs and moving one is one
 * keystroke — up and down rather than a drag, because a drag inside a list of
 * five labels is a gesture with nowhere to land (ADR-034's own reason for the
 * calendar's move controls). Removing a shelf that still holds items is refused
 * by the store, and that refusal is said BESIDE the row in the app's own words
 * rather than as the exception it is.
 */
function LocationsSection({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: PantryView;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState(false);
  const [held, setHeld] = useState<string | null>(null);

  const locations = view.locations;

  /** Up or down one slot, between the neighbours the drop lands between. */
  function move(index: number, step: -1 | 1): void {
    const target = index + step;
    const moving = locations[index];
    if (target < 0 || target >= locations.length || moving === undefined) return;
    void run((pantry) =>
      pantry.moveLocation({
        profileId,
        id: moving.id,
        beforeId: step === -1 ? (locations[index - 2]?.id ?? null) : (locations[target]?.id ?? null),
        afterId: step === -1 ? (locations[index - 1]?.id ?? null) : (locations[index + 2]?.id ?? null),
      }),
    );
  }

  return (
    <Card className="pantry__card" title={copy.locations.title}>
      {locations.length === 0 ? (
        <p className="nx-hint">{copy.locations.empty}</p>
      ) : (
        <div className="pantry__list">
          {locations.map((location, index) =>
            renaming === location.id ? (
              <div key={location.id} className="pantry__form">
                <TextField
                  label={copy.locations.rename}
                  value={draft}
                  maxLength={60}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="pantry__actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const trimmed = draft.trim();
                      if (trimmed.length === 0) return;
                      setRenaming(null);
                      void run((pantry) =>
                        pantry.renameLocation({ profileId, id: location.id, name: trimmed }),
                      );
                    }}
                  >
                    {copy.common.save}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                    {copy.common.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <ListRow key={location.id} leading={<Icon name="grid" />}>
                <span className="pantry__row-name">{location.name}</span>
                <span className="pantry__row-actions">
                  <Button
                    size="sm"
                    aria-label={copy.locations.up}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon name="chevronUp" size={15} />
                  </Button>
                  <Button
                    size="sm"
                    aria-label={copy.locations.down}
                    disabled={index === locations.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="chevronDown" size={15} />
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDraft(location.name);
                      setRenaming(location.id);
                    }}
                  >
                    {copy.locations.rename}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setHeld(null);
                      void run((pantry) =>
                        pantry.removeLocation({ profileId, id: location.id }),
                      ).then((landed) => {
                        if (!landed) setHeld(location.id);
                      });
                    }}
                  >
                    {copy.common.remove}
                  </Button>
                </span>
                {held === location.id && (
                  <span className="pantry__field-error">{copy.errors.locationInUse}</span>
                )}
              </ListRow>
            ),
          )}
        </div>
      )}

      <div className="pantry__form-grid">
        <TextField
          label={copy.locations.name}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {problem && <p className="pantry__field-error">{copy.errors.location}</p>}
      <div className="pantry__actions">
        <Button
          size="sm"
          onClick={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0 || trimmed.length > 60) {
              setProblem(true);
              return;
            }
            setProblem(false);
            setName("");
            void run((pantry) => pantry.createLocation({ profileId, name: trimmed }));
          }}
        >
          {copy.locations.add}
        </Button>
      </div>
    </Card>
  );
}
