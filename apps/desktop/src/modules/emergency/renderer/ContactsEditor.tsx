import { useState } from "react";
import { Button, Card, ListRow, Select, TextField } from "@nexus/ui";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { CARD_TEXT } from "../shared/cardText.js";
import type { EmergencyView } from "../shared/ipc.js";
import { blankToNull, contactName, moveNeighbours, type EmergencyRun } from "./card.js";
import { copy } from "./copy.js";

/**
 * The contact list, edited in place.
 *
 * **Order is the point.** These are the people somebody else telephones, so the
 * first row is the one to try first. The two arrows move a row between its
 * siblings through `moveContact`, which writes ONE row's fractional rank
 * (migration 062) - which is why this file sends the two neighbours it has just
 * computed (`card.ts`'s `moveNeighbours`) rather than a position a store would
 * then have to renumber the whole list for.
 *
 * **A contact is a person OR its own text, and the form says which.** Nexus's
 * People module keeps no phone number at all, so a linked contact still carries
 * its own number and relation; and somebody the user does not want in their
 * address book is typed in directly. Exactly one of the two is the schema's own
 * rule (migration 078), so choosing a person hides the name field instead of
 * leaving two ways to say the same thing.
 */

/** One contact being edited: `id` null while the row is new, and the person-or-text choice as two fields. */
interface ContactDraft {
  readonly id: string | null;
  readonly personId: string;
  readonly name: string;
  readonly phone: string;
  readonly relation: string;
}

export function ContactsEditor({
  profileId,
  view,
  run,
}: {
  profileId: string;
  view: EmergencyView;
  run: EmergencyRun;
}) {
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [problem, setProblem] = useState(false);
  const ids = view.contacts.map((contact) => contact.id);

  function openNew(): void {
    setProblem(false);
    setDraft({ id: null, personId: "", name: "", phone: "", relation: "" });
  }

  function openEdit(id: string): void {
    const contact = view.contacts.find((each) => each.id === id);
    if (contact === undefined) return;
    setProblem(false);
    setDraft({
      id: contact.id,
      personId: contact.personId ?? "",
      name: contact.name ?? "",
      phone: contact.phone ?? "",
      relation: contact.relation ?? "",
    });
  }

  function save(): void {
    if (draft === null) return;
    // The pair's rule, checked where the user can see it: a contact names a
    // person or carries a name of its own, and the store's refusal would arrive
    // as a sentence about a column instead.
    const namesAPerson = draft.personId !== "";
    if (!namesAPerson && draft.name.trim() === "") {
      setProblem(true);
      return;
    }
    const fields = {
      personId: namesAPerson ? draft.personId : null,
      name: namesAPerson ? null : draft.name.trim(),
      phone: blankToNull(draft.phone),
      relation: blankToNull(draft.relation),
    };
    const id = draft.id;
    setDraft(null);
    setProblem(false);
    void run((api) =>
      id === null
        ? api.addContact({ profileId, ...fields })
        : api.updateContact({ profileId, id, ...fields }),
    );
  }

  function move(id: string, direction: "up" | "down"): void {
    const index = ids.indexOf(id);
    const neighbours = moveNeighbours(ids, index, direction);
    // The buttons are disabled at the ends of the list, so this is the second
    // net rather than the guard the user meets.
    if (neighbours === null) return;
    void run((api) => api.moveContact({ profileId, id, ...neighbours }));
  }

  return (
    <Card className="emergency__contacts" title={copy.contacts.title}>
      {view.contacts.length === 0 ? (
        <p className="nx-hint">{copy.contacts.empty}</p>
      ) : (
        <div className="emergency__list">
          {ids.map((id, index) => {
            const contact = view.contacts[index];
            if (contact === undefined) return null;
            const name = contactName(contact, view.people);
            return (
              <ListRow
                key={id}
                trailing={
                  <span className="emergency__row-actions">
                    <Button
                      size="sm"
                      disabled={moveNeighbours(ids, index, "up") === null}
                      onClick={() => move(id, "up")}
                    >
                      {copy.contacts.moveUp}
                    </Button>
                    <Button
                      size="sm"
                      disabled={moveNeighbours(ids, index, "down") === null}
                      onClick={() => move(id, "down")}
                    >
                      {copy.contacts.moveDown}
                    </Button>
                    <Button size="sm" onClick={() => openEdit(id)}>
                      {copy.contacts.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => void run((api) => api.removeContact({ profileId, id }))}
                    >
                      {copy.contacts.remove}
                    </Button>
                  </span>
                }
              >
                <span className="emergency__contact-name">
                  {name ?? CARD_TEXT.contactMissing[activeLocale()]}
                </span>
                <span className="emergency__contact-meta">
                  {[contact.relation, contact.phone].filter((part) => part !== null).join(" · ")}
                </span>
              </ListRow>
            );
          })}
        </div>
      )}

      {draft === null ? (
        <div className="emergency__actions">
          <Button size="sm" onClick={openNew}>
            {copy.contacts.add}
          </Button>
        </div>
      ) : (
        <div className="emergency__contact-edit">
          <Select
            label={copy.contacts.person}
            value={draft.personId}
            onChange={(event) => setDraft({ ...draft, personId: event.target.value })}
          >
            <option value="">{copy.contacts.personNone}</option>
            {view.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
          {draft.personId === "" && (
            <TextField
              label={copy.contacts.name}
              value={draft.name}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          )}
          <TextField
            label={copy.contacts.phone}
            value={draft.phone}
            maxLength={40}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
          <TextField
            label={copy.contacts.relation}
            value={draft.relation}
            maxLength={60}
            onChange={(event) => setDraft({ ...draft, relation: event.target.value })}
          />
          {problem && <p className="emergency__field-error">{copy.contacts.problem}</p>}
          <div className="emergency__actions">
            <Button size="sm" variant="primary" onClick={save}>
              {copy.contacts.save}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setDraft(null)}>
              {copy.contacts.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

