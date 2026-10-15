import { useState } from "react";
import { Button, Card, Checkbox, TextField } from "@nexus/ui";
import {
  KIT72_DEFAULT_IDS,
  MAX_KIT_TEXT_LENGTH,
  addKitEntry,
  removeKitEntry,
  toggleKitEntry,
  type KitEntry,
} from "@nexus/core";
import { copy } from "./copy.js";
import { readKit, writeKit } from "./kitStore.js";

/**
 * The 72-hour kit checklist: fourteen basic items from Ready.gov, the user's own
 * items beside them, and the ticks.
 *
 * Every edit goes through one function that updates the page's value and writes
 * it for this profile, so the list on screen and the list in storage cannot
 * disagree. A default item's words come from the copy table; an added item is
 * shown as the user wrote it.
 */
export function KitCard({ profileId }: { readonly profileId: string }) {
  const [kit, setKit] = useState<readonly KitEntry[]>(() => readKit(profileId));
  const [draft, setDraft] = useState("");

  function commit(next: readonly KitEntry[]): void {
    setKit(next);
    writeKit(profileId, next);
  }

  const done = kit.filter((entry) => entry.done).length;

  return (
    <Card className="emergency__card" title={copy.prep.kitTitle}>
      <p className="nx-hint">{copy.prep.kitHint}</p>
      <p className="nx-hint">
        {copy.prep.kitProgress.replace("{done}", String(done)).replace("{total}", String(kit.length))}
      </p>
      <ul className="emergency__kit">
        {kit.map((entry) => {
          const label =
            entry.text ?? copy.prep.items[entry.id as (typeof KIT72_DEFAULT_IDS)[number]];
          return (
            <li key={entry.id} className="emergency__kit-row">
              <Checkbox
                checked={entry.done}
                done={entry.done}
                onChange={() => {
                  commit(toggleKitEntry(kit, entry.id));
                }}
              >
                {label}
              </Checkbox>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  commit(removeKitEntry(kit, entry.id));
                }}
              >
                {copy.prep.kitRemove}
              </Button>
            </li>
          );
        })}
      </ul>
      <form
        className="emergency__fields"
        onSubmit={(event) => {
          event.preventDefault();
          // A refused item (empty, too long, a full list) returns the same list, and
          // the draft stays in the field so the user can shorten it rather than retype it.
          const next = addKitEntry(kit, draft);
          if (next === kit) return;
          commit(next);
          setDraft("");
        }}
      >
        <TextField
          label={copy.prep.kitAddLabel}
          placeholder={copy.prep.kitAddPlaceholder}
          maxLength={MAX_KIT_TEXT_LENGTH}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" size="sm">
          {copy.prep.kitAdd}
        </Button>
      </form>
      <p className="nx-hint">{copy.prep.kitStorageNote}</p>
    </Card>
  );
}
